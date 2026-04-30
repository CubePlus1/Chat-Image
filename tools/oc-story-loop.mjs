#!/usr/bin/env node
/**
 * Morina OC 故事循环图生图脚本
 *
 * 用 gpt-5.5 按故事设定随机生成场景 prompt，再用 gpt-image-2 基于主立绘做图生图。
 *
 * 用法:
 *   node tools/oc-story-loop.mjs                      # 默认 10 张，混合场景
 *   node tools/oc-story-loop.mjs --count 30
 *   node tools/oc-story-loop.mjs --count 5 --scene battle
 *   node tools/oc-story-loop.mjs --count 8 --scene life --quality hd
 *
 * 参数:
 *   --count N         生成数量 (2..100, 默认 10)
 *   --scene TYPE      life | battle | mixed (默认 mixed)
 *   --quality Q       standard | medium | hd (默认 medium)
 *   --aspect A        1-1 | 16-9 | 9-16 | 4-3 | 3-4 | 21-9 (默认 16-9)
 *   --concurrency N   图生图并发数 1-5 (默认 3)，简写 -n N
 *   --server URL      代理地址 (默认 http://localhost:56780)
 *   --anchor PATH     OC 主立绘路径 (默认 /Users/sevencolor/Documents/Morina/立绘.png)
 *   --story DIR       故事目录 (默认 /Users/sevencolor/Documents/Morina/story)
 */

import http from 'node:http';
import https from 'node:https';
import fs from 'node:fs';
import path from 'node:path';
import { URL, fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const config = (await import('../config.js')).default || (await import('../config.js'));

// ── 参数解析 ────────────────────────────────────────────────
function parseArgs() {
    const args = process.argv.slice(2);
    const out = {
        count: 10,
        scene: 'mixed',
        quality: 'medium',
        aspect: '16-9',
        concurrency: 3,
        server: 'http://localhost:56780',
        anchor: '/Users/sevencolor/Documents/Morina/立绘.png',
        story: '/Users/sevencolor/Documents/Morina/story',
    };
    for (let i = 0; i < args.length; i++) {
        const k = args[i];
        const v = args[i + 1];
        if (k === '--count')   { out.count = Math.max(2, Math.min(100, parseInt(v, 10))); i++; }
        else if (k === '--scene')   { out.scene = v; i++; }
        else if (k === '--quality') { out.quality = v; i++; }
        else if (k === '--aspect')  { out.aspect = v; i++; }
        else if (k === '--concurrency' || k === '-n') { out.concurrency = Math.max(1, Math.min(5, parseInt(v, 10))); i++; }
        else if (k === '--server')  { out.server = v; i++; }
        else if (k === '--anchor')  { out.anchor = v; i++; }
        else if (k === '--story')   { out.story = v; i++; }
        else if (k === '-h' || k === '--help') { printHelp(); process.exit(0); }
    }
    return out;
}

function printHelp() {
    console.log(fs.readFileSync(import.meta.url.replace('file://', ''), 'utf8').split('\n').slice(2, 22).join('\n').replace(/^ \* ?/gm, ''));
}

// ── HTTP 工具 ───────────────────────────────────────────────
function httpRequest(urlStr, options, body) {
    return new Promise((resolve, reject) => {
        const u = new URL(urlStr);
        const lib = u.protocol === 'https:' ? https : http;
        const req = lib.request(u, options, (res) => {
            const chunks = [];
            res.on('data', c => chunks.push(c));
            res.on('end', () => {
                const buf = Buffer.concat(chunks);
                resolve({ statusCode: res.statusCode, headers: res.headers, body: buf });
            });
        });
        req.on('error', reject);
        if (body) req.write(body);
        req.end();
    });
}

async function downloadFile(urlStr, destPath) {
    const { statusCode, body } = await httpRequest(urlStr, { method: 'GET' });
    if (statusCode !== 200) throw new Error(`下载失败 ${statusCode}: ${urlStr}`);
    fs.writeFileSync(destPath, body);
}

// ── 大模型调用 ──────────────────────────────────────────────
async function callLLM(messages, { model = 'gpt-5.5', jsonMode = true } = {}) {
    const enhanceBase = config.ENHANCE_API_BASE.replace(/\/$/, '');
    const url = `${enhanceBase}/chat/completions`;
    const payload = {
        model,
        messages,
        ...(jsonMode ? { response_format: { type: 'json_object' } } : {}),
    };
    const body = Buffer.from(JSON.stringify(payload));
    const { statusCode, body: respBuf } = await httpRequest(url, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'Content-Length': body.length,
            'Authorization': `Bearer ${config.ENHANCE_API_KEY}`,
        },
    }, body);
    const text = respBuf.toString('utf8');
    if (statusCode !== 200) {
        throw new Error(`LLM ${statusCode}: ${text.substring(0, 400)}`);
    }
    const data = JSON.parse(text);
    const content = data.choices?.[0]?.message?.content || '';
    return { content, raw: data };
}

