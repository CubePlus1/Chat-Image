const http = require('http');
const fs = require('fs');
const path = require('path');

const API_KEY = 'sk-antigravity';
const OUTPUT_DIR = path.join(__dirname, 'output');
const IMAGE_PATH = path.join(__dirname, 'JM.jpg');

if (!fs.existsSync(OUTPUT_DIR)) fs.mkdirSync(OUTPUT_DIR, { recursive: true });

// 手动构建 multipart/form-data
function buildMultipart(fields, files) {
    const boundary = '----FormBoundary' + Date.now().toString(36);
    const parts = [];

    for (const [name, value] of Object.entries(fields)) {
        parts.push(
            `--${boundary}\r\n` +
            `Content-Disposition: form-data; name="${name}"\r\n\r\n` +
            `${value}\r\n`
        );
    }

    for (const { name, filename, contentType, data } of files) {
        parts.push(
            `--${boundary}\r\n` +
            `Content-Disposition: form-data; name="${name}"; filename="${filename}"\r\n` +
            `Content-Type: ${contentType}\r\n\r\n`
        );
        parts.push(data);
        parts.push('\r\n');
    }

    parts.push(`--${boundary}--\r\n`);

    // 合并为 Buffer
    const buffers = parts.map(p => typeof p === 'string' ? Buffer.from(p) : p);
    return {
        body: Buffer.concat(buffers),
        contentType: `multipart/form-data; boundary=${boundary}`
    };
}

// 从 PNG/JPEG buffer 读取宽高
function readDimensions(buf) {
    if (buf[0] === 0x89 && buf[1] === 0x50) {
        // PNG
        return { width: buf.readUInt32BE(16), height: buf.readUInt32BE(20) };
    }
    if (buf[0] === 0xFF && buf[1] === 0xD8) {
        // JPEG
        let offset = 2;
        while (offset < buf.length - 9) {
            if (buf[offset] !== 0xFF) { offset++; continue; }
            const marker = buf[offset + 1];
            if (marker === 0xC0 || marker === 0xC2) {
                return { width: buf.readUInt16BE(offset + 7), height: buf.readUInt16BE(offset + 5) };
            }
            offset += 2 + buf.readUInt16BE(offset + 2);
        }
    }
    // WebP
    if (buf.slice(0, 4).toString() === 'RIFF' && buf.slice(8, 12).toString() === 'WEBP') {
        if (buf.slice(12, 16).toString() === 'VP8 ') {
            return { width: buf.readUInt16LE(26) & 0x3FFF, height: buf.readUInt16LE(28) & 0x3FFF };
        }
    }
    return null;
}

function doRequest(host, port, urlPath, body, contentType) {
    return new Promise((resolve) => {
        const req = http.request({
            hostname: host, port, path: urlPath, method: 'POST',
            headers: {
                'Content-Type': contentType,
                'Content-Length': body.length,
                'Authorization': `Bearer ${API_KEY}`
            }
        }, (res) => {
            const chunks = [];
            res.on('data', c => chunks.push(c));
            res.on('end', () => resolve({ status: res.statusCode, body: Buffer.concat(chunks).toString() }));
        });
        req.on('error', e => resolve({ status: 0, body: JSON.stringify({ error: e.message }) }));
        req.write(body);
        req.end();
    });
}

