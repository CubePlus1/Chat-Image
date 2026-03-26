# Chat-Image 图像生成 API 文档

**Base URL** `http://localhost:56780`
**鉴权** 无需前端传递，由服务端 `config.js` 统一注入

---

## 1. 文生图

**`POST /api/images/generate`**

将提示词发给后端模型生成图片，服务端保存图片后返回可直接访问的 URL。

### 请求头
```
Content-Type: application/json
```

### 请求体
```json
{
  "prompt":  "a cute cartoon cat sitting on a cloud, flat design",
  "model":   "gemini-3.1-flash-image",
  "size":    "1920x1080",
  "quality": "hd",
  "n":       1
}
```

| 字段 | 类型 | 必填 | 默认值 | 说明 |
|---|---|---|---|---|
| `prompt` | string | ✅ | — | 图片描述文本 |
| `model` | string | ❌ | `gemini-3.1-flash-image` | 生图模型 |
| `size` | string | ❌ | `1920x1080` | 尺寸，格式 `WxH` |
| `quality` | string | ❌ | `hd` | `standard` / `hd` |
| `n` | number | ❌ | `1` | 生成数量（当前仅保留最大分辨率那张） |

### 成功响应 `200`
```json
{
  "created": 1741524463,
  "data": [
    { "url": "/images/20260309_210743_363/original/image_0.png" }
  ]
}
```

---

## 2. Chat 生图（多轮对话）

**`POST /api/generate`**

以 OpenAI Chat Completions 格式发送，支持多轮上下文，图片 URL 内嵌于 `content` 字段返回。

### 请求头
```
Content-Type: application/json
```

### 请求体
```json
{
  "model": "gemini-3.1-flash-image",
  "messages": [
    { "role": "user", "content": "画一只坐在云上的猫" }
  ]
}
```

| 字段 | 类型 | 必填 | 说明 |
|---|---|---|---|
| `model` | string | ✅ | 模型名 |
| `messages` | array | ✅ | 消息数组，格式同 OpenAI Chat API |
| `messages[].role` | string | ✅ | `user` / `assistant` / `system` |
| `messages[].content` | string \| array | ✅ | 文本字符串，或 `[{type:"text", text:"..."}]` |

### 成功响应 `200`
```json
{
  "id": "xxx",
  "object": "chat.completion",
  "choices": [
    {
      "message": {
        "role": "assistant",
        "content": "/images/20260309_210548_780/original/image_0.png"
      }
    }
  ]
}
```

---

## 3. 图生图（图片编辑）

**`POST /api/images/edit`**

上传参考图 + 提示词，生成编辑后的图片。

### 请求头
```
Content-Type: multipart/form-data
```

### 请求体（FormData）

| 字段 | 类型 | 必填 | 说明 |
|---|---|---|---|
| `image` | File | ✅ | 参考图片（PNG） |
| `prompt` | string | ✅ | 编辑描述 |
| `model` | string | ❌ | 默认 `gemini-3.1-flash-image` |
| `size` | string | ❌ | 目标尺寸，如 `1920x1080` |
| `quality` | string | ❌ | `standard` / `hd` |

### 成功响应 `200`
```json
{
  "data": [
    { "url": "/images/20260309_xxxxxx_xxx/original/image_0.png" }
  ]
}
```

---

## 4. 图片访问

**`GET /images/:timestamp/:quality/:filename`**

| 参数 | 说明 |
|---|---|
| `timestamp` | 生成时的时间戳目录名，如 `20260309_210743_363` |
| `quality` | `original` / `preview`（1920px） / `thumbnail`（200px） |
| `filename` | 固定为 `image_0.png` |

```
GET /images/20260309_210743_363/original/image_0.png   → 原图（4K）
GET /images/20260309_210743_363/preview/image_0.png    → 预览图
GET /images/20260309_210743_363/thumbnail/image_0.png  → 缩略图
```

---

## 5. 公共配置

**`GET /api/config`**

获取服务端当前配置的前端默认值（用于初始化页面）。

### 响应 `200`
```json
{
  "defaultApiKey":   "sk-xxx",
  "defaultApiBase":  "http://localhost:56780",
  "enhanceApiBase":  "http://localhost:8317/v1",
  "enhanceApiKey":   "sk-xxx",
  "enhanceApiModel": "gemini-3-flash"
}
```

---

## 6. 历史记录

**`GET /api/history`**

返回所有历史生成记录，按时间倒序排列。

### 响应 `200`
```json
[
  {
    "folderName":  "20260309_210743_363",
    "timestamp":   "2026-03-09T13:07:43.363Z",
    "prompt":      "a cute cartoon cat",
    "imageCount":  1,
    "thumbnailUrls": ["/images/20260309_210743_363/thumbnail/image_0.png"],
    "parameters":  { "model": "gemini-3.1-flash-image", "size": "1024x1024" }
  }
]
```

---

## 通用错误格式

| HTTP | 场景 | 响应体 |
|---|---|---|
| `400` | 请求体格式错误 | `{"error": "无效的请求数据"}` |
| `429` | 触发限流 | `{"error": {"type": "rate_limit_error", "retry_after": 60}}` |
| `500` | 后端连接失败 | `{"error": "API请求失败: connect ECONNREFUSED"}` |
