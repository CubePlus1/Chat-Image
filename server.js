const http = require('http');
const fs = require('fs');
const path = require('path');
const sharp = require('sharp');

const PORT = 8000;
const API_TARGET = 'http://127.0.0.1:8045'; // 本地AI API地址

// 数据存储目录
const DATA_DIR = path.join(__dirname, 'data');

// 日志目录
const LOG_DIR = path.join(__dirname, 'logs');

// 创建目录结构
function initDirectories() {
    if (!fs.existsSync(DATA_DIR)) {
        fs.mkdirSync(DATA_DIR, { recursive: true });
        console.log(`📁 创建目录: ${DATA_DIR}`);
    }
    if (!fs.existsSync(LOG_DIR)) {
        fs.mkdirSync(LOG_DIR, { recursive: true });
        console.log(`📁 创建日志目录: ${LOG_DIR}`);
    }
}

// 图片压缩配置
const COMPRESSION_CONFIGS = {
    thumbnail: { width: 200, quality: 60 },
    preview: { width: 800, quality: 70 },
    original: null // 保持原样
};

// 压缩图片函数
async function compressImage(inputBuffer, quality) {
    try {
        const config = COMPRESSION_CONFIGS[quality];
        if (!config) {
            // original质量，直接返回原始buffer
            return inputBuffer;
        }

        return await sharp(inputBuffer)
            .resize(config.width, null, {
                fit: 'inside',
                withoutEnlargement: true
            })
            .jpeg({ quality: config.quality })
            .toBuffer();
    } catch (error) {
        console.error(`⚠️ 图片压缩失败 (${quality}):`, error.message);
        return inputBuffer; // 压缩失败时返回原图
    }
}

// 异步生成压缩图片
async function generateCompressedImages(folderPath, filename, imageBuffer) {
    const tasks = ['thumbnail', 'preview'].map(async (quality) => {
        try {
            const qualityDir = path.join(folderPath, quality);
            if (!fs.existsSync(qualityDir)) {
                fs.mkdirSync(qualityDir, { recursive: true });
            }

            const compressedBuffer = await compressImage(imageBuffer, quality);
            const outputPath = path.join(qualityDir, filename);
            fs.writeFileSync(outputPath, compressedBuffer);
        } catch (error) {
            console.error(`⚠️ 生成${quality}图片失败:`, error.message);
        }
    });

    await Promise.all(tasks);
}

// 生成时间戳文件夹名（格式：20250203_143052）
function getTimestampFolder() {
    const now = new Date();
    return now.toISOString()
        .replace(/T/, '_')
        .replace(/\..+/, '')
        .replace(/:/g, '')
        .replace(/_/g, '_')
        .substring(0, 15); // 20250203_143052
}

// 保存单次生成的所有数据到时间戳文件夹（返回文件夹名和图片URLs）
async function saveGenerationData(prompt, base64Images, clientIP, parameters, apiStatus) {
    try {
        const folderName = getTimestampFolder();
        const folderPath = path.join(DATA_DIR, folderName);

        // 创建时间戳文件夹
        if (!fs.existsSync(folderPath)) {
            fs.mkdirSync(folderPath, { recursive: true });
        }

        const generatedImages = [];
        const imageUrls = [];

        // 保存所有图片并生成压缩版本
        for (let index = 0; index < base64Images.length; index++) {
            const base64Data = base64Images[index];
            const imageFilename = `image_${index}.png`;
            const imagePath = path.join(folderPath, imageFilename);
            const imageBuffer = Buffer.from(base64Data, 'base64');

            // 保存原图
            fs.writeFileSync(imagePath, imageBuffer);
            generatedImages.push(imageFilename);

            // 生成图片URL
            const imageUrl = `/images/${folderName}/preview/${imageFilename}`;
            imageUrls.push(imageUrl);

            // 异步生成压缩图片（不阻塞）
            generateCompressedImages(folderPath, imageFilename, imageBuffer).catch(err => {
                console.error(`⚠️ 压缩图片失败 ${imageFilename}:`, err.message);
            });
        }

        // 保存提示词
        const promptPath = path.join(folderPath, 'prompt.txt');
        fs.writeFileSync(promptPath, prompt, 'utf8');

        // 保存元数据（不含base64数据）
        const metadata = {
            timestamp: new Date().toISOString(),
            clientIP: clientIP,
            prompt: prompt,
            parameters: parameters,
            generatedImages: generatedImages,
            imageUrls: imageUrls,
            apiResponseStatus: apiStatus
        };
        const metadataPath = path.join(folderPath, 'metadata.json');
        fs.writeFileSync(metadataPath, JSON.stringify(metadata, null, 2), 'utf8');

        console.log(`✅ 数据已保存到: ${folderName} (${generatedImages.length}张图片)`);

        return { folderName, imageUrls };
    } catch (error) {
        console.error('⚠️ 保存数据失败（不影响前端）:', error);
        return null;
    }
}