async function testImageEdit(label, host, port, urlPath, prefix) {
    console.log(`\n${'='.repeat(50)}`);
    console.log(`[${label}] 图生图测试 → ${host}:${port}${urlPath}`);
    console.log('='.repeat(50));

    const imageData = fs.readFileSync(IMAGE_PATH);
    const dims = readDimensions(imageData);
    console.log(`输入图片: JM.jpg (${(imageData.length / 1024 / 1024).toFixed(2)} MB, ${dims ? dims.width + 'x' + dims.height : '?'})`);

    const { body: reqBody, contentType } = buildMultipart(
        {
            prompt: '把这张图片变成宫崎骏动漫风格',
            model: 'gemini-3.1-flash-image',
            size: '1920x1080',
            quality: 'hd',
            imageSize: '4K'
        },
        [{
            name: 'image',
            filename: 'JM.jpg',
            contentType: 'image/jpeg',
            data: imageData
        }]
    );

    console.log(`FormData 字段: model, prompt, size=1920x1080, quality=hd, imageSize=4K`);
    console.log(`请求大小: ${(reqBody.length / 1024 / 1024).toFixed(2)} MB`);
    console.log('发送请求中...');

    const resp = await doRequest(host, port, urlPath, reqBody, contentType);
    console.log(`响应状态: ${resp.status}`);

    try {
        const data = JSON.parse(resp.body);

        // 保存 JSON（截断 base64）
        const summary = JSON.parse(JSON.stringify(data));
        let hasB64 = false;
        if (summary.data) {
            summary.data.forEach((item, i) => {
                if (item.b64_json) {
                    hasB64 = true;
                    summary.data[i]._b64_length = item.b64_json.length;
                    summary.data[i]._b64_bytes_approx = Math.round(item.b64_json.length * 3 / 4);
                    summary.data[i]._b64_mb = (item.b64_json.length * 3 / 4 / 1024 / 1024).toFixed(2);
                    summary.data[i].b64_json = item.b64_json.substring(0, 100) + '...[TRUNCATED]';
                }
            });
        }
        fs.writeFileSync(path.join(OUTPUT_DIR, `${prefix}_response.json`), JSON.stringify(summary, null, 2));
        console.log(`响应 JSON 已保存: output/${prefix}_response.json`);

        if (data.data && data.data[0]) {
            const item = data.data[0];

            // 有 b64_json → 解码并检查
            if (item.b64_json) {
                const imgBuf = Buffer.from(item.b64_json, 'base64');
                const imgPath = path.join(OUTPUT_DIR, `${prefix}_image.png`);
                fs.writeFileSync(imgPath, imgBuf);
                const sizeMB = (imgBuf.length / 1024 / 1024).toFixed(2);
                const d = readDimensions(imgBuf);
                console.log(`解码图片: output/${prefix}_image.png (${sizeMB} MB)`);
                if (d) {
                    console.log(`分辨率: ${d.width} x ${d.height}`);
                    const is4K = d.width >= 3840 || d.height >= 3840;
                    console.log(is4K ? '✅ 是 4K!' : `❌ 不是 4K (${d.width}x${d.height})`);
                }
                return { dims: d, sizeMB, source: 'b64' };
            }

            // 有 url → 说明被 proxy 替换了
            if (item.url) {
                console.log(`返回 URL: ${item.url}`);
                const isOriginal = item.url.includes('/original/');
                const isPreview = item.url.includes('/preview/');
                console.log(isOriginal ? '✅ URL 指向 original' : isPreview ? '❌ URL 指向 preview (压缩版!)' : `⚠️ 路径: ${item.url}`);
                return { url: item.url, isOriginal, source: 'url' };
            }

            console.log('⚠️ data[0] 既没有 b64_json 也没有 url');
            console.log('data[0] keys:', Object.keys(item));
        } else if (data.error) {
            console.log(`❌ API 错误: ${JSON.stringify(data.error)}`);
        }
    } catch (e) {
        console.error('解析响应失败:', e.message);
        fs.writeFileSync(path.join(OUTPUT_DIR, `${prefix}_raw.txt`), resp.body.substring(0, 10000));
        console.log(`原始响应已保存: output/${prefix}_raw.txt`);
    }
    return null;
}

(async () => {
    console.log('🔍 图生图 4K 测试 (JM.jpg)\n');
    console.log('时间:', new Date().toISOString());

    if (!fs.existsSync(IMAGE_PATH)) {
        console.error(`❌ 找不到测试图片: ${IMAGE_PATH}`);
        process.exit(1);
    }

    // 测试 1: 直接请求上游
    const upstream = await testImageEdit('上游直连', '127.0.0.1', 58045, '/v1/images/edits', 'edit_1_upstream');

    // 测试 2: 通过 server.js 代理
    const proxy = await testImageEdit('代理转发', '127.0.0.1', 56780, '/api/images/edit', 'edit_2_proxy');

    // 汇总
    console.log('\n' + '='.repeat(50));
    console.log('📊 汇总');
    console.log('='.repeat(50));

    if (upstream) {
        if (upstream.dims) {
            const d = upstream.dims;
            const is4K = d.width >= 3840 || d.height >= 3840;
            console.log(`上游原始返回: ${d.width}x${d.height} (${upstream.sizeMB} MB) → ${is4K ? '✅ 4K' : '❌ 非4K'}`);
            if (!is4K) {
                console.log('   → 说明上游 /v1/images/edits 没有支持 imageSize 参数，图生图不走 4K');
            }
        }
    }

    if (proxy) {
        if (proxy.url) {
            console.log(`代理返回 URL: ${proxy.url} → ${proxy.isOriginal ? '✅ 原图' : '❌ 压缩版'}`);
        } else if (proxy.dims) {
            const d = proxy.dims;
            console.log(`代理返回图片: ${d.width}x${d.height} (${proxy.sizeMB} MB)`);
        }
    }

    console.log('\n✅ 测试完成');
})();
