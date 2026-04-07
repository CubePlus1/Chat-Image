const http = require('http');
const fs = require('fs');
const path = require('path');
const sharp = require('sharp');
const config = require('./config');

const PORT       = config.PORT;
const API_TARGET = config.API_TARGET; // 后端代理目标地址

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
    preview: { width: 1920, quality: 85 },  // 提升预览图分辨率和质量
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

        // 所有压缩图片都使用PNG格式（保持最佳质量）
        return await sharp(inputBuffer)
            .resize(config.width, null, {
                fit: 'inside',
                withoutEnlargement: true
            })
            .png({
                quality: config.quality,
                compressionLevel: 6  // 0-9，6是平衡点
            })
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

// 生成时间戳文件夹名（格式：20250203_143052_123，含毫秒避免并行请求冲突）
function getTimestampFolder() {
    const now = new Date();
    const pad = (n, len = 2) => String(n).padStart(len, '0');
    return `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}_${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}_${pad(now.getMilliseconds(), 3)}`;
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

        // 从所有图片中选出分辨率最大的那张，只保存它
        let bestBuffer = null;
        let bestResolution = 0;
        let bestIndex = 0;

        for (let index = 0; index < base64Images.length; index++) {
            const base64Data = base64Images[index];
            const imageBuffer = Buffer.from(base64Data, 'base64');

            try {
                const meta = await sharp(imageBuffer).metadata();
                const resolution = (meta.width || 0) * (meta.height || 0);
                console.log(`📊 图片 ${index} 信息: ${meta.width}x${meta.height}, 格式: ${meta.format}, 大小: ${(imageBuffer.length / 1024 / 1024).toFixed(2)}MB`);

                if (resolution > bestResolution) {
                    bestResolution = resolution;
                    bestBuffer = imageBuffer;
                    bestIndex = index;
                }
            } catch (err) {
                console.error(`⚠️ 无法读取图片 ${index} 元数据:`, err.message);
                // 如果无法读取元数据，按文件大小兜底
                if (!bestBuffer || imageBuffer.length > bestBuffer.length) {
                    bestBuffer = imageBuffer;
                    bestIndex = index;
                }
            }
        }

        if (base64Images.length > 1) {
            console.log(`🎯 选择图片 ${bestIndex} 作为最佳（共 ${base64Images.length} 张，丢弃其余）`);
        }

        const imageFilename = `image_0.png`;
        const imagePath = path.join(folderPath, imageFilename);

        // 保存最大的那张原图
        fs.writeFileSync(imagePath, bestBuffer);
        const generatedImages = [imageFilename];

        // 生成图片URL（返回原图，保留原始分辨率）
        const imageUrl = `/images/${folderName}/original/${imageFilename}`;
        const imageUrls = [imageUrl];

        // 异步生成压缩图片（不阻塞）
        generateCompressedImages(folderPath, imageFilename, bestBuffer).catch(err => {
            console.error(`⚠️ 压缩图片失败 ${imageFilename}:`, err.message);
        });

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

    // 公共配置API: GET /api/config（前端读取默认值用）
    if (req.url === '/api/config' && req.method === 'GET') {
        const startTime = Date.now();
        res.writeHead(200, {
            'Content-Type': 'application/json',
            'Access-Control-Allow-Origin': '*'
        });
        res.end(JSON.stringify({
            defaultApiKey:   config.DEFAULT_API_KEY,
            defaultApiBase:  config.DEFAULT_API_BASE,
            enhanceApiBase:  config.ENHANCE_API_BASE,
            enhanceApiKey:   config.ENHANCE_API_KEY,
            enhanceApiModel: config.ENHANCE_API_MODEL,
        }));
        writeLog(req, res, startTime, 200);
        return;
    }

    // Chat API代理：转发到本地8045端口的 /v1/chat/completions
    if (req.url === '/api/generate' && req.method === 'POST') {
        const startTime = Date.now();
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

            // 提取提示词和参数（Chat API 格式）
            const messages = requestData.messages || [];
            const userMessage = messages.find(m => m.role === 'user');

            // 从 content 中提取文本提示词
            let prompt = '';
            if (userMessage) {
                if (typeof userMessage.content === 'string') {
                    prompt = userMessage.content;
                } else if (Array.isArray(userMessage.content)) {
                    const textContent = userMessage.content.find(c => c.type === 'text');
                    prompt = textContent?.text || '';
                }
            }

            const parameters = {
                model: requestData.model || 'unknown',
                messageCount: messages.length
            };

            // 转发请求到本地 Chat API
            const apiReq = http.request(
                `${API_TARGET}/v1/chat/completions`,
                {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                        'Authorization': `Bearer ${config.DEFAULT_API_KEY}`
                    }
                },
                (apiRes) => {
                    let responseBody = '';

                    apiRes.on('data', chunk => {
                        responseBody += chunk.toString();
                    });

                    apiRes.on('end', async () => {
                        const finalStatusCode = apiRes.statusCode;

                        // 处理HTTP 429 Too Many Requests
                        if (apiRes.statusCode === 429) {
                            const retryAfter = apiRes.headers['retry-after'] || '60';
                            const errorResponse = {
                                error: {
                                    type: 'rate_limit_error',
                                    message: '请求频率过高，请稍后再试',
                                    retry_after: parseInt(retryAfter),
                                    details: `建议等待 ${retryAfter} 秒后重试`
                                }
                            };
                            res.writeHead(429, {
                                'Content-Type': 'application/json',
                                'Access-Control-Allow-Origin': '*',
                                'Retry-After': retryAfter
                            });
                            res.end(JSON.stringify(errorResponse));
                            writeLog(req, res, startTime, 429);
                            return;
                        }

                        // 处理响应数据并保存图片
                        if (apiRes.statusCode === 200) {
                            try {
                                const responseData = JSON.parse(responseBody);
                                const message = responseData.choices?.[0]?.message;
                                const content = message?.content;

                                const base64Images = [];

                                // 方式1：content 字符串里内嵌 data:image/...;base64,...
                                if (content) {
                                    const base64Regex = /data:image\/[^;]+;base64,([^")\s]+)/g;
                                    let match;
                                    while ((match = base64Regex.exec(content)) !== null) {
                                        if (match[1]) base64Images.push(match[1]);
                                    }
                                }

                                // 方式2：message.images[] 非标准字段（gemini-3.1-flash-image 实际返回格式）
                                if (base64Images.length === 0 && Array.isArray(message?.images)) {
                                    for (const img of message.images) {
                                        const url = img?.image_url?.url || '';
                                        const m = url.match(/^data:image\/[^;]+;base64,(.+)$/);
                                        if (m) base64Images.push(m[1]);
                                    }
                                }

                                // 保存图片并获取URLs
                                if (base64Images.length > 0) {
                                    const saveResult = await saveGenerationData(prompt, base64Images, clientIP, parameters, apiRes.statusCode);

                                    if (saveResult && saveResult.imageUrls) {
                                        const bestUrl = saveResult.imageUrls[0];

                                        // 把图片URL写入 content，前端统一从 content 读取
                                        const existingText = (typeof content === 'string' ? content : '').replace(/data:image\/[^;]+;base64,[^")\s]+/g, '').trim();
                                        responseData.choices[0].message.content = existingText ? `${existingText}\n${bestUrl}` : bestUrl;
                                        delete responseData.choices[0].message.images; // 移除非标字段
                                        responseBody = JSON.stringify(responseData);
                                    }
                                }
                            } catch (error) {
                                console.error('⚠️ 处理响应失败:', error);
                            }
                        }

                        // 写入响应
                        res.writeHead(finalStatusCode, {
                            'Content-Type': 'application/json',
                            'Access-Control-Allow-Origin': '*'
                        });
                        res.end(responseBody);
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

    // Images API代理：转发到 chat/completions（后端不支持 images/generations）
    if (req.url === '/api/images/generate' && req.method === 'POST') {
        const startTime = Date.now();
        let body = '';

        req.on('data', chunk => { body += chunk.toString(); });

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

            const prompt = requestData.prompt || '';
            const model  = requestData.model  || 'gemini-3.1-flash-image';

            // quality → Gemini imageSize 映射（参考图生图逻辑）
            const qualityMap = { 'standard': '1K', 'medium': '2K', 'hd': '2K' };
            const imageSize = qualityMap[requestData.quality] || '2K';

            // size → aspectRatio 映射
            const sizeToRatio = {
                '1920x1080': '16:9', '2560x1440': '16:9', '1280x720': '16:9',
                '1080x1920': '9:16', '1024x1024': '1:1', '1:1': '1:1',
                '4:3': '4:3', '3:4': '3:4', '21:9': '21:9'
            };
            const sizeStr = requestData.size || '1920x1080';
            const aspectRatio = sizeToRatio[sizeStr] || '16:9';

            const parameters = {
                model,
                size: sizeStr,
                imageSize,
                aspectRatio,
                quality: requestData.quality || 'hd',
                count: requestData.n || 1
            };

            // 构建 Gemini 原生 generateContent 请求体
            const geminiBody = JSON.stringify({
                contents: [{
                    role: 'user',
                    parts: [{ text: prompt }]
                }],
                generationConfig: {
                    imageConfig: {
                        imageSize: imageSize,
                        aspectRatio: aspectRatio
                    },
                    responseModalities: ['TEXT', 'IMAGE']
                }
            });

            const geminiBodyBuffer = Buffer.from(geminiBody);
            console.log(`🖼️ 文生图请求(Gemini): prompt="${prompt.substring(0, 50)}", model=${model}, imageSize=${imageSize}, ratio=${aspectRatio}`);

            const apiUrl = `${API_TARGET}/v1beta/models/${model}:generateContent`;
            const apiReq = http.request(
                apiUrl,
                {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                        'Content-Length': geminiBodyBuffer.length,
                        'Authorization': `Bearer ${config.DEFAULT_API_KEY}`
                    }
                },
                (apiRes) => {
                    let responseBody = '';
                    apiRes.on('data', chunk => { responseBody += chunk.toString(); });

                    apiRes.on('end', async () => {
                        if (apiRes.statusCode === 429) {
                            const retryAfter = apiRes.headers['retry-after'] || '60';
                            res.writeHead(429, {
                                'Content-Type': 'application/json',
                                'Access-Control-Allow-Origin': '*',
                                'Retry-After': retryAfter
                            });
                            res.end(JSON.stringify({ error: { type: 'rate_limit_error', message: '请求频率过高，请稍后再试', retry_after: parseInt(retryAfter) } }));
                            writeLog(req, res, startTime, 429);
                            return;
                        }

                        let finalStatusCode = apiRes.statusCode;

                        if (apiRes.statusCode === 200) {
                            try {
                                const responseData = JSON.parse(responseBody);

                                // 调试：打印 Gemini 响应结构（截断 base64）
                                const debugData = JSON.parse(JSON.stringify(responseData));
                                try {
                                    (debugData.candidates || []).forEach(c => {
                                        (c.content?.parts || []).forEach(p => {
                                            if (p.inline_data?.data) p.inline_data.data = p.inline_data.data.substring(0, 50) + '...[TRUNCATED]';
                                            if (p.inlineData?.data) p.inlineData.data = p.inlineData.data.substring(0, 50) + '...[TRUNCATED]';
                                        });
                                    });
                                } catch(e) {}
                                console.log('📦 Gemini 响应结构:', JSON.stringify(debugData, null, 2).substring(0, 2000));

                                // 提取 Gemini 原生响应中的 base64 图片
                                const base64Images = [];
                                const candidates = responseData.candidates || [];
                                for (const candidate of candidates) {
                                    const parts = candidate.content?.parts || [];
                                    for (const part of parts) {
                                        const inlineData = part.inline_data || part.inlineData;
                                        if (inlineData && inlineData.data) {
                                            base64Images.push(inlineData.data);
                                        }
                                    }
                                }

                                console.log(`🖼️ Gemini 返回 ${base64Images.length} 张图片`);

                                if (base64Images.length > 0) {
                                    const saveResult = await saveGenerationData(prompt, base64Images, clientIP, parameters, apiRes.statusCode);
                                    if (saveResult && saveResult.imageUrls) {
                                        // 返回 OpenAI images API 格式，方便前端直接用
                                        responseBody = JSON.stringify({
                                            created: Math.floor(Date.now() / 1000),
                                            data: saveResult.imageUrls.map(url => ({ url }))
                                        });
                                    }
                                }
                            } catch (error) {
                                console.error('⚠️ 处理响应失败:', error);
                            }
                        }

                        res.writeHead(finalStatusCode, {
                            'Content-Type': 'application/json',
                            'Access-Control-Allow-Origin': '*'
                        });
                        res.end(responseBody);
                        writeLog(req, res, startTime, finalStatusCode);
                    });
                }
            );

            apiReq.on('error', (error) => {
                res.writeHead(500, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ error: `API请求失败: ${error.message}` }));
                writeLog(req, res, startTime, 500);
            });

            apiReq.write(geminiBodyBuffer);
            apiReq.end();
        });

        return;
    }

    // 图生图API代理：通过 Gemini 原生 generateContent API 实现图生图
    if (req.url === '/api/images/edit' && req.method === 'POST') {
        const startTime = Date.now();
        let body = '';

        req.on('data', chunk => { body += chunk.toString(); });

        req.on('end', () => {
            const clientIP = getClientIP(req);
            let requestData;
            let responseSent = false;

            const sendResponse = (statusCode, payload) => {
                if (responseSent) return;
                responseSent = true;
                res.writeHead(statusCode, {
                    'Content-Type': 'application/json',
                    'Access-Control-Allow-Origin': '*'
                });
                res.end(typeof payload === 'string' ? payload : JSON.stringify(payload));
                writeLog(req, res, startTime, statusCode);
            };

            try {
                requestData = JSON.parse(body);
            } catch (error) {
                sendResponse(400, { error: '无效的请求数据' });
                return;
            }

            const prompt = requestData.prompt || '';
            const imageBase64 = requestData.imageBase64 || '';
            const mimeType = requestData.mimeType || 'image/png';
            const model = requestData.model || 'gemini-3.1-flash-image';

            // 比例和质量映射
            const aspectRatioMap = { '1-1': '1:1', '16-9': '16:9', '9-16': '9:16', '4-3': '4:3', '3-4': '3:4', '21-9': '21:9' };
            const qualityMap = { 'standard': '1K', 'medium': '2K', 'hd': '2K' };
            const imageSize = qualityMap[requestData.quality] || '2K';
            const aspectRatio = aspectRatioMap[requestData.aspectRatio] || '16:9';

            const parameters = { model, type: 'image-edit', imageSize, aspectRatio };

            // 构建 Gemini 原生请求体
            const parts = [{ text: prompt }];
            if (imageBase64) {
                parts.push({ inline_data: { mime_type: mimeType, data: imageBase64 } });
            }

            const geminiBody = JSON.stringify({
                contents: [{ role: 'user', parts }],
                generationConfig: {
                    responseModalities: ['IMAGE']
                }
            });

            const geminiBodyBuffer = Buffer.from(geminiBody);
            console.log(`🖼️ 图生图请求(Gemini): prompt="${prompt.substring(0, 50)}", model=${model}, imageSize=${imageSize}, ratio=${aspectRatio}, body=${(geminiBodyBuffer.length / 1024 / 1024).toFixed(2)}MB`);

            const apiUrl = `${API_TARGET}/v1beta/models/${model}:generateContent`;
            const apiReq = http.request(
                apiUrl,
                {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                        'Content-Length': geminiBodyBuffer.length,
                        'Authorization': `Bearer ${config.DEFAULT_API_KEY}`
                    }
                },
                (apiRes) => {
                    let responseBody = '';
                    apiRes.on('data', chunk => { responseBody += chunk.toString(); });

                    apiRes.on('end', async () => {
                        if (apiRes.statusCode === 429) {
                            const retryAfter = apiRes.headers['retry-after'] || '60';
                            sendResponse(429, {
                                error: { type: 'rate_limit_error', message: '请求频率过高，请稍后再试', retry_after: parseInt(retryAfter) }
                            });
                            return;
                        }

                        if (apiRes.statusCode === 200) {
                            try {
                                const responseData = JSON.parse(responseBody);

                                // 调试：打印响应结构（截断 base64）
                                const debugData = JSON.parse(JSON.stringify(responseData));
                                try {
                                    (debugData.candidates || []).forEach(c => {
                                        (c.content?.parts || []).forEach(p => {
                                            if (p.inline_data?.data) p.inline_data.data = p.inline_data.data.substring(0, 50) + '...[TRUNCATED]';
                                            if (p.inlineData?.data) p.inlineData.data = p.inlineData.data.substring(0, 50) + '...[TRUNCATED]';
                                        });
                                    });
                                } catch(e) {}
                                console.log('📦 Gemini 图生图响应结构:', JSON.stringify(debugData, null, 2).substring(0, 2000));

                                // 提取 base64 图片
                                const base64Images = [];
                                for (const candidate of (responseData.candidates || [])) {
                                    for (const part of (candidate.content?.parts || [])) {
                                        const inlineData = part.inline_data || part.inlineData;
                                        if (inlineData?.data) base64Images.push(inlineData.data);
                                    }
                                }

                                console.log(`🖼️ Gemini 图生图返回 ${base64Images.length} 张图片`);

                                if (base64Images.length > 0) {
                                    const saveResult = await saveGenerationData(prompt, base64Images, clientIP, parameters, apiRes.statusCode);
                                    if (saveResult?.imageUrls) {
                                        sendResponse(200, {
                                            created: Math.floor(Date.now() / 1000),
                                            data: saveResult.imageUrls.map(url => ({ url }))
                                        });
                                        return;
                                    }
                                }
                            } catch (error) {
                                console.error('⚠️ 处理Gemini图生图响应失败:', error);
                            }
                        }

                        // 非200或处理失败，原样返回
                        sendResponse(apiRes.statusCode, responseBody);
                    });
                }
            );

            apiReq.on('error', (error) => {
                console.error('⚠️ 图生图API请求失败:', error.message);
                sendResponse(500, { error: `API请求失败: ${error.message}` });
            });

            apiReq.write(geminiBodyBuffer);
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

    // 处理HTML页面请求（统一注入 config.js 配置到前端占位符）
    const HTML_ROUTES = {
        '/':                  'text-to-image.html',
        '/index.html':        'text-to-image.html',
        '/text-to-image.html':'text-to-image.html',
        '/history.html':      'history.html',
        '/history':           'history.html',
        '/chat.html':         'chat.html',
    };

    const htmlFile = HTML_ROUTES[req.url];
    if (htmlFile) {
        const filePath = path.join(__dirname, htmlFile);

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
    console.log(`\n按 Ctrl+C 停止服务器\n`);
});