// 获取客户端IP
function getClientIP(req) {
    return req.headers['x-forwarded-for']?.split(',')[0] ||
           req.headers['x-real-ip'] ||
           req.socket.remoteAddress ||
           'unknown';
}

// 获取MIME类型
function getMimeType(filename) {
    const ext = path.extname(filename).toLowerCase();
    const mimeTypes = {
        '.png': 'image/png',
        '.jpg': 'image/jpeg',
        '.jpeg': 'image/jpeg',
        '.gif': 'image/gif',
        '.webp': 'image/webp',
        '.bmp': 'image/bmp'
    };
    return mimeTypes[ext] || 'application/octet-stream';
}

// 日志记录函数
function writeLog(req, res, startTime, statusCode) {
    try {
        // 排除HTML文件请求
        if (req.url === '/' || req.url === '/index.html' || req.url.endsWith('.html')) {
            return;
        }

        // 计算响应时间
        const duration = Date.now() - startTime;

        // 获取当前日期和时间
        const now = new Date();
        const dateStr = now.toISOString().split('T')[0]; // YYYY-MM-DD
        const timeStr = now.toTimeString().split(' ')[0]; // HH:MM:SS

        // 获取客户端IP
        const clientIP = getClientIP(req);

        // 构建日志内容
        const logEntry = `[${dateStr} ${timeStr}] ${clientIP} ${req.method} ${req.url} ${statusCode} ${duration}ms\n`;

        // 日志文件路径
        const logFilePath = path.join(LOG_DIR, `${dateStr}.log`);

        // 异步追加写入日志
        fs.appendFile(logFilePath, logEntry, 'utf8', (err) => {
            if (err) {
                console.error('⚠️ 日志写入失败:', err.message);
            }
        });
    } catch (error) {
        console.error('⚠️ 日志记录异常:', error.message);
    }
}

// 获取历史记录
function getHistoryData() {
    try {
        if (!fs.existsSync(DATA_DIR)) {
            return [];
        }

        const folders = fs.readdirSync(DATA_DIR)
            .filter(name => {
                const folderPath = path.join(DATA_DIR, name);
                return fs.statSync(folderPath).isDirectory();
            })
            .sort()
            .reverse(); // 最新的在前

        const history = folders.map(folderName => {
            const metadataPath = path.join(DATA_DIR, folderName, 'metadata.json');

            if (fs.existsSync(metadataPath)) {
                try {
                    const metadata = JSON.parse(fs.readFileSync(metadataPath, 'utf8'));

                    // 生成缩略图URLs
                    const thumbnailUrls = (metadata.generatedImages || []).map((filename, index) => {
                        return `/images/${folderName}/thumbnail/${filename}`;
                    });

                    return {
                        folderName,
                        timestamp: metadata.timestamp,
                        prompt: metadata.prompt,
                        imageCount: metadata.generatedImages?.length || 0,
                        thumbnailUrls,
                        parameters: metadata.parameters
                    };
                } catch (error) {
                    console.error(`⚠️ 读取元数据失败 ${folderName}:`, error.message);
                    return null;
                }
            }
            return null;
        }).filter(item => item !== null);

        return history;
    } catch (error) {
        console.error('⚠️ 获取历史记录失败:', error);
        return [];
    }
}

