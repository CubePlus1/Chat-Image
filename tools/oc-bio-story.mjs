#!/usr/bin/env node
/**
 * Morina 图文人物传记生成器
 *
 * 用 gpt-5.5 写多章传记，每章有 K 张配图（gpt-image-2 基于主立绘做图生图），
 * 输出一份 markdown 文件，散文与配图穿插，可直接阅读或导出。
 *
 * 用法:
 *   node tools/oc-bio-story.mjs                                  # 默认 8 章 / 每章 2 图 / 中等长度 / 并发 3
 *   node tools/oc-bio-story.mjs --chapters 12 --images-per-chapter 3
 *   node tools/oc-bio-story.mjs -c 6 -i 1 --length short --style poetic -n 5
 *
 * 参数:
 *   --chapters N             章数 3-20 (默认 8)，简写 -c N
 *   --images-per-chapter K   每章配图数 1-3 (默认 2)，简写 -i K
 *   --length L               short | medium | long (默认 medium)
 *   --style S                biography | first-person | poetic | dialogue (默认 biography)
 *   --concurrency N          图生图并发 1-5 (默认 3)，简写 -n N
 *   --quality Q              standard | medium | hd (默认 medium)
 *   --aspect A               1-1 | 16-9 | 9-16 | 4-3 | 3-4 | 21-9 (默认 16-9)
 *   --server URL             代理地址 (默认 http://localhost:56780)
 *   --anchor PATH            主立绘 (默认 /Users/sevencolor/Documents/Morina/立绘.png)
 *   --story DIR              故事目录 (默认 /Users/sevencolor/Documents/Morina/story)
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
        chapters: 8,
        imagesPerChapter: 2,
        length: 'medium',
        style: 'biography',
        concurrency: 3,
        quality: 'medium',
        aspect: '16-9',
        server: 'http://localhost:56780',
        anchor: '/Users/sevencolor/Documents/Morina/立绘.png',
        story: '/Users/sevencolor/Documents/Morina/story',
    };
    for (let i = 0; i < args.length; i++) {
        const k = args[i], v = args[i + 1];
        if (k === '--chapters' || k === '-c') { out.chapters = Math.max(3, Math.min(100, parseInt(v, 10))); i++; }
        else if (k === '--images-per-chapter' || k === '-i') { out.imagesPerChapter = Math.max(1, Math.min(3, parseInt(v, 10))); i++; }
        else if (k === '--length')  { out.length = v; i++; }
        else if (k === '--style')   { out.style = v; i++; }
        else if (k === '--concurrency' || k === '-n') { out.concurrency = Math.max(1, Math.min(5, parseInt(v, 10))); i++; }
        else if (k === '--quality') { out.quality = v; i++; }
        else if (k === '--aspect')  { out.aspect = v; i++; }
        else if (k === '--server')  { out.server = v; i++; }
        else if (k === '--anchor')  { out.anchor = v; i++; }
        else if (k === '--story')   { out.story = v; i++; }
        else if (k === '-h' || k === '--help') {
            const src = fs.readFileSync(import.meta.url.replace('file://', ''), 'utf8');
            console.log(src.split('\n').slice(1, 30).join('\n').replace(/^ \*\/?/gm, '').replace(/^ \* ?/gm, ''));
            process.exit(0);
        }
    }
    return out;
}

// ── HTTP 工具 ───────────────────────────────────────────────
function httpRequest(urlStr, options, body) {
    return new Promise((resolve, reject) => {
        const u = new URL(urlStr);
        const lib = u.protocol === 'https:' ? https : http;
        const req = lib.request(u, options, (res) => {
            const chunks = [];
            res.on('data', c => chunks.push(c));
            res.on('end', () => resolve({ statusCode: res.statusCode, headers: res.headers, body: Buffer.concat(chunks) }));
        });
        req.on('error', reject);
        if (body) req.write(body);
        req.end();
    });
}

async function downloadFile(urlStr, destPath) {
    const { statusCode, body } = await httpRequest(urlStr, { method: 'GET' });
    if (statusCode !== 200) throw new Error(`下载 ${statusCode}: ${urlStr}`);
    fs.writeFileSync(destPath, body);
}

async function callLLM(messages, { model = 'gpt-5.5', jsonMode = true } = {}) {
    const enhanceBase = config.ENHANCE_API_BASE.replace(/\/$/, '');
    const url = `${enhanceBase}/chat/completions`;
    const payload = { model, messages, ...(jsonMode ? { response_format: { type: 'json_object' } } : {}) };
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
    if (statusCode !== 200) throw new Error(`LLM ${statusCode}: ${text.substring(0, 400)}`);
    const data = JSON.parse(text);
    return { content: data.choices?.[0]?.message?.content || '' };
}

async function editImage({ server, prompt, imageBase64, mimeType, quality, aspect }) {
    const url = `${server.replace(/\/$/, '')}/api/images/edit`;
    const body = Buffer.from(JSON.stringify({
        prompt, imageBase64, mimeType,
        model: 'gpt-image-2',
        quality, aspectRatio: aspect,
    }));
    const { statusCode, body: respBuf } = await httpRequest(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Content-Length': body.length },
    }, body);
    const text = respBuf.toString('utf8');
    if (statusCode !== 200) throw new Error(`图生图 ${statusCode}: ${text.substring(0, 400)}`);
    return JSON.parse(text);
}

// ── 故事加载 ────────────────────────────────────────────────
function loadStory(storyDir) {
    if (!fs.existsSync(storyDir)) throw new Error(`故事目录不存在: ${storyDir}`);
    const files = fs.readdirSync(storyDir).filter(f => f.endsWith('.md')).sort();
    return files.map(f => `# === ${f} ===\n${fs.readFileSync(path.join(storyDir, f), 'utf8')}`).join('\n\n');
}

// ── 视觉锚点（每张图必须显式包含）──────────────────────────
const VISUAL_ANCHOR_EN = `Morina, female cyberpunk-mystic anime girl, extremely long silver-white hair with subtle pink and cyan-blue gradient streaks, straight bangs, heterochromia (LEFT eye pink, RIGHT eye light blue), black cat ears on top of head, long thin cat tail, oversized black hooded jacket with hood up and tactical buckles and straps, short ruffled black skirt under hoodie, thigh-high black stockings, fishnet over right calf, garter belt with buckles and chain, chunky platform combat boots with metal buckles, pale skin, calm composed expression, slight melancholy, neon pink and blue rim light`;

const LENGTH_SPECS = {
    short:  { range: '400-600',   desc: '简短',   total: '约 4000 字' },
    medium: { range: '800-1200',  desc: '中等',   total: '约 9000 字' },
    long:   { range: '1500-2200', desc: '深度',   total: '约 16000 字' },
};

const STYLE_SPECS = {
    'biography':    '第三人称传记体，叙事克制，文气端庄，宏大与悲悯并存',
    'first-person': '第一人称内心独白，节奏缓慢，富有反思与抒情',
    'poetic':       '诗化散文，意象密度高，节奏跳跃，强烈视觉化',
    'dialogue':     '对白驱动，第三人称穿插，对话占 40%-60%，台词锋利',
};

// ── Phase A: 大纲 ──────────────────────────────────────────
async function generateOutline(opts, storyText) {
    const styleDesc = STYLE_SPECS[opts.style] || STYLE_SPECS.biography;
    const totalLen = LENGTH_SPECS[opts.length]?.total || '约 9000 字';

    const messages = [
        { role: 'system', content: `你是一位资深科幻小说编剧。下面给出原创角色 Morina 的世界观与设定，请为她设计一部 ${opts.chapters} 章的人物传记式长篇叙事大纲。

# 世界观与角色设定
${storyText}

# 输出（严格 JSON，不要解释）
{
  "title": "整本书的标题（10-18 字）",
  "subtitle": "副标题或一句引言",
  "chapters": [
    {
      "index": 1,
      "title": "章节标题（4-12 字）",
      "period": "时空定位（短句）",
      "scene_type": "life | battle | mixed",
      "synopsis": "本章梗概 60-100 字"
    }
    // 共 ${opts.chapters} 条
  ]
}

# 要求
- 必须覆盖三幕弧光（诞生 → 与死亡协议对抗 → 续生协议确立）
- 每章独立成立又承接前章
- 行文风格定调：${styleDesc}
- 全书总长度规划约 ${totalLen}
- 章节数严格等于 ${opts.chapters}
` },
        { role: 'user', content: `请生成 ${opts.chapters} 章大纲。` },
    ];
    const { content } = await callLLM(messages);
    const outline = JSON.parse(content);
    if (!Array.isArray(outline.chapters) || outline.chapters.length !== opts.chapters) {
        throw new Error(`大纲章数不匹配：期望 ${opts.chapters}，实际 ${outline.chapters?.length}`);
    }
    return outline;
}

// ── Phase B: 章节扩写 ──────────────────────────────────────
async function generateChapter(opts, storyText, outline, chapterSpec, priorSummaries) {
    const lengthRange = LENGTH_SPECS[opts.length]?.range || '800-1200';
    const styleDesc = STYLE_SPECS[opts.style] || STYLE_SPECS.biography;
    const outlineSummary = outline.chapters
        .map(c => `${c.index}. ${c.title} — ${c.period}: ${c.synopsis}`).join('\n');
    const priorText = priorSummaries.length === 0
        ? '（本章为开篇）'
        : priorSummaries.map((s, i) => `${i + 1}. ${s}`).join('\n');

    const K = opts.imagesPerChapter;
    const messages = [
        { role: 'system', content: `你正在为 Morina 的传记《${outline.title}》撰写第 ${chapterSpec.index} 章。

# 角色视觉锚点（每张配图 prompt 必须英文显式包含这些词）
${VISUAL_ANCHOR_EN}

# 世界观与角色设定
${storyText}

# 全书大纲
书名：《${outline.title}》（${outline.subtitle || ''}）
${outlineSummary}

# 已完成的前文章节梗概
${priorText}

# 当前章节
- 标题：${chapterSpec.title}
- 时空：${chapterSpec.period}
- 类型：${chapterSpec.scene_type}
- 梗概：${chapterSpec.synopsis}

# 写作要求
- 风格：${styleDesc}
- 长度：散文部分总计 ${lengthRange} 字（不含配图）
- 必须正好包含 ${K} 张配图（block.type === "image"）
- 配图穿插在散文之间，不要全部堆在开头或结尾，最少各间隔一段
- prose 段落不要写"插图"等元描述
- 散文中可适度使用台词，但避免标注章节序号或元信息
- 配图 prompt 必须英文 120-180 词，必须显式包含上方角色锚点关键词以及当前场景的具体动作/光影/构图/镜头
- 配图 scene_zh 用一句中文 10-20 字描述这张图

# 输出（严格 JSON，不要解释）
{
  "chapter_title": "章节正式标题（可润色，4-14 字）",
  "summary": "本章 60-100 字梗概，供后续章节参考",
  "blocks": [
    {"type": "prose", "text": "中文散文段落..."},
    {"type": "image", "scene_zh": "...", "prompt": "..."},
    {"type": "prose", "text": "..."},
    ...
  ]
}` },
        { role: 'user', content: `请生成第 ${chapterSpec.index} 章的完整内容（含 ${K} 张配图）。` },
    ];

    const { content } = await callLLM(messages);
    const ch = JSON.parse(content);
    const imgCount = ch.blocks.filter(b => b.type === 'image').length;
    if (imgCount !== K) console.warn(`⚠️ 第 ${chapterSpec.index} 章实际生成 ${imgCount} 张图，期望 ${K}`);
    if (!ch.summary) ch.summary = chapterSpec.synopsis;
    return ch;
}

// ── 信号量（用于图生图并发上限）─────────────────────────────
function createSemaphore(max) {
    let count = 0;
    const waiters = [];
    return {
        async acquire() {
            if (count < max) { count++; return; }
            await new Promise(r => waiters.push(r));
            count++;
        },
        release() {
            count--;
            const next = waiters.shift();
            if (next) next();
        },
    };
}

// ── 渲染 markdown ───────────────────────────────────────────
function renderStoryMarkdown(outline, chapters) {
    const lines = [];
    lines.push(`# 《${outline.title}》`);
    if (outline.subtitle) lines.push(`\n> *${outline.subtitle}*`);
    lines.push('\n---\n');

    for (const ch of chapters) {
        lines.push(`## 第 ${ch.index} 章　${ch.chapter_title || ch.title}`);
        if (ch.period) lines.push(`\n> 时空：${ch.period}\n`);

        let imgCounter = 0;
        for (const block of ch.blocks) {
            if (block.type === 'prose') {
                lines.push('');
                lines.push(block.text.trim());
                lines.push('');
            } else if (block.type === 'image') {
                imgCounter++;
                const filename = block.filename || `${String(ch.index).padStart(2, '0')}_${String(imgCounter).padStart(2, '0')}.png`;
                const status = block.imageStatus || 'pending';
                const alt = block.scene_zh || `第${ch.index}章配图${imgCounter}`;
                lines.push('');
                if (status === 'ok') {
                    lines.push(`![${alt}](images/${filename})`);
                } else {
                    lines.push(`> ⚠️ 配图未生成: ${alt}（${status}）`);
                }
                lines.push(`*插图 ${ch.index}·${imgCounter}：${alt}*`);
                lines.push('');
            }
        }
        lines.push('\n---\n');
    }

    return lines.join('\n').replace(/\n{3,}/g, '\n\n');
}

// ── 主流程 ──────────────────────────────────────────────────
async function main() {
    const opts = parseArgs();

    console.log('📖 Morina 图文人物传记生成器');
    console.log(`   章数: ${opts.chapters} × 配图 ${opts.imagesPerChapter}/章 = ${opts.chapters * opts.imagesPerChapter} 张图`);
    console.log(`   风格: ${opts.style} (${STYLE_SPECS[opts.style] || '默认'})`);
    console.log(`   长度: ${opts.length} (${LENGTH_SPECS[opts.length]?.range || '800-1200'} 字/章)`);
    console.log(`   并发: ${opts.concurrency}`);
    console.log(`   画质/比例: ${opts.quality} / ${opts.aspect}`);
    console.log(`   服务: ${opts.server}`);

    if (!fs.existsSync(opts.anchor)) throw new Error(`主立绘不存在: ${opts.anchor}`);
    const anchorBuf = fs.readFileSync(opts.anchor);
    const anchorBase64 = anchorBuf.toString('base64');
    const mimeType = /\.jpe?g$/i.test(opts.anchor) ? 'image/jpeg' : 'image/png';
    const storyText = loadStory(opts.story);

    const ts = new Date().toISOString().replace(/[-:T.]/g, '').slice(0, 14);
    const outDir = path.join(__dirname, '..', 'oc_stories', `${ts}_morina`);
    const imagesDir = path.join(outDir, 'images');
    const chaptersDir = path.join(outDir, 'chapters');
    fs.mkdirSync(imagesDir,   { recursive: true });
    fs.mkdirSync(chaptersDir, { recursive: true });
    fs.writeFileSync(path.join(outDir, 'meta.json'), JSON.stringify({ ...opts, startedAt: new Date().toISOString() }, null, 2));
    console.log(`📁 输出: ${outDir}\n`);

    const startedAt = Date.now();

    // ── Phase A: 大纲 ──
    console.log('🧭 [A] 生成大纲...');
    const outline = await generateOutline(opts, storyText);
    fs.writeFileSync(path.join(outDir, 'outline.json'), JSON.stringify(outline, null, 2));
    console.log(`📚 《${outline.title}》${outline.subtitle ? ' · ' + outline.subtitle : ''}`);
    outline.chapters.forEach(c => console.log(`   第 ${c.index} 章 ${c.title} · ${c.period} [${c.scene_type}]`));
    console.log();

    // ── Phase B + 内嵌 Phase C: 章节扩写 + 图生图并发 ──
    const sem = createSemaphore(opts.concurrency);
    const imagePromises = [];
    let imgCompleted = 0, imgFailed = 0;
    const totalImages = opts.chapters * opts.imagesPerChapter;

    async function dispatchImage(block, chIdx, imgIdx) {
        const filename = `${String(chIdx).padStart(2, '0')}_${String(imgIdx).padStart(2, '0')}.png`;
        block.filename = filename;
        block.imageStatus = 'pending';

        const task = (async () => {
            await sem.acquire();
            const tag = `[图${chIdx}-${imgIdx}]`;
            console.log(`${tag} 🎨 开始 (${imgCompleted + imgFailed + 1}/${totalImages})`);
            const t0 = Date.now();
            try {
                const imgRes = await editImage({
                    server: opts.server, prompt: block.prompt,
                    imageBase64: anchorBase64, mimeType,
                    quality: opts.quality, aspect: opts.aspect,
                });
                const remoteUrl = imgRes.data?.[0]?.url;
                if (!remoteUrl) throw new Error('响应缺 url');
                const fullUrl = remoteUrl.startsWith('http') ? remoteUrl : `${opts.server.replace(/\/$/, '')}${remoteUrl}`;
                await downloadFile(fullUrl, path.join(imagesDir, filename));
                block.imageStatus = 'ok';
                imgCompleted++;
                console.log(`${tag} ✅ ${((Date.now() - t0) / 1000).toFixed(1)}s → ${filename}`);
            } catch (e) {
                block.imageStatus = `failed: ${e.message}`;
                imgFailed++;
                console.error(`${tag} ❌ ${e.message}`);
            } finally {
                sem.release();
            }
        })();
        imagePromises.push(task);
    }

    console.log(`✍️  [B] 逐章扩写 + [C] 图生图并发 ${opts.concurrency}...\n`);
    const chapters = [];
    for (const spec of outline.chapters) {
        const tag = `[章${spec.index}]`;
        console.log(`${tag} 🧠 gpt-5.5 撰写《${spec.title}》...`);
        const t0 = Date.now();
        let ch;
        try {
            ch = await generateChapter(opts, storyText, outline, spec, chapters.map(c => c.summary));
        } catch (e) {
            console.error(`${tag} ❌ 章节生成失败: ${e.message}`);
            ch = { chapter_title: spec.title, summary: spec.synopsis, blocks: [{ type: 'prose', text: `（本章生成失败：${e.message}）` }] };
        }
        const merged = { ...spec, ...ch };

        // 立即派发本章配图
        let imgIdx = 0;
        for (const block of merged.blocks) {
            if (block.type === 'image') {
                imgIdx++;
                await dispatchImage(block, spec.index, imgIdx);
            }
        }

        chapters.push(merged);
        fs.writeFileSync(path.join(chaptersDir, `${String(spec.index).padStart(2, '0')}.json`), JSON.stringify(merged, null, 2));
        console.log(`${tag} 📝 完成（${((Date.now() - t0) / 1000).toFixed(1)}s）— ${merged.blocks.filter(b => b.type === 'prose').reduce((n, b) => n + b.text.length, 0)} 字 + ${imgIdx} 图\n`);
    }

    console.log(`⏳ 等待 ${imagePromises.length} 张配图全部完成...`);
    await Promise.all(imagePromises);

    // ── Phase D: 拼装 markdown ──
    const md = renderStoryMarkdown(outline, chapters);
    const storyPath = path.join(outDir, 'story.md');
    fs.writeFileSync(storyPath, md);

    const totalTime = ((Date.now() - startedAt) / 1000).toFixed(1);
    const proseChars = chapters.reduce((n, c) => n + c.blocks.filter(b => b.type === 'prose').reduce((m, b) => m + b.text.length, 0), 0);
    console.log(`\n🏁 完成`);
    console.log(`   章节: ${chapters.length}`);
    console.log(`   字数: ${proseChars} 字`);
    console.log(`   配图: ${imgCompleted} 成功 / ${imgFailed} 失败 / ${totalImages} 总计`);
    console.log(`   耗时: ${totalTime}s`);
    console.log(`   📂 ${outDir}`);
    console.log(`   📖 ${storyPath}`);
}

main().catch(e => { console.error('💥', e); process.exit(1); });