// ── 图生图调用（走本服务的 /api/images/edit）─────────────────
async function editImage({ server, prompt, imageBase64, mimeType, quality, aspect }) {
    const url = `${server.replace(/\/$/, '')}/api/images/edit`;
    const payload = JSON.stringify({
        prompt,
        imageBase64,
        mimeType,
        model: 'gpt-image-2',
        quality,
        aspectRatio: aspect,
    });
    const body = Buffer.from(payload);
    const { statusCode, body: respBuf } = await httpRequest(url, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'Content-Length': body.length,
        },
    }, body);
    const text = respBuf.toString('utf8');
    if (statusCode !== 200) {
        throw new Error(`图生图 ${statusCode}: ${text.substring(0, 400)}`);
    }
    return JSON.parse(text);
}

// ── 故事 / 主立绘 / system prompt ───────────────────────────
function loadStory(storyDir) {
    if (!fs.existsSync(storyDir)) throw new Error(`故事目录不存在: ${storyDir}`);
    const files = fs.readdirSync(storyDir).filter(f => f.endsWith('.md')).sort();
    return files.map(f => `# === ${f} ===\n${fs.readFileSync(path.join(storyDir, f), 'utf8')}`).join('\n\n');
}

function buildSystemPrompt(storyText, sceneMode) {
    const sceneRule = ({
        life:   '只生成生活/日常场景（休息、用餐、散步、独处、归档塔内等），禁止战斗、武器、对抗。',
        battle: '只生成战斗/对抗场景（与死亡协议、归零潮、副本、王座决战等）。',
        mixed:  '生活与战斗场景混合，比例约 1:1，自由穿插。',
    })[sceneMode] || '生活与战斗场景混合，比例约 1:1，自由穿插。';

    return `你是一名 cyberpunk-anime 美术导演，正在为原创角色 **Morina** 创作分镜场景。
请严格遵循下方设定，生成英文绘图 prompt（必须包含角色一致性描述词），让插画师按此画图。

# 角色设定（必须保持一致，每条 prompt 都必须显式包含这些视觉特征）
- character: Morina, female cyberpunk-mystic anime girl
- hair: extremely long silver-white hair with subtle pink and cyan-blue gradient streaks, straight bangs, side locks reaching the floor
- eyes: heterochromia, LEFT eye pink, RIGHT eye light blue, sharp angular shape
- ears/tail: black cat ears on top of head, long thin cat tail (silver/blue/pink fade)
- outfit: oversized black hoodie with hood up, drawstrings, tactical buckles and straps, short ruffled black skirt under the hoodie
- legwear: thigh-high black stockings, black fishnet over the right calf, black thigh garter belt with buckles and chain
- shoes: chunky platform combat boots with metal buckles
- aura: pale skin, calm composed expression, slight melancholy, minor neon pink/blue rim light
- emblem motifs (use sparingly): DNA helix on chest, sun glyph (left) + crescent moon (right), vertical phase beam, binary rain, circuit fire, blue-screen background

# 世界观参考
${storyText}

# 场景规则
${sceneRule}

# 输出格式（严格 JSON，不要解释）
{
  "scene_zh": "中文 18-30 字场景描述",
  "type": "life" 或 "battle",
  "prompt": "英文绘图 prompt，120-200 词，必须显式重复角色外观关键词，加上具体场景、构图、光影、镜头、画风（cyberpunk anime, neon, dark fantasy, cinematic, detailed）"
}

# 注意
- prompt 必须可独立用于图生图，禁止依赖上下文记忆
- prompt 中必须包含 "Morina, silver-white long hair with pink and blue streaks, heterochromia left pink right blue, black cat ears, black hooded jacket, fishnet stockings, platform boots"
- 每张场景必须与之前生成的场景明显不同（构图、动作、地点、情绪）
- 不要写中文标点；prompt 全英文`;
}

