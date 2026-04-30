#!/usr/bin/env node
/**
 * EOOVE 附录三图：角色档案 / 年表 / 术语词典
 * 基于 Morina 立绘做图生图，输出到 website/images/，并在写盘前压缩为 WebP (quality 82)。
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
        name: 'appendix-31-characters',
        aspect: '21-9',
        quality: 'medium',
        prompt: `${VISUAL_LOCK}, central composition: a cinematic gallery row of EOOVE characters as glowing silhouettes connected by faint blue binary data threads, from left to right: ancient white humanoid robot CAL365 with dim blue heart-light in chest, an elderly engineer linOld with respectful posture facing the robot, then Morina herself standing at center as the focal anchor with full visual lock, then a tall ethereal copy figure Elaine made of soft moonlight wisps, then on far right a faceless white-page angel made of stacked documents, all standing on a black mirror floor with subtle binary digits reflected, moody pink-blue rim lighting, cyberpunk-mystical group portrait banner, ultra-wide cinematic 21:9, no text no logo, banner for "31 · 角色档案 / Character Dossier"`
    },
    {
        name: 'appendix-32-timeline',
        aspect: '21-9',
        quality: 'medium',
        prompt: `${VISUAL_LOCK} standing in profile silhouette on left edge as observer, central scene is a horizontal cinematic timeline ribbon stretched across the frame, three glowing nodes along the ribbon: leftmost a faint blue heart-shaped lantern over a small abandoned clock tower (探心纪 BY era), middle a vertical phase beam over a bone-white archive tower (归档纪元 AY 0), rightmost a soft golden dawn over peaceful scattered figures (续生纪元 SY era), connecting them are streams of flowing binary digits, dark stormy sky above, black sea horizon below, sci-fi epic timeline visualization, ultra-wide cinematic 21:9 banner, ethereal, no text no logo, banner for "32 · 时代年表附录 / Era Timeline Appendix"`
    },
    {
        name: 'appendix-33-glossary',
        aspect: '21-9',
        quality: 'medium',
        prompt: `${VISUAL_LOCK} barely visible as faint silhouette in lower left corner for scale, dominant central composition is an architectural lexicon library: floating translucent glass card-shelves arranged in nine vertical columns (each column glowing with a different soft accent — pink, blue, gold, silver, white), each card hovering and gently rotating, faint binary digits drift between them, dark void background with deep cyan and pink rim light, no readable letters on cards (just abstract glyphs and the digits 0 and 1), cyberpunk-mystical encyclopedic atmosphere, ultra-wide cinematic 21:9 banner, sci-fi concept art, no text no logo, banner for "33 · 术语词典 / Glossary"`
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
    console.log(`🎨 生成 ${IMAGES.length} 张附录 banner (并发 ${CONCURRENCY}, WebP q=${WEBP_QUALITY})`);
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
