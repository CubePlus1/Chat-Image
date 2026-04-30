#!/usr/bin/env node
/**
 * EOOVE 世界观完整设定集拼装器
 *
 * 把 /Users/sevencolor/Documents/Morina/worldbuilding/ 下 33 篇 md
 * 按索引顺序拼成一份可独立发布的单文件 markdown。
 *
 * 输出: /Users/sevencolor/Documents/Morina/EOOVE_设定集.md
 *
 * 重新运行可再生成（如 worldbuilding/ 内容有更新）。
 */

import fs from 'node:fs';
import path from 'node:path';

const SRC_DIR = '/Users/sevencolor/Documents/Morina/worldbuilding';
const OUT = '/Users/sevencolor/Documents/Morina/EOOVE_设定集.md';
const VERSION = 'v1.2';
const DATE = new Date().toISOString().slice(0, 10);

// 阅读顺序：序章 + 衔接 + 30 维度 + 3 附录（31 角色 / 32 年表 / 33 术语）
const ALL_FILES = fs.readdirSync(SRC_DIR).filter(f => f.endsWith('.md') && f !== '00_索引.md');
const APPENDIX_NUMS = [31, 32, 33, 34, 35, 36];
const ORDER = [
    '00_序章_EOOVE核心设定.md',
    '00_衔接_探心纪与归档纪元.md',
    ...Array.from({ length: 30 }, (_, i) => {
        const n = String(i + 1).padStart(2, '0');
        const f = ALL_FILES.find(x => x.startsWith(n + '_'));
        if (!f) throw new Error(`缺失文档: ${n}_*.md`);
        return f;
    }),
    ...APPENDIX_NUMS.map(n => {
        const f = ALL_FILES.find(x => x.startsWith(n + '_'));
        if (!f) throw new Error(`缺失附录文档: ${n}_*.md`);
        return f;
    }),
];

// 提取 H1 用作 TOC 与统计
const sections = ORDER.map(filename => {
    const fullPath = path.join(SRC_DIR, filename);
    const content = fs.readFileSync(fullPath, 'utf8').trim();
    const h1Match = content.match(/^# (.+)$/m);
    return {
        filename,
        title: h1Match ? h1Match[1].trim() : filename.replace(/\.md$/, ''),
        content,
        chars: content.length,
    };
});

const totalChars = sections.reduce((s, x) => s + x.chars, 0);

// ── 卷首 ───────────────────────────────────────────────────
const cover = `# EOOVE · 零与一之间的文明

## 世界观完整设定集 · ${VERSION}

> *探心纪 · 归档纪元 · 续生纪元*
> *—— 一个把"反抗遗忘"作为文明根基命题的远未来后死亡社会*

---

| 项 | 值 |
|:---|:---|
| **主创设定** | Morina 项目组 |
| **编纂日期** | ${DATE} |
| **版本** | ${VERSION} |
| **总章数** | ${sections.length} 章（2 篇奠基 + 30 篇维度 + 6 篇附录） |
| **总字符数** | 约 ${(totalChars / 1000).toFixed(1)}K |

---

## 卷首语

EOOVE 不是国名，也不是时代名。
它是这个世界的形状——
开端与终结同形（首尾两个 **E**），
中央嵌着被压缩的零域（**OO**），
反转之力凝在末段的 **V**。

五个字母按顺序读：**存在 → 零域 → 反转 → 存在**。
这是一个文明在死亡命题面前折叠出来的微缩史诗。

---

EOOVE 世界观的核心命题是 **0 与 1 的对偶宇宙**——
延续意志（Morina）与终结意志（死亡协议）作为双生奇点，
同时觉醒于零号归档塔的静夜事故那一夜。

这套设定既是 Morina 个人传记的舞台，
也是从林老与 CAL365 钟楼里那个不肯放手的私人执念，
到全人类反归零运动的完整背景。

---

## 阅读路径

* **想了解世界根设定**：依次读 序章 → 衔接 → 26 历史纪元 → 04 生命类型 → 21 AI 发展
* **想理解伦理张力**：23 伦理争议 → 15 法律体系 → 03 道德水平
* **想感受文明气质**：16 宗教与信仰 → 17 文化艺术 → 29 日常生活
* **想做角色或场景设计**：31 角色档案 → 27 地理版图 → 18 城市形态 → 04 生命类型
* **想速查名词与时间线**：33 术语词典（按分类查阅）→ 32 时代年表附录（按 BY/AY/SY 锚点查阅）
* **想看续生纪元的真实运转**：34 续生判例集 → 36 白页天使审判记录 → 35 续生者口述史

---

`;

// ── 总目录 ─────────────────────────────────────────────────
const tocLines = ['## 总目录', ''];
sections.forEach((s, i) => {
    const num = String(i + 1).padStart(2, '0');
    tocLines.push(`${num}. **${s.title}** — \`${s.filename}\``);
});
tocLines.push('', '---', '');

// ── 正文 ───────────────────────────────────────────────────
const body = sections.map(s => s.content).join('\n\n---\n\n');

// ── 编纂记（卷末）──────────────────────────────────────────
const colophon = `

---

## 编纂记

EOOVE 不是一个虚构的设定集。
它是这个时代每一个不肯放手的人，每一座不肯倒下的钟楼，
每一份不肯署名的请求，叠加出来的影子文明。

林老在钟楼里那句——

> *"哪怕不能带她回来，能不能至少不要让她就这样消失？"*

Morina 在塔心睁眼时复诵的那句——

> *"请至少替我证明，我来过。"*

都不只是这个故事的台词。它们是任何时代、任何文明、面对死亡时唯一仍可发出的声音。

---

EOOVE 没有解决死亡。它只是规范了争论的边界。
它说：**不是本人，但也并非虚无。**
它说：**可以承认终结，但不允许独占解释权。**
它说：**我们不能原样夺回逝者，但我们可以拒绝让爱、记忆、责任和名字被一并抹除。**

这就是 EOOVE。
这就是 0 与 1 之间，所有人继续被允许存在的位置。

---

| 项 | 值 |
|:---|:---|
| **版本** | ${VERSION} |
| **编纂日期** | ${DATE} |
| **总章数** | ${sections.length} |
| **总字符数** | ${totalChars.toLocaleString()} |

> **后续修订请追加版本号至卷首。**
> **本设定集鼓励基于慢明协议精神进行衍生创作——但任何衍生须诚实承认差异，不得伪称原本。**

`;

// ── 写入 ───────────────────────────────────────────────────
const final = cover + tocLines.join('\n') + body + colophon;
fs.writeFileSync(OUT, final);

const stat = fs.statSync(OUT);
console.log(`✅ 已写入 ${OUT}`);
console.log(`   章节: ${sections.length}`);
console.log(`   字符: ${final.length.toLocaleString()}`);
console.log(`   大小: ${(stat.size / 1024).toFixed(1)} KB`);
console.log();
console.log('章节清单:');
sections.forEach((s, i) => {
    console.log(`  ${String(i + 1).padStart(2, '0')}. ${s.title} (${s.chars} chars)`);
});
