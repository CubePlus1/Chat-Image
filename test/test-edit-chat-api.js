const http = require('http');
const fs = require('fs');
const path = require('path');

const IMAGE_PATH = path.join(__dirname, 'JM.jpg');
const imageData = fs.readFileSync(IMAGE_PATH);
const base64Data = imageData.toString('base64');

console.log(`图片大小: ${(imageData.length / 1024).toFixed(1)} KB`);
console.log(`Base64长度: ${(base64Data.length / 1024).toFixed(1)} KB`);

// 构建 Chat API 格式的请求（和前端一样的格式）
const requestBody = JSON.stringify({
    model: 'gemini-3.1-flash-image',
    imageSize: '4K',
    messages: [{
        role: 'user',
        content: [
            {
                type: 'image_url',
                image_url: {
                    url: `data:image/jpeg;base64,${base64Data}`
                }
            },
            {
                type: 'text',
                text: '把这张图片变成水彩画风格'
            }
        ]
    }]
});

const bodyBuffer = Buffer.from(requestBody);
console.log(`请求体大小: ${(bodyBuffer.length / 1024).toFixed(1)} KB`);
console.log('发送到 /api/images/edit (代理) ...');

const req = http.request({
    hostname: '127.0.0.1',
    port: 56780,
    path: '/api/images/edit',
    method: 'POST',
    headers: {
        'Content-Type': 'application/json',
        'Content-Length': bodyBuffer.length,
        'Authorization': 'Bearer sk-antigravity'
    }
}, (res) => {
    const chunks = [];
    res.on('data', c => chunks.push(c));
    res.on('end', () => {
        const body = Buffer.concat(chunks).toString();
        console.log(`\n响应状态: ${res.statusCode}`);

        try {
            const data = JSON.parse(body);

            // Chat API 格式
            if (data.choices && data.choices[0]) {
                const content = data.choices[0].message.content;
                console.log(`响应内容长度: ${content.length} 字符`);

                // 检查是否有图片
                const hasBase64 = content.includes('data:image/');
                const hasUrl = content.includes('/images/');
                console.log(`包含 base64 图片: ${hasBase64}`);
                console.log(`包含 URL 图片: ${hasUrl}`);

                if (hasUrl) {
                    const urlMatch = content.match(/\/images\/[^\s)"]+/);
                    if (urlMatch) console.log(`图片 URL: ${urlMatch[0]}`);
                }

                console.log('\n✅ Chat API 格式响应成功！图生图走 Chat API 可行。');
            }
            // Images API 格式 (不应该出现)
            else if (data.data) {
                console.log('⚠️ 收到 Images API 格式响应（不期望）');
            }
            // 错误
            else if (data.error) {
                console.log(`❌ 错误: ${JSON.stringify(data.error)}`);
            }
            else {
                console.log('⚠️ 未识别的响应格式');
                console.log(body.substring(0, 500));
            }
        } catch (e) {
            console.log('❌ JSON 解析失败:', e.message);
            console.log('原始响应前300字符:', body.substring(0, 300));
        }
    });
});

req.on('error', e => {
    console.log(`❌ 请求失败: ${e.message}`);
    console.log('确认 server.js 在运行 (port 56780)');
});

req.write(bodyBuffer);
req.end();
