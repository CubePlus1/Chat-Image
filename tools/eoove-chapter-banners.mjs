#!/usr/bin/env node
/**
 * EOOVE 章节 banner 批量生成器
 * 用法: node eoove-chapter-banners.mjs <jobs.json>
 *   jobs.json 示例：
 *     [
 *       { "name": "story-tanxinji-01", "prompt": "...", "aspect": "21:9" },
 *       ...
 *     ]
 */
import fs from 'node:fs';
import path from 'node:path';
import http from 'node:http';
import sharp from '/Users/sevencolor/code/0toy/Chat-Image/node_modules/sharp/lib/index.js';

const OUT_DIR = '/Users/sevencolor/Documents/Morina/website/images';
const SERVER = 'http://localhost:56780';
const CONCURRENCY = 3;
const WEBP_QUALITY = 82;

const jobsPath = process.argv[2];
if (!jobsPath) {
    console.error('Usage: node eoove-chapter-banners.mjs <jobs.json>');
    process.exit(1);
}
const IMAGES = JSON.parse(fs.readFileSync(jobsPath, 'utf8'));

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

async function genOne(spec) {
    const t0 = Date.now();
    const body = JSON.stringify({
        prompt: spec.prompt,
        model: 'gpt-image-2',
        quality: spec.quality || 'medium',
        aspectRatio: spec.aspect || '21:9',
        n: 1
    });
    const { statusCode, body: respBody } = await postJson(`${SERVER}/api/images/generate`, body);
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
    const webpKb = (webpBuf.length / 1024).toFixed(0);
    console.log(`✅ ${spec.name}.webp  ${webpKb}KB ${elapsed}s`);
    return { name: spec.name, ok: true, size: webpBuf.length, elapsed };
}

async function main() {
    if (!fs.existsSync(OUT_DIR)) fs.mkdirSync(OUT_DIR, { recursive: true });
    console.log(`🎨 ${IMAGES.length} 张章节 banner (并发 ${CONCURRENCY}, WebP q=${WEBP_QUALITY})\n`);

    const queue = [...IMAGES];
    const results = [];
    async function worker() {
        while (queue.length) {
            const spec = queue.shift();
            if (!spec) return;
            console.log(`🎨 ${spec.name}`);
            try { results.push(await genOne(spec)); }
            catch (e) {
                console.error(`❌ ${spec.name}: ${e.message}`);
                results.push({ name: spec.name, ok: false, error: e.message });
            }
        }
    }
    await Promise.all(Array.from({ length: CONCURRENCY }, worker));
    const ok = results.filter(r => r.ok).length;
    console.log(`\n🏁 ${ok}/${IMAGES.length} 完成`);
}

main().catch(e => { console.error('💥', e); process.exit(1); });
