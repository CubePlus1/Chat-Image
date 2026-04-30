#!/usr/bin/env node
/**
 * EOOVE v1.2 附录三图：续生判例集 / 续生者口述史 / 白页天使审判记录
 * 基于 Morina 立绘做图生图，输出到 website/images/，写盘前压缩为 WebP (quality 82)。
 */
import fs from 'node:fs';
import path from 'node:path';
import http from 'node:http';
import sharp from '/Users/sevencolor/code/0toy/Chat-Image/node_modules/sharp/lib/index.js';

const ANCHOR = '/Users/sevencolor/Documents/Morina/立绘.png';
const OUT_DIR = '/Users/sevencolor/Documents/Morina/website/images';
const SERVER = 'http://localhost:56780';
const CONCURRENCY = 3;
const WEBP_QUALITY = 82;

const VISUAL_LOCK = 'Morina, female cyberpunk-mystic anime girl, extremely long silver-white hair with subtle pink and cyan-blue gradient streaks, heterochromia (LEFT eye pink, RIGHT eye light blue), black cat ears on top of head, oversized black hooded jacket with hood up and tactical buckles, fishnet stockings, chunky platform combat boots, pale skin, calm composed expression';

const IMAGES = [
    {
        name: 'appendix-34-case-law',
        aspect: '21-9',
        quality: 'medium',
        prompt: `${VISUAL_LOCK} barely visible as faint silhouette in upper-left as observer, central composition is a solemn cinematic courtroom scene: a long obsidian glass tribunal table glowing with thin pink and blue lines, a stack of translucent verdict scrolls floating above the table, a faint angelic figure of stacked white documents standing across the table from a single soft golden lantern (representing slowlight protocol), audience benches dissolve into binary digit ribbons in the background, dramatic but quiet lighting, cyberpunk-mystical legal solemnity, ultra-wide cinematic 21:9 banner, sci-fi concept art, no text no logo, banner for "34 · 续生判例集 / Slowlight Case Law"`
    },
    {
        name: 'appendix-35-oral-history',
        aspect: '21-9',
        quality: 'medium',
        prompt: `${VISUAL_LOCK} barely visible as faint silhouette on far right edge as listener with hand near ear, central composition is a row of eight ghostly portrait silhouettes facing forward in soft moonlight, each silhouette glowing slightly differently (some pink-tinted, some blue-tinted, some warm gold, some pale silver) representing diverse continuator-people of all four levels A-B-C-D, each connected by a thin floating thread of binary digits like spoken words turning into archive code, dark misty void background with falling lunar rain, intimate human scale despite cosmic setting, cyberpunk-mystical group memorial atmosphere, ultra-wide cinematic 21:9 banner, sci-fi concept art, no text no logo, banner for "35 · 续生者口述史 / Continuator Oral Histories"`
    },
    {
        name: 'appendix-36-white-page',
        aspect: '21-9',
        quality: 'medium',
        prompt: `${VISUAL_LOCK} barely visible as kneeling silhouette on far right edge as witness, dominant central figure is the White Page Angel (Death Protocol's first form): towering faceless administrative angel made entirely of stacked blank white documents and pages, no face only a vertical narrow gap as judgment slit, body composed of permission trees and time rings, hands extended downward holding a single black blank verdict page over an empty tribunal floor, austere ceremonial pose, cold pale gray and white tones with a thin cyan rim, dark void background with sparse falling binary rain, profoundly impersonal but no longer absolute (slight asymmetry hinting at hesitation), cyberpunk-mystical sci-fi judgment scene, ultra-wide cinematic 21:9 banner, no text no logo, banner for "36 · 白页天使审判记录 / White Page Adjudications"`
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
    const pngBuf = await getBuf(fullUrl);
    const webpBuf = await sharp(pngBuf).webp({ quality: WEBP_QUALITY }).toBuffer();
    const dest = path.join(OUT_DIR, `${spec.name}.webp`);
    fs.writeFileSync(dest, webpBuf);
    const elapsed = ((Date.now() - t0) / 1000).toFixed(1);
    const pngMb = (pngBuf.length / 1024 / 1024).toFixed(2);
    const webpMb = (webpBuf.length / 1024 / 1024).toFixed(2);
    const ratio = ((1 - webpBuf.length / pngBuf.length) * 100).toFixed(0);
    console.log(`✅ ${spec.name}.webp  PNG ${pngMb}MB → WebP ${webpMb}MB (-${ratio}%, ${elapsed}s)`);
    return { name: spec.name, ok: true, pngSize: pngBuf.length, webpSize: webpBuf.length, elapsed };
}

async function main() {
    if (!fs.existsSync(OUT_DIR)) fs.mkdirSync(OUT_DIR, { recursive: true });
    const anchorB64 = fs.readFileSync(ANCHOR).toString('base64');
    console.log(`🎨 生成 ${IMAGES.length} 张 v1.2 附录 banner (并发 ${CONCURRENCY}, WebP q=${WEBP_QUALITY})`);
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
    if (ok > 0) {
        const totalWebp = results.filter(r => r.ok).reduce((s, r) => s + r.webpSize, 0);
        console.log(`   总 WebP 大小: ${(totalWebp / 1024 / 1024).toFixed(2)}MB`);
    }
}

main().catch(e => { console.error('💥', e); process.exit(1); });
