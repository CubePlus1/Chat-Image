// ============================================================
//  🔧 配置模板 — 复制此文件并重命名为 config.js 后填入真实值
//  cp config.example.js config.js
// ============================================================

module.exports = {

    // ── 服务器 ──────────────────────────────────────────────
    PORT: 56780,

    // ── 后端代理目标（服务器转发 API 请求到此地址） ──────────
    API_TARGET: 'http://127.0.0.1:8317',

    // ── 前端默认填充值（注入到 HTML，用户可在页面上二次修改） ─
    // 图像生成页 主 API Key（text-to-image.html #apiKey）
    DEFAULT_API_KEY: 'sk-xxxxxxxxxxxxxxxx',

    // 图像生成页 主 API Base URL
    DEFAULT_API_BASE: 'http://localhost:56780',

    // 图像增强 / Chat 功能使用的直连 API（可填第三方兼容地址）
    ENHANCE_API_BASE: 'https://api.openai.com/v1',
    ENHANCE_API_KEY:  'sk-xxxxxxxxxxxxxxxx',

};
