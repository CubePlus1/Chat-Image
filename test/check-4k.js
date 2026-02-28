const http = require('http');
const fs = require('fs');
const path = require('path');

const API_BASE = 'http://127.0.0.1:56780';
const API_KEY = 'sk-antigravity';
const OUTPUT_DIR = path.join(__dirname, 'output');

if (!fs.existsSync(OUTPUT_DIR)) {
    fs.mkdirSync(OUTPUT_DIR, { recursive: true });
}

// 1) 直接请求上游 API（跳过 server.js），检查原始返回
function testUpstream() {
    return new Promise((resolve, reject) => {
        const payload = JSON.stringify({
            model: 'gemini-3.1-flash-image',
            prompt: 'a cute cat sitting on a windowsill, photorealistic',
            size: '1920x1080',
            quality: 'hd',
            imageSize: '4K',
            n: 1,
            response_format: 'b64_json'
        });

        console.log('========================================');
        console.log('[1] 直接请求上游 API (127.0.0.1:58045)');
        console.log('========================================');
        console.log('请求参数:', JSON.stringify({ size: '1920x1080', quality: 'hd', imageSize: '4K' }));

        const req = http.request('http://127.0.0.1:58045/v1/images/generations', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${API_KEY}`
            }
        }, (res) => {
            const chunks = [];
            res.on('data', chunk => chunks.push(chunk));
            res.on('end', () => {
                const body = Buffer.concat(chunks).toString();
                console.log(`上游响应状态: ${res.statusCode}`);

                // 保存原始 JSON（base64 截断，避免文件太大）
                try {
                    const data = JSON.parse(body);
                    const summary = JSON.parse(JSON.stringify(data));
                    if (summary.data) {
                        summary.data.forEach((item, i) => {
                            if (item.b64_json) {
                                const b64 = item.b64_json;
                                summary.data[i]._b64_length = b64.length;
                                summary.data[i]._b64_bytes = Math.round(b64.length * 3 / 4);
                                summary.data[i].b64_json = b64.substring(0, 100) + '...[TRUNCATED]';
                            }
                        });
                    }
                    fs.writeFileSync(path.join(OUTPUT_DIR, '1_upstream_response.json'), JSON.stringify(summary, null, 2));
                    console.log('原始响应摘要已保存: output/1_upstream_response.json');

                    // 解码图片并检查分辨率
                    if (data.data && data.data[0] && data.data[0].b64_json) {
                        const imgBuf = Buffer.from(data.data[0].b64_json, 'base64');
                        const imgPath = path.join(OUTPUT_DIR, '1_upstream_image.png');
                        fs.writeFileSync(imgPath, imgBuf);
                        const sizeMB = (imgBuf.length / 1024 / 1024).toFixed(2);
                        console.log(`图片已保存: output/1_upstream_image.png (${sizeMB} MB)`);

                        // 读 PNG header 获取分辨率
                        const dims = readPngDimensions(imgBuf);
                        if (dims) {
                            console.log(`分辨率: ${dims.width} x ${dims.height}`);
                            const is4K = dims.width >= 3840 || dims.height >= 3840;
                            console.log(is4K ? '✅ 是 4K 图片!' : `❌ 不是 4K (${dims.width}x${dims.height})`);
                        }
                    } else {
                        console.log('⚠️ 上游没有返回 b64_json 数据');
                        console.log('响应 keys:', Object.keys(data));
                        if (data.data) console.log('data[0] keys:', Object.keys(data.data[0] || {}));
                    }
                } catch (e) {
                    console.error('解析失败:', e.message);
                    fs.writeFileSync(path.join(OUTPUT_DIR, '1_upstream_raw.txt'), body.substring(0, 5000));
                }
                resolve();
            });
        });
        req.on('error', e => { console.error('上游请求失败:', e.message); resolve(); });
        req.write(payload);
        req.end();
    });
}

// 2) 请求 server.js 代理，检查代理返回
function testProxy() {
    return new Promise((resolve, reject) => {
        const payload = JSON.stringify({
            model: 'gemini-3.1-flash-image',
            prompt: 'a cute cat sitting on a windowsill, photorealistic',
            size: '1920x1080',
            quality: 'hd',
            imageSize: '4K',
            n: 1,
            response_format: 'b64_json'
        });

        console.log('\n========================================');
        console.log('[2] 请求 server.js 代理 (127.0.0.1:56780)');
        console.log('========================================');

        const req = http.request(`${API_BASE}/api/images/generate`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${API_KEY}`
            }
        }, (res) => {
            const chunks = [];
            res.on('data', chunk => chunks.push(chunk));
            res.on('end', () => {
                const body = Buffer.concat(chunks).toString();
                console.log(`代理响应状态: ${res.statusCode}`);

                try {
                    const data = JSON.parse(body);
                    fs.writeFileSync(path.join(OUTPUT_DIR, '2_proxy_response.json'), JSON.stringify(data, null, 2));
                    console.log('代理响应已保存: output/2_proxy_response.json');

                    if (data.data && data.data[0]) {
                        const item = data.data[0];
                        if (item.url) {
                            console.log(`返回的图片 URL: ${item.url}`);
                            const isOriginal = item.url.includes('/original/');
                            const isPreview = item.url.includes('/preview/');
                            console.log(isOriginal ? '✅ URL 指向 original (未压缩)' : isPreview ? '❌ URL 指向 preview (被压缩到 1920px!)' : `⚠️ URL 路径: ${item.url}`);

                            // 下载这个 URL 检查实际图片
                            downloadAndCheck(item.url, '2_proxy_image.png', resolve);
                            return;
                        } else if (item.b64_json) {
                            console.log('⚠️ 代理返回了 b64_json（没有替换成 URL）');
                            const imgBuf = Buffer.from(item.b64_json, 'base64');
                            const dims = readPngDimensions(imgBuf);
                            if (dims) console.log(`b64 图片分辨率: ${dims.width} x ${dims.height}`);
                        }
                    }
                } catch (e) {
                    console.error('解析失败:', e.message);
                    fs.writeFileSync(path.join(OUTPUT_DIR, '2_proxy_raw.txt'), body.substring(0, 5000));
                }
                resolve();
            });
        });
        req.on('error', e => { console.error('代理请求失败:', e.message); resolve(); });
        req.write(payload);
        req.end();
    });
}

