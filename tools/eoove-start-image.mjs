#!/usr/bin/env node
/**
 * EOOVE start.html hero banner: 钟楼最后一夜
 * 不依赖 Morina 立绘锚点（这篇是探心纪故事，林老与 CAL365 的私人时刻）。
 * 直接 text-to-image（gpt-image-2 → WebP@82）。
 */
import fs from 'node:fs';
import path from 'node:path';
import http from 'node:http';
import sharp from '/Users/sevencolor/code/0toy/Chat-Image/node_modules/sharp/lib/index.js';

const OUT_DIR = '/Users/sevencolor/Documents/Morina/website/images';
const SERVER = 'http://localhost:56780';
const WEBP_QUALITY = 82;

const SPEC = {
    name: 'start-hero-clocktower',
    aspect: '21:9',
    quality: 'medium',
    prompt: `cinematic ultra-wide film still, interior of a long-abandoned weathered clock tower at night, dust motes drifting in a single shaft of pale blue moonlight from a broken upper window, central focus is a vintage white humanoid robot model "CAL365" sitting against a stone wall, slightly slouched, dim blue heart-shaped light glowing softly through a cracked rectangular gap in its chest plate, faint pink-blue gradient hue around the chest light, an elderly Asian man in his late seventies with short gray hair and round glasses, wearing a simple charcoal coat, sitting on the dusty stone floor beside the robot with his hand resting near the robot's chest, his face partly in shadow with a quiet composed expression, no tears, broken old gears and ivy on the walls, antique grandfather-clock pendulum frozen, distant sound of black sea waves implied through the open window, melancholic dignified atmosphere, sepia and muted blue tones with the only saturated color being the chest light, dark fantasy sci-fi atmosphere reminiscent of 80s Japanese anime cinematography, ultra-wide cinematic 21:9, photorealistic concept art, no text no logo, soft grain, profound loneliness without sentimentality`
};

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

async function main() {
    if (!fs.existsSync(OUT_DIR)) fs.mkdirSync(OUT_DIR, { recursive: true });
    const t0 = Date.now();
    console.log(`🎨 生成 ${SPEC.name}.webp (text-to-image, WebP q=${WEBP_QUALITY})\n`);
    const body = JSON.stringify({
        prompt: SPEC.prompt,
        model: 'gpt-image-2',
        quality: SPEC.quality,
        aspectRatio: SPEC.aspect,
        n: 1
    });
    const { statusCode, body: respBody } = await postJson(`${SERVER}/api/images/generate`, body);
    if (statusCode !== 200) {
        console.error(`❌ HTTP ${statusCode}: ${respBody.substring(0, 400)}`);
        process.exit(1);
    }
    const data = JSON.parse(respBody);
    const remoteUrl = data.data?.[0]?.url;
    if (!remoteUrl) {
        console.error('❌ no url:', respBody.substring(0, 300));
        process.exit(1);
    }
    const fullUrl = remoteUrl.startsWith('http') ? remoteUrl : `${SERVER}${remoteUrl}`;
    const pngBuf = await getBuf(fullUrl);
    const webpBuf = await sharp(pngBuf).webp({ quality: WEBP_QUALITY }).toBuffer();
    const dest = path.join(OUT_DIR, `${SPEC.name}.webp`);
    fs.writeFileSync(dest, webpBuf);
    const elapsed = ((Date.now() - t0) / 1000).toFixed(1);
    const pngMb = (pngBuf.length / 1024 / 1024).toFixed(2);
    const webpMb = (webpBuf.length / 1024 / 1024).toFixed(2);
    const ratio = ((1 - webpBuf.length / pngBuf.length) * 100).toFixed(0);
    console.log(`✅ ${SPEC.name}.webp  PNG ${pngMb}MB → WebP ${webpMb}MB (-${ratio}%, ${elapsed}s)`);
}

main().catch(e => { console.error('💥', e); process.exit(1); });
