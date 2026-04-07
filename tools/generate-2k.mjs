import { readFileSync, mkdirSync, writeFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { execSync } from 'child_process';

const __dirname = dirname(fileURLToPath(import.meta.url));
const BASE_URL   = 'http://localhost:56780';
const OUTPUT_DIR = join(__dirname, 'output-2k');

// ── 质量档位 ──────────────────────────────────────────────────
// standard → Gemini 1K  （最快，文件最小）
// medium   → Gemini 2K
// hd       → Gemini 4K  （默认，最高质量）
const QUALITY_MAP = {
  standard: { label: '1K', size: '2560x1440' },
  medium:   { label: '2K', size: '2560x1440' },
  hd:       { label: '4K', size: '2560x1440' },
};

const PAGES = [
  '01-login', '02-dashboard', '03-resume-edit', '04-personality',
  '05-profile', '06-job-list', '07-job-graph', '08-match-result',
  '09-career-path', '10-report', '11-growth',
];

const COMMON = `A clean, modern web application UI screenshot, blue and white color scheme. Primary color #2B6CB0 deep blue, accent #4299E1 medium blue, background #F7FAFC off-white, cards pure white with subtle shadow. Left sidebar navigation in dark blue (#2B6CB0) with white text and icons. White top header bar with user avatar and logout button. Content area on the right side with rounded-corner cards (8px border-radius). Flat design, no gradients, minimal decoration. Comfortable whitespace and padding. Chinese text labels and headings. Font: system sans-serif, clean typography. Desktop layout, 2560x1440 resolution, ultra high definition, crisp sharp details, light and professional atmosphere. UI/UX design mockup style, high fidelity, Figma-quality rendering.`;

// ── CLI 参数解析 ───────────────────────────────────────────────
function parseArgs() {
  const args = process.argv.slice(2);
  const get  = (flag, def) => {
    const i = args.indexOf(flag);
    return i !== -1 && args[i + 1] ? args[i + 1] : def;
  };

  const quality     = get('--quality', 'hd');
  const concurrency = Math.max(1, parseInt(get('--concurrency', '1'), 10));
  const variants    = Math.max(1, parseInt(get('--variants', '4'), 10));
  const pagesArg    = get('--pages', '');
  const pages       = pagesArg
    ? pagesArg.split(',').map(s => s.trim()).filter(Boolean)
    : PAGES;

  if (!QUALITY_MAP[quality]) {
    console.error(`❌ 无效 quality: "${quality}"，可选: standard | medium | hd`);
    process.exit(1);
  }

  return { quality, concurrency, variants, pages };
}

// ── 工具函数 ───────────────────────────────────────────────────
function sleep(ms) {
  return new Promise(r => setTimeout(r, ms));
}

function extractPrompt(pageName) {
  const md    = readFileSync(join(__dirname, `${pageName}.md`), 'utf-8');
  const match = md.match(/```\n([\s\S]*?)\n```/);
  return match ? match[1].trim() : '';
}

function getImageSize(filePath) {
  try {
    const info = execSync(`sips -g pixelWidth -g pixelHeight "${filePath}" 2>/dev/null`).toString();
    const w = info.match(/pixelWidth:\s*(\d+)/)?.[1]  ?? '?';
    const h = info.match(/pixelHeight:\s*(\d+)/)?.[1] ?? '?';
    return `${w}x${h}`;
  } catch (_) {
    return '?x?';
  }
}

// ── 并发池 ────────────────────────────────────────────────────
function createPool(concurrency) {
  let running = 0;
  const queue = [];
  const next  = () => {
    if (running >= concurrency || queue.length === 0) return;
    running++;
    const { fn, resolve, reject } = queue.shift();
    fn().then(resolve, reject).finally(() => { running--; next(); });
  };
  return {
    run: (fn) => new Promise((resolve, reject) => { queue.push({ fn, resolve, reject }); next(); }),
  };
}

// ── 单张图片生成 ───────────────────────────────────────────────
async function generateImage(prompt, outputPath, quality, retries = 3) {
  const { size } = QUALITY_MAP[quality];

  for (let attempt = 1; attempt <= retries; attempt++) {
    try {
      const res  = await fetch(`${BASE_URL}/api/images/generate`, {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ prompt, model: 'gemini-3.1-flash-image', size, quality }),
      });
      const text = await res.text();

      if (res.status === 429) {
        let retryAfter = 30;
        try { retryAfter = JSON.parse(text)?.error?.retry_after || 30; } catch (_) {}
        console.log(`    ⏳ [${outputPath.split('/').pop()}] Rate limited, waiting ${retryAfter}s...`);
        await sleep(retryAfter * 1000);
        continue;
      }

      if (!res.ok) throw new Error(`HTTP ${res.status}: ${text.substring(0, 200)}`);

      const imgUrl = JSON.parse(text)?.data?.[0]?.url;
      if (!imgUrl) throw new Error(`No image URL: ${text.substring(0, 300)}`);

      const imgRes = await fetch(`${BASE_URL}${imgUrl}`);
      if (!imgRes.ok) throw new Error(`Download failed: ${imgRes.status}`);

      writeFileSync(outputPath, Buffer.from(await imgRes.arrayBuffer()));
      return getImageSize(outputPath);

    } catch (e) {
      console.log(`    ❌ [${outputPath.split('/').pop()}] Attempt ${attempt}/${retries}: ${e.message}`);
      if (attempt < retries) await sleep(5000);
    }
  }
  return null;
}

// ── 主流程 ────────────────────────────────────────────────────
async function main() {
  const { quality, concurrency, variants, pages } = parseArgs();
  const qualityLabel = QUALITY_MAP[quality].label;

  console.log(`🚀 图片生成`);
  console.log(`   质量: ${quality} (Gemini ${qualityLabel})  并发: ${concurrency}  每页: ${variants} 张`);
  console.log(`   页面: ${pages.join(', ')}`);
  console.log(`   输出: ${OUTPUT_DIR}\n`);

  const pool = createPool(concurrency);
  const tasks = [];
  const stats = { total: 0, success: 0, failed: 0 };

  for (const page of pages) {
    const pagePrompt = extractPrompt(page);
    if (!pagePrompt) {
      console.log(`⚠️  ${page}: 未找到提示词，跳过`);
      continue;
    }

    const pageDir    = join(OUTPUT_DIR, quality, page);
    const fullPrompt = `${COMMON} ${pagePrompt}`;
    mkdirSync(pageDir, { recursive: true });

    for (let i = 1; i <= variants; i++) {
      const outputPath = join(pageDir, `${page}_v${i}.png`);
      const label      = `${page} v${i}/${variants}`;
      stats.total++;

      tasks.push(pool.run(async () => {
        process.stdout.write(`  🖼  ${label} ... `);
        const result = await generateImage(fullPrompt, outputPath, quality);
        if (result) {
          stats.success++;
          console.log(`✅ ${result}`);
        } else {
          stats.failed++;
          console.log(`❌ FAILED`);
        }
      }));
    }
  }

  await Promise.all(tasks);

  console.log(`\n==========================================`);
  console.log(`🏁 完成！共 ${stats.total} 张，成功 ${stats.success}，失败 ${stats.failed}`);
  console.log(`   输出: ${OUTPUT_DIR}/${quality}/`);
  console.log(`==========================================`);
}

main().catch(console.error);