// ── 主流程 ──────────────────────────────────────────────────
async function main() {
    const opts = parseArgs();

    console.log('🎬 Morina OC 故事循环图生图');
    console.log(`   数量: ${opts.count} 张`);
    console.log(`   并发: ${opts.concurrency}`);
    console.log(`   场景: ${opts.scene}`);
    console.log(`   画质: ${opts.quality}`);
    console.log(`   比例: ${opts.aspect}`);
    console.log(`   服务: ${opts.server}`);
    console.log(`   锚点: ${opts.anchor}`);

    if (!fs.existsSync(opts.anchor)) throw new Error(`主立绘不存在: ${opts.anchor}`);
    const anchorBuf = fs.readFileSync(opts.anchor);
    const anchorBase64 = anchorBuf.toString('base64');
    const mimeType = opts.anchor.toLowerCase().endsWith('.jpg') || opts.anchor.toLowerCase().endsWith('.jpeg')
        ? 'image/jpeg' : 'image/png';
    console.log(`   主立绘: ${(anchorBuf.length / 1024 / 1024).toFixed(2)} MB`);

    const storyText = loadStory(opts.story);
    console.log(`   故事: ${(storyText.length / 1024).toFixed(1)} KB`);

    // 输出目录
    const ts = new Date().toISOString().replace(/[-:T.]/g, '').slice(0, 14);
    const outDir = path.join(__dirname, '..', 'oc_runs', `${ts}_morina`);
    fs.mkdirSync(outDir, { recursive: true });
    const logStream = fs.createWriteStream(path.join(outDir, 'prompts.jsonl'));
    fs.writeFileSync(path.join(outDir, 'meta.json'), JSON.stringify({ ...opts, startedAt: new Date().toISOString() }, null, 2));
    console.log(`📁 输出: ${outDir}\n`);

    const systemPrompt = buildSystemPrompt(storyText, opts.scene);
    const sceneHistory = [];   // 串行 LLM 共用，按完成顺序追加
    const results = [];
    const startedAt = Date.now();
    let completed = 0;

    // LLM 调用串行化（避免并发抢同一份历史造成场景重复），用 promise 链做互斥
    let llmGate = Promise.resolve();
    const withLLMLock = (fn) => {
        const run = llmGate.then(fn, fn); // 即使前一个抛错也继续
        llmGate = run.then(() => {}, () => {});
        return run;
    };

    // 任务队列
    const queue = Array.from({ length: opts.count }, (_, i) => i + 1);

    async function processOne(idx) {
        const label = `[${String(idx).padStart(2, '0')}/${opts.count}]`;

        // ── 阶段 1: LLM 生成场景 prompt（串行）──────────────────
        let parsed;
        try {
            parsed = await withLLMLock(async () => {
                const historyText = sceneHistory.length === 0
                    ? '（暂无）'
                    : sceneHistory.map((s, j) => `${j + 1}. [${s.type}] ${s.scene_zh}`).join('\n');
                const messages = [
                    { role: 'system', content: systemPrompt },
                    { role: 'user',   content: `已生成的场景:\n${historyText}\n\n请给出第 ${idx} 场，仅输出 JSON。` },
                ];
                console.log(`${label} 🧠 调用 gpt-5.5...`);
                const { content } = await callLLM(messages, { model: 'gpt-5.5', jsonMode: true });
                const p = JSON.parse(content);
                if (!p.prompt || !p.scene_zh) throw new Error('LLM 返回缺字段');
                sceneHistory.push(p); // 立即写入，后续 LLM 调用可见
                console.log(`${label} 📝 [${p.type}] ${p.scene_zh}`);
                return p;
            });
        } catch (e) {
            console.error(`${label} ❌ LLM 失败: ${e.message}`);
            logStream.write(JSON.stringify({ index: idx, error: e.message, stage: 'llm' }) + '\n');
            return;
        }

        // ── 阶段 2: 图生图（并发）──────────────────────────────
        console.log(`${label} 🎨 图生图 (并发中)...`);
        const t0 = Date.now();
        let imgRes;
        try {
            imgRes = await editImage({
                server: opts.server,
                prompt: parsed.prompt,
                imageBase64: anchorBase64,
                mimeType,
                quality: opts.quality,
                aspect: opts.aspect,
            });
        } catch (e) {
            console.error(`${label} ❌ 图生图失败: ${e.message}`);
            logStream.write(JSON.stringify({ index: idx, ...parsed, error: e.message, stage: 'image' }) + '\n');
            return;
        }

        const remoteUrl = imgRes.data?.[0]?.url;
        if (!remoteUrl) {
            console.error(`${label} ❌ 响应缺 url`);
            logStream.write(JSON.stringify({ index: idx, ...parsed, error: 'no url', stage: 'image' }) + '\n');
            return;
        }

        const fullUrl = remoteUrl.startsWith('http') ? remoteUrl : `${opts.server.replace(/\/$/, '')}${remoteUrl}`;
        const localName = `${String(idx).padStart(2, '0')}_${parsed.type}.png`;
        const localPath = path.join(outDir, localName);
        try {
            await downloadFile(fullUrl, localPath);
        } catch (e) {
            console.error(`${label} ⚠️ 下载失败: ${e.message}`);
        }

        const elapsed = ((Date.now() - t0) / 1000).toFixed(1);
        completed++;
        const totalElapsed = ((Date.now() - startedAt) / 1000).toFixed(0);
        console.log(`${label} ✅ ${elapsed}s → ${localName}  (进度 ${completed}/${opts.count}, 总耗时 ${totalElapsed}s)`);

        results.push({ index: idx, ...parsed, remoteUrl: fullUrl, local: localName });
        logStream.write(JSON.stringify({ index: idx, ...parsed, remoteUrl: fullUrl, local: localName }) + '\n');
    }

    // ── Worker pool ────────────────────────────────────────────
    async function worker(workerId) {
        while (queue.length > 0) {
            const idx = queue.shift();
            if (idx === undefined) return;
            await processOne(idx);
        }
    }

    const workers = Array.from({ length: Math.min(opts.concurrency, opts.count) }, (_, i) => worker(i + 1));
    await Promise.all(workers);

    logStream.end();

    const totalTime = ((Date.now() - startedAt) / 1000).toFixed(1);
    const ok = results.length;
    const fail = opts.count - ok;
    console.log(`\n🏁 完成：成功 ${ok} 张，失败 ${fail} 张，总耗时 ${totalTime}s（约 ${(totalTime / opts.count).toFixed(1)}s/张实测，并发 ${opts.concurrency}）`);
    console.log(`📂 ${outDir}`);
    console.log(`📜 ${path.join(outDir, 'prompts.jsonl')}`);
}

main().catch(e => { console.error('💥', e); process.exit(1); });
