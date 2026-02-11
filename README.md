# Chat-Image

一个功能强大的 AI 工具集合，包含文生图工具和聊天界面，支持 OpenAI 兼容的 API。

## 项目简介

Chat-Image 是一个基于 Web 的 AI 工具集，提供以下功能：

- **AI 文生图工具**：支持纯文本生图和图文混合生图，内置 AI 提示词润色功能
- **AI 聊天界面**：支持流式响应的 OpenAI 兼容聊天工具
- **图片管理服务器**：自动保存生成的图片，支持多级压缩和历史记录

## 功能特性

### 1. AI 文生图工具 (text-to-image.html)

#### 核心功能
- **双模式生图**
  - 纯文本生图：直接输入提示词生成图片
  - 图文混合生图：上传参考图片 + 文字描述生成图片

- **AI 提示词润色**
  - 使用 AI 自动优化提示词
  - 可配置独立的 Chat API（支持 GPT、Gemini、Claude 等）
  - 预览润色结果后再应用

- **多图上传管理**
  - 支持同时上传多张图片
  - 主图/辅图标记系统
  - 拖拽式图片管理

- **灵活的生成参数**
  - 图片比例：1:1、16:9、9:16、4:3、3:4
  - 图片质量：2K、4K
  - 批量生成：1-4 张图片

- **渐进式图片加载**
  - 缩略图（200px，60% 质量）
  - 预览图（800px，70% 质量）
  - 原图（完整分辨率）
  - 自动切换不同质量版本

#### 技术特点
- 单文件架构，无需构建工具
- 完全前端实现，可直接在浏览器打开
- LocalStorage 保存配置
- 支持调试模式查看 API 响应

### 2. AI 聊天工具 (chat.html)

#### 核心功能
- **流式响应**：实时显示 AI 回复内容
- **多模型支持**：
  - Gemini 系列（Flash、Pro、Thinking 模式）
  - Claude 系列（Sonnet、Opus、Thinking 模式）
  - 支持图片输出模型

- **对话管理**
  - 保持完整对话历史
  - 一键清空对话
  - 支持中断生成

- **特殊内容支持**
  - 自动检测并显示 Base64 图片
  - 显示思维链内容（Thinking 模式）
  - 代码高亮显示

#### 技术特点
- SSE（Server-Sent Events）流式解析
- AbortController 支持中断请求
- 自动处理不完整的 JSON 块
- 调试模式查看原始响应

### 3. 图片管理服务器 (server.js)

#### 核心功能
- **API 代理**
  - 转发请求到本地 AI API（端口 8045）
  - 自动提取并保存生成的图片

- **图片压缩存储**
  - 使用 Sharp 库进行高质量压缩
  - 三级存储：thumbnail（200px）、preview（800px）、original（原图）
  - 异步压缩，不阻塞响应

- **数据组织**
  - 按时间戳创建文件夹（格式：`20250203_143052`）
  - 保存提示词（prompt.txt）
  - 保存元数据（metadata.json）
  - 记录客户端 IP 和生成参数

- **历史记录 API**
  - `GET /api/history`：获取所有生成记录
  - `GET /images/{folder}/{quality}/{filename}`：访问图片

- **日志系统**
  - 按日期记录访问日志
  - 记录响应时间和状态码
  - 自动排除 HTML 文件请求

#### 技术特点
- Node.js 原生 HTTP 服务器
- 依赖：sharp（图片处理）、archiver（压缩）
- 端口：8000
- 数据目录：`./data/`

## 快速开始

### 环境要求

- Node.js 14+
- 本地 AI API 服务（端口 8045）或其他 OpenAI 兼容 API

### 安装步骤

1. **克隆或下载项目**
```bash
cd Chat-Image
```

2. **安装依赖**
```bash
npm install
```

3. **启动服务器**

Windows 用户：
```bash
start.bat
```

其他系统：
```bash
node server.js
```

4. **访问工具**

