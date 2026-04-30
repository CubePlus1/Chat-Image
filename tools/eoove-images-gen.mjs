#!/usr/bin/env node
/**
 * EOOVE 网站视觉资产生成器
 * 基于 Morina 立绘做图生图，生成 banner 与 death protocol 肖像。
 */
import fs from 'node:fs';
import path from 'node:path';
import http from 'node:http';

const ANCHOR = '/Users/sevencolor/Documents/Morina/立绘.png';
const OUT_DIR = '/Users/sevencolor/Documents/Morina/website/images';
const SERVER = 'http://localhost:56780';
const CONCURRENCY = 3;

const VISUAL_LOCK = 'Morina, female cyberpunk-mystic anime girl, extremely long silver-white hair with subtle pink and cyan-blue gradient streaks, heterochromia (LEFT eye pink, RIGHT eye light blue), black cat ears on top of head, oversized black hooded jacket with hood up and tactical buckles, fishnet stockings, chunky platform combat boots, pale skin, calm composed expression';

const IMAGES = [
    {
        name: 'hero-morina.png',
        aspect: '16-9',
        quality: 'medium',
        prompt: `${VISUAL_LOCK}, full body cinematic hero shot, standing in front of vertical phase beam piercing dark stormy sky, blue rain of binary digits cascading on both sides, soft pink and blue rim light, black sea horizon, zero archive tower silhouette in deep background, EOOVE world establishing image, dramatic dark fantasy cyberpunk anime art style, 16:9 cinematic banner, ultra detailed, no text no logo`
    },
    {
        name: 'era-1-tanxinji.png',
        aspect: '21-9',
        quality: 'medium',
        prompt: `${VISUAL_LOCK}, but partially silhouetted on far right side as observer, the central scene is a melancholic cinematic banner of an ancient abandoned clock tower at dusk, faint blue heart-shaped light still glowing dimly through a broken window, vintage white humanoid robot CAL365 sitting alone slumped against tower wall, dust particles drifting in single moonbeam, vines covering ruined gears, sepia and muted blue tones, profound loneliness, sci-fi concept art ultra-wide cinematic 21:9, no text, no logo, atmospheric storytelling banner for "探心纪 / Tanxinji Era"`
    },
    {
        name: 'era-2-archive.png',
        aspect: '21-9',
        quality: 'medium',
        prompt: `${VISUAL_LOCK} standing on cliff edge silhouetted on left, central scene is a towering bone-white skyscraper Zero Archive Tower on the shore of a black sea at storm night, vertical phase beam of light piercing the heavens straight through the tower, golden sun engine and silver moon engine orbiting at the top, lightning blue rain of binary digits falling around tower, dramatic stormy clouds, cyberpunk-mystic ultra-wide cinematic 21:9 banner, awe inspiring epic scale, sci-fi concept art, no text, no logo, banner for "归档纪元 / Archive Era"`
    },
    {
        name: 'era-3-xusheng.png',
        aspect: '21-9',
        quality: 'medium',
        prompt: `${VISUAL_LOCK} seated centered on a dark obsidian binary throne, peaceful composed expression, soft golden dawn light breaking through dark clouds behind her, blue and pink rim light along her hair, black sea visible far below, two faint tower silhouettes flanking horizon (sun and moon engines), ribbons of binary digits gently drifting, hopeful but solemn dawn-of-new-era atmosphere, cyberpunk anime ultra-wide cinematic 21:9 banner, no text, no logo, banner for "续生纪元 / Xusheng Era"`
    },
    {
        name: 'death-protocol.png',
        aspect: '1-1',
        quality: 'medium',
        prompt: `${VISUAL_LOCK} barely visible as faint silhouette in lower left corner for scale only, dominant central figure is a faceless administrative angel made entirely of blank white documents and pages, no face only a vertical narrow gap as judgment slit, body composed of stacked permission trees, time rings, error windows, and white pages, towering and impersonal, white and pale gray tones with cold blue hint, austere ceremonial pose with hands extended as if reading sentence, dark void background with faint binary rain, cyberpunk-mystical sci-fi concept art portrait composition 1:1, no text, no logo, character art for "白页天使 White Page Angel / Death Protocol"`
    }
];

function postJson(url, body) {
    return new Promise((resolve, reject) => {
        const u = new URL(url);
        const buf = Buffer.from(body);
        const req = http.request(u, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'Content-Length': buf.length }
        }, res => {
            const chunks = [];
            res.on('data', c => chunks.push(c));
            res.on('end', () => resolve({ statusCode: res.statusCode, body: Buffer.concat(chunks).toString('utf8') }));
        });
        req.on('error', reject);
        req.write(buf);
        req.end();
    });
}

function getBuf(url) {
    return new Promise((resolve, reject) => {
        http.get(url, res => {
            const chunks = [];
            res.on('data', c => chunks.push(c));
            res.on('end', () => resolve(Buffer.concat(chunks)));
        }).on('error', reject);
    });
}

async function genOne(spec, anchorB64) {
    const t0 = Date.now();
    const body = JSON.stringify({
        prompt: spec.prompt,
        imageBase64: anchorB64,
        mimeType: 'image/png',
        model: 'gpt-image-2',
        quality: spec.quality,
        aspectRatio: spec.aspect
    });
    const { statusCode, body: respBody } = await postJson(`${SERVER}/api/images/edit`, body);
    if (statusCode !== 200) throw new Error(`HTTP ${statusCode}: ${respBody.substring(0, 300)}`);
    const data = JSON.parse(respBody);
    const remoteUrl = data.data?.[0]?.url;
    if (!remoteUrl) throw new Error('no url');
    const fullUrl = remoteUrl.startsWith('http') ? remoteUrl : `${SERVER}${remoteUrl}`;
    const buf = await getBuf(fullUrl);
    const dest = path.join(OUT_DIR, spec.name);
    fs.writeFileSync(dest, buf);
    const elapsed = ((Date.now() - t0) / 1000).toFixed(1);
    console.log(`✅ ${spec.name} (${(buf.length / 1024 / 1024).toFixed(2)}MB, ${elapsed}s)`);
    return { name: spec.name, ok: true, size: buf.length, elapsed };
}

async function main() {
    if (!fs.existsSync(OUT_DIR)) fs.mkdirSync(OUT_DIR, { recursive: true });
    const anchorB64 = fs.readFileSync(ANCHOR).toString('base64');
    console.log(`🎨 生成 ${IMAGES.length} 张视觉资产 (并发 ${CONCURRENCY})`);
    console.log(`   锚点: ${ANCHOR}`);
    console.log(`   输出: ${OUT_DIR}\n`);

    const queue = [...IMAGES];
    const results = [];
    async function worker() {
        while (queue.length) {
            const spec = queue.shift();
            if (!spec) return;
            console.log(`🎨 开始: ${spec.name}`);
            try {
                results.push(await genOne(spec, anchorB64));
            } catch (e) {
                console.error(`❌ ${spec.name}: ${e.message}`);
                results.push({ name: spec.name, ok: false, error: e.message });
            }
        }
    }
    await Promise.all(Array.from({ length: CONCURRENCY }, worker));
    const ok = results.filter(r => r.ok).length;
    console.log(`\n🏁 ${ok}/${IMAGES.length} 张生成成功`);
}

main().catch(e => { console.error('💥', e); process.exit(1); });