// 下载图片 URL 并检查分辨率
function downloadAndCheck(urlPath, filename, callback) {
    const req = http.get(`${API_BASE}${urlPath}`, (res) => {
        const chunks = [];
        res.on('data', chunk => chunks.push(chunk));
        res.on('end', () => {
            const imgBuf = Buffer.concat(chunks);
            const imgPath = path.join(OUTPUT_DIR, filename);
            fs.writeFileSync(imgPath, imgBuf);
            const sizeMB = (imgBuf.length / 1024 / 1024).toFixed(2);
            console.log(`下载图片: output/${filename} (${sizeMB} MB)`);

            const dims = readPngDimensions(imgBuf);
            if (dims) {
                console.log(`分辨率: ${dims.width} x ${dims.height}`);
                const is4K = dims.width >= 3840 || dims.height >= 3840;
                console.log(is4K ? '✅ 是 4K 图片!' : `❌ 不是 4K (${dims.width}x${dims.height})`);
            } else {
                console.log('⚠️ 无法读取 PNG 分辨率');
            }
            callback();
        });
    });
    req.on('error', e => { console.error('下载失败:', e.message); callback(); });
}

// 从 PNG buffer 读取宽高（解析 IHDR chunk）
function readPngDimensions(buf) {
    try {
        // PNG signature: 8 bytes, then IHDR chunk
        // IHDR starts at offset 8: 4 bytes length + 4 bytes "IHDR" + 4 bytes width + 4 bytes height
        if (buf.length < 24) return null;
        // Check PNG signature
        if (buf[0] !== 0x89 || buf[1] !== 0x50 || buf[2] !== 0x4E || buf[3] !== 0x47) {
            // Not PNG, try JPEG
            return readJpegDimensions(buf);
        }
        const width = buf.readUInt32BE(16);
        const height = buf.readUInt32BE(20);
        return { width, height };
    } catch (e) {
        return null;
    }
}