- 文生图工具：`http://localhost:8000/text-to-image.html`
- 聊天工具：`http://localhost:8000/chat.html`

## 配置说明

### 文生图工具配置

#### 基础配置
- **API Endpoint**：图片生成 API 地址（默认：`http://localhost:8000/v1/chat/completions`）
- **API Key**：API 密钥（可选，取决于 API 要求）
- **Model**：模型名称（默认：`gemini-3-pro-image`）

#### AI 润色配置（可选）
- **API Base**：Chat API 地址（默认：`http://localhost:8045/v1`）
- **API Key**：Chat API 密钥
- **Model**：Chat 模型（默认：`gemini-3-flash`）

配置会自动保存到浏览器 LocalStorage。

### 聊天工具配置

- **API Base URL**：API 地址（默认：`http://localhost:8045/v1`）
- **API Key**：API 密钥
- **Model**：选择模型（Gemini、Claude 等）

### 服务器配置

编辑 `server.js` 修改以下配置：

```javascript
const PORT = 8000;                          // 服务器端口
const API_TARGET = 'http://127.0.0.1:8045'; // AI API 地址
const DATA_DIR = path.join(__dirname, 'data'); // 数据存储目录
const LOG_DIR = 'C:\\Users\\lenovo\\Desktop\\日志'; // 日志目录
```

## 使用方法

### 文生图工具使用流程

#### 纯文本生图
1. 选择"纯文生图"模式
2. 输入提示词（可选：点击"AI 润色"优化提示词）
3. 选择图片比例和质量
4. 设置生成数量（1-4 张）
5. 点击"生成图片"

#### 图文混合生图
1. 选择"图+文生图"模式
2. 点击"选择图片"上传参考图片（支持多张）
3. 设置主图（点击图片上的"设为主图"）
4. 输入文字描述
5. 选择参数并生成

#### AI 提示词润色
1. 展开"AI 润色设置"
2. 配置 Chat API 信息
3. 输入初始提示词
4. 点击"AI 润色"
5. 预览润色结果
6. 点击"应用"或"取消"

### 聊天工具使用流程

1. 配置 API 信息和选择模型
2. 在输入框输入消息
3. 按 Enter 发送（Shift+Enter 换行）
4. 查看流式响应
5. 需要时点击"停止"中断生成
6. 点击"清空对话"重新开始

### 查看生成历史

访问 `http://localhost:8000/api/history` 查看所有生成记录的 JSON 数据。

每个记录包含：
- 时间戳
- 提示词
- 生成参数
- 图片 URL 列表
- 客户端 IP

## API 说明

### 服务器 API 端点

#### 1. 代理 Chat Completions
```
POST /v1/chat/completions
```
转发到本地 AI API，自动提取并保存生成的图片。

#### 2. 获取历史记录
```
GET /api/history
```
返回所有生成记录的元数据。

响应示例：
```json
[
  {
    "folder": "20250203_143052",
    "timestamp": "2025-02-03T14:30:52.123Z",
    "prompt": "一只可爱的猫咪",
    "parameters": {
      "aspectRatio": "1-1",
      "quality": "4k",
      "numImages": 2
    },
    "generatedImages": ["image_0.png", "image_1.png"],
    "imageUrls": [
      "/images/20250203_143052/preview/image_0.png",
      "/images/20250203_143052/preview/image_1.png"
    ]
  }
]
```

#### 3. 访问图片
```
GET /images/{folder}/{quality}/{filename}
```
- `folder`：时间戳文件夹名
- `quality`：`thumbnail`、`preview` 或 `original`
- `filename`：图片文件名

示例：
```
GET /images/20250203_143052/preview/image_0.png
```

#### 4. 静态文件服务
```
GET /{filename}.html
```
访问 HTML 工具文件。

### 图片压缩配置