initDirectories();

const server = http.createServer((req, res) => {
    // 静态图片服务路由: GET /images/:timestamp/:quality/:filename
    if (req.url.startsWith('/images/') && req.method === 'GET') {
        const startTime = Date.now(); // 记录请求开始时间
        const urlParts = req.url.split('/').filter(part => part);
        // urlParts: ['images', timestamp, quality, filename]

        if (urlParts.length >= 4) {
            const timestamp = urlParts[1];
            const quality = urlParts[2];
            const filename = urlParts[3];

            // 验证质量参数
            if (!['thumbnail', 'preview', 'original'].includes(quality)) {
                res.writeHead(400, { 'Content-Type': 'text/plain; charset=utf-8' });
                res.end('无效的质量参数');
                writeLog(req, res, startTime, 400);
                return;
            }

            // 构建文件路径
            let imagePath;
            if (quality === 'original') {
                imagePath = path.join(DATA_DIR, timestamp, filename);
            } else {
                imagePath = path.join(DATA_DIR, timestamp, quality, filename);
            }

            // 检查文件是否存在
            if (!fs.existsSync(imagePath)) {
                res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
                res.end('图片不存在');
                writeLog(req, res, startTime, 404);
                return;
            }

            // 读取并返回图片
            fs.readFile(imagePath, (err, data) => {
                if (err) {
                    res.writeHead(500, { 'Content-Type': 'text/plain; charset=utf-8' });
                    res.end('读取图片失败');
                    writeLog(req, res, startTime, 500);
                    return;
                }

                const mimeType = getMimeType(filename);
                res.writeHead(200, {
                    'Content-Type': mimeType,
                    'Cache-Control': 'max-age=86400', // 缓存1天
                    'Access-Control-Allow-Origin': '*'
                });
                res.end(data);
                writeLog(req, res, startTime, 200);
            });
        } else {
            res.writeHead(400, { 'Content-Type': 'text/plain; charset=utf-8' });
            res.end('无效的图片URL');
            writeLog(req, res, startTime, 400);
        }
        return;
    }

    // 历史记录API: GET /api/history
    if (req.url === '/api/history' && req.method === 'GET') {
        const startTime = Date.now(); // 记录请求开始时间
        const history = getHistoryData();
        res.writeHead(200, {
            'Content-Type': 'application/json',
            'Access-Control-Allow-Origin': '*'
        });
        res.end(JSON.stringify(history));
        writeLog(req, res, startTime, 200);
        return;
    }

    // API代理：转发到本地8045端口
    if (req.url === '/api/generate' && req.method === 'POST') {
        const startTime = Date.now(); // 记录请求开始时间
        let body = '';

        req.on('data', chunk => {
            body += chunk.toString();
        });

        req.on('end', () => {
            const clientIP = getClientIP(req);
            let requestData;

            try {
                requestData = JSON.parse(body);
            } catch (error) {
                res.writeHead(400, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ error: '无效的请求数据' }));
                writeLog(req, res, startTime, 400);
                return;
            }

            // 提取提示词和参数
            const messages = requestData.messages || [];
            const userMessage = messages.find(m => m.role === 'user');
            const prompt = userMessage?.content || '';
            const parameters = {
                model: requestData.model || 'unknown',
                count: requestData.n || 1
            };

            // 转发请求到本地API
            const apiReq = http.request(
                `${API_TARGET}/v1/chat/completions`,
                {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                        'Authorization': req.headers['authorization'] || ''
                    }
                },
                (apiRes) => {
                    let responseBody = '';

                    // 只缓冲数据，不写入响应
                    apiRes.on('data', chunk => {
                        responseBody += chunk.toString();
                    });

                    apiRes.on('end', async () => {
                        const finalStatusCode = apiRes.statusCode; // 保存真实状态码

                        // 处理响应数据并替换base64为URL
                        if (apiRes.statusCode === 200) {
                            try {
                                const responseData = JSON.parse(responseBody);
                                const content = responseData.choices?.[0]?.message?.content;

                                if (content) {
                                    // 提取所有base64图片数据
                                    const base64Regex = /data:image\/[^;]+;base64,([^\"]+)|base64:([A-Za-z0-9+/=]+)/g;
                                    const base64Images = [];
                                    let match;

                                    while ((match = base64Regex.exec(content)) !== null) {
                                        const base64Data = match[1] || match[2];
                                        if (base64Data) {
                                            base64Images.push(base64Data);
                                        }
                                    }

                                    // 保存图片并获取URLs
                                    if (base64Images.length > 0) {
                                        const saveResult = await saveGenerationData(prompt, base64Images, clientIP, parameters, apiRes.statusCode);

                                        if (saveResult && saveResult.imageUrls) {
                                            // 替换响应中的base64为URL
                                            let modifiedContent = content;
                                            const base64Matches = [];

                                            // 重新匹配以获取完整的base64字符串
                                            const fullBase64Regex = /data:image\/[^;]+;base64,[^\"]+/g;
                                            let fullMatch;
                                            while ((fullMatch = fullBase64Regex.exec(content)) !== null) {
                                                base64Matches.push(fullMatch[0]);
                                            }

                                            // 替换每个base64为对应的URL
                                            base64Matches.forEach((base64String, index) => {
                                                if (index < saveResult.imageUrls.length) {
                                                    modifiedContent = modifiedContent.replace(
                                                        base64String,
                                                        saveResult.imageUrls[index]
                                                    );
                                                }
                                            });

                                            // 更新响应内容
                                            responseData.choices[0].message.content = modifiedContent;
                                            responseBody = JSON.stringify(responseData);
                                        }
                                    }
                                }
                            } catch (error) {
                                console.error('⚠️ 处理响应失败:', error);
                            }
                        }

                        // 一次性写入响应头和修改后的响应体
                        res.writeHead(finalStatusCode, {
                            'Content-Type': 'application/json',
                            'Access-Control-Allow-Origin': '*'
                        });
                        res.end(responseBody);

                        // 记录日志（使用真实的API响应状态码）
                        writeLog(req, res, startTime, finalStatusCode);
                    });
                }
            );

            apiReq.on('error', (error) => {
                res.writeHead(500, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ error: `API请求失败: ${error.message}` }));
                writeLog(req, res, startTime, 500);
            });

            apiReq.write(body);
            apiReq.end();
        });

        return;
    }

    // OPTIONS请求处理（CORS预检）
    if (req.method === 'OPTIONS') {
        res.writeHead(204, {
            'Access-Control-Allow-Origin': '*',
            'Access-Control-Allow-Methods': 'POST, GET, OPTIONS',
            'Access-Control-Allow-Headers': 'Content-Type, Authorization'
        });
        res.end();
        return;
    }

    // 只处理根路径请求
    if (req.url === '/' || req.url === '/index.html') {
        const filePath = path.join(__dirname, 'text-to-image.html');

        fs.readFile(filePath, (err, data) => {
            if (err) {
                res.writeHead(500, { 'Content-Type': 'text/plain; charset=utf-8' });
                res.end('服务器错误');
                return;
            }

            res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
            res.end(data);
        });
    } else {
        res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
        res.end('页面不存在');
    }
});

server.listen(PORT, '0.0.0.0', () => {
    console.log(`\n🚀 服务器已启动！`);
    console.log(`📍 本地访问: http://localhost:${PORT}`);
    console.log(`📍 局域网访问: http://127.0.0.1:${PORT}`);
    console.log(`📍 内网穿透: 使用你的穿透域名:${PORT}`);
    console.log(`\n按 Ctrl+C 停止服务器\n`);
});