// 从 JPEG buffer 读取宽高
function readJpegDimensions(buf) {
    try {
        if (buf[0] !== 0xFF || buf[1] !== 0xD8) return null;
        let offset = 2;
        while (offset < buf.length - 1) {
            if (buf[offset] !== 0xFF) { offset++; continue; }
            const marker = buf[offset + 1];
            if (marker === 0xC0 || marker === 0xC2) {
                const height = buf.readUInt16BE(offset + 5);
                const width = buf.readUInt16BE(offset + 7);
                return { width, height };
            }
            const segLen = buf.readUInt16BE(offset + 2);
            offset += 2 + segLen;
        }
        return null;
    } catch (e) {
        return null;
    }
}

// 3) 对比 original vs preview
function testOriginalVsPreview() {
    return new Promise((resolve) => {
        // 找最新的 data 文件夹
        const dataDir = path.join(__dirname, '..', 'data');
        if (!fs.existsSync(dataDir)) {
            console.log('\n⚠️ data 目录不存在，跳过 original vs preview 对比');
            resolve();
            return;
        }

        const folders = fs.readdirSync(dataDir).sort().reverse();
        if (folders.length === 0) {
            console.log('\n⚠️ data 目录为空');
            resolve();
            return;
        }

        const latest = folders[0];
        console.log(`\n========================================`);
        console.log(`[3] 对比最新保存: data/${latest}`);
        console.log(`========================================`);

        const origPath = path.join(dataDir, latest, 'image_0.png');
        const previewPath = path.join(dataDir, latest, 'preview', 'image_0.png');
        const thumbPath = path.join(dataDir, latest, 'thumbnail', 'image_0.png');

        const checks = [
            { label: 'original (原图)', path: origPath },
            { label: 'preview  (预览)', path: previewPath },
            { label: 'thumbnail(缩略)', path: thumbPath },
        ];

        const report = {};
        checks.forEach(({ label, path: p }) => {
            if (fs.existsSync(p)) {
                const buf = fs.readFileSync(p);
                const dims = readPngDimensions(buf);
                const sizeMB = (buf.length / 1024 / 1024).toFixed(2);
                const info = dims ? `${dims.width}x${dims.height}, ${sizeMB} MB` : `${sizeMB} MB (无法读取分辨率)`;
                console.log(`  ${label}: ${info}`);
                report[label] = { dimensions: dims, sizeMB };
            } else {
                console.log(`  ${label}: ❌ 文件不存在`);
                report[label] = null;
            }
        });

        fs.writeFileSync(path.join(OUTPUT_DIR, '3_comparison.json'), JSON.stringify(report, null, 2));
        console.log('对比结果已保存: output/3_comparison.json');

        // 判断
        if (report['original (原图)'] && report['original (原图)'].dimensions) {
            const d = report['original (原图)'].dimensions;
            const is4K = d.width >= 3840 || d.height >= 3840;
            console.log(`\n结论: 原图 ${d.width}x${d.height} → ${is4K ? '✅ 上游返回了 4K' : '❌ 上游没有返回 4K，问题在上游 API'}`);
        }

        resolve();
    });
}

// 运行
(async () => {
    console.log('🔍 4K 图片分辨率检查工具\n');
    console.log('时间:', new Date().toISOString());
    console.log('');

    await testUpstream();
    await testProxy();
    await testOriginalVsPreview();

    console.log('\n========================================');
    console.log('✅ 测试完成，所有数据保存在 test/output/');
    console.log('========================================');
})();