| 质量级别 | 宽度 | JPEG 质量 | 用途 |
|---------|------|----------|------|
| thumbnail | 200px | 60% | 快速预览、列表展示 |
| preview | 800px | 70% | 详情页展示 |
| original | 原始 | 100% | 下载、高清查看 |

## 项目结构

```
Chat-Image/
├── text-to-image.html    # AI 文生图工具（单文件）
├── chat.html             # AI 聊天工具（单文件）
├── server.js             # Node.js 服务器
├── start.bat             # Windows 启动脚本
├── package.json          # 依赖配置
├── CLAUDE.md             # 项目开发文档
├── README.md             # 本文件
└── data/                 # 生成数据存储目录（自动创建）
    └── 20250203_143052/  # 时间戳文件夹
        ├── image_0.png   # 原图
        ├── prompt.txt    # 提示词
        ├── metadata.json # 元数据
        ├── thumbnail/    # 缩略图目录
        │   └── image_0.png
        ├── preview/      # 预览图目录
        │   └── image_0.png
        └── original/     # 原图目录（可选）
```

## 技术栈

- **前端**：原生 HTML + CSS + JavaScript（无框架）
- **后端**：Node.js + HTTP 模块
- **图片处理**：Sharp
- **压缩**：Archiver
- **API 协议**：OpenAI Chat Completions API

## 常见问题

### 1. 服务器启动失败：端口 8000 被占用

**解决方案**：
- Windows：运行 `start.bat` 会自动检测并关闭占用进程
- 手动：修改 `server.js` 中的 `PORT` 变量

### 2. 图片生成失败

**检查项**：
- 确认本地 AI API（端口 8045）正常运行
- 检查 API Key 是否正确
- 打开调试模式查看详细错误信息
- 查看浏览器控制台和服务器日志

### 3. AI 润色功能不工作

**检查项**：
- 确认已配置"AI 润色设置"中的 API 信息
- 确认 Chat API 支持 `/v1/chat/completions` 端点
- 检查模型名称是否正确

### 4. 图片加载缓慢

**原因**：渐进式加载会先显示缩略图，再加载预览图和原图。

**优化**：
- 调整 `server.js` 中的压缩配置
- 使用更快的存储设备
- 减少生成数量

### 5. 无法访问历史记录

**检查项**：
- 确认 `data/` 目录存在且有读取权限
- 检查文件夹命名格式是否正确（`YYYYMMDD_HHMMSS`）
- 查看服务器控制台错误信息

## 开发说明

### 单文件架构设计

HTML 工具采用单文件架构，所有代码（HTML、CSS、JavaScript）都在一个文件中，优点：

- 无需构建工具
- 易于分发和部署
- 可直接在浏览器打开（file:// 协议）
- 便于快速修改和测试

### 修改和扩展

#### 添加新模型
编辑 HTML 文件中的 `<select>` 元素：
```html
<option value="new-model-name">新模型名称</option>
```

#### 修改图片比例选项
编辑 `text-to-image.html` 中的 `aspectRatio` 选择器。

#### 自定义压缩配置
修改 `server.js` 中的 `COMPRESSION_CONFIGS` 对象。

### 测试不同 API

工具支持任何 OpenAI 兼容的 API：

1. **本地代理**：`http://localhost:8045/v1`（默认）
2. **OpenAI**：`https://api.openai.com/v1`
3. **自定义端点**：任何支持 Chat Completions 格式的 API

确认 API 支持：
- `POST /v1/chat/completions`
- `stream: true` 参数（聊天工具）
- 响应格式符合 OpenAI 规范

## 许可证

本项目为个人工具集合，仅供学习和个人使用。

## 更新日志

### 当前版本特性
- 双模式文生图（纯文本 + 图文混合）
- AI 提示词润色功能
- 多图上传和主图管理
- 渐进式图片加载
- 三级图片压缩存储
- 完整的历史记录系统
- 流式聊天响应
- 多模型支持

## 联系方式

如有问题或建议，请通过项目仓库提交 Issue。
