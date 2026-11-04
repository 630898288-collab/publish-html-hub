#!/usr/bin/env node
// 把 HTML 成果发布到内部成果台。用法见同目录 SKILL.md
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

function loadEnvFile() {
  // 用 fileURLToPath 而不是 URL.pathname：路径含空格/中文、或 Windows 盘符时都能正确解析
  const file = fileURLToPath(new URL('../.env', import.meta.url));
  const out = {};
  try {
    for (const line of fs.readFileSync(file, 'utf8').split('\n')) {
      const m = line.match(/^\s*(HUB_URL|HUB_TOKEN|HUB_SHARECODE|HUB_AUTHOR)\s*=\s*(.+?)\s*$/);
      if (m) out[m[1]] = m[2].replace(/^["']|["']$/g, '');
    }
  } catch {
    /* 没有 .env 时静默跳过 */
  }
  return out;
}

const argv = process.argv.slice(2);
const opts = {};
const positional = [];
for (let i = 0; i < argv.length; i++) {
  const a = argv[i];
  if (a.startsWith('--')) {
    const key = a.slice(2);
    const next = argv[i + 1];
    if (next && !next.startsWith('--')) {
      opts[key] = next;
      i++;
    } else {
      opts[key] = 'true';
    }
  } else {
    positional.push(a);
  }
}

const envFile = loadEnvFile();
const HUB_URL = String(opts.url || process.env.HUB_URL || envFile.HUB_URL || '').replace(/\/$/, '');
const HUB_TOKEN = String(opts.token || process.env.HUB_TOKEN || envFile.HUB_TOKEN || '');
// 部署到线上后，平台网关要求带分享码，否则请求进不到应用就被拦下（返回 403 页面）
const HUB_SHARECODE = String(opts.code || process.env.HUB_SHARECODE || envFile.HUB_SHARECODE || '').trim();
// 本机发布者：安装时填一次，之后每次发布自动带上；命令行 --author 可临时覆盖
const DEFAULT_AUTHOR = String(process.env.HUB_AUTHOR || envFile.HUB_AUTHOR || '').trim();

if (!HUB_URL || !HUB_TOKEN) {
  console.error('缺少配置：需要 HUB_URL 与 HUB_TOKEN 环境变量，或用 --url / --token 传入。');
  console.error('令牌在成果台「管理后台 → 发布令牌」生成。');
  process.exit(1);
}

/** 线上部署时把分享码拼到 URL 上；本地没有则原样返回 */
function withShareCode(url) {
  if (!HUB_SHARECODE) return url;
  return `${url}${url.includes('?') ? '&' : '?'}sharecode=${encodeURIComponent(HUB_SHARECODE)}`;
}

// CLI 参数名 -> API 字段名
const FIELD_MAP = {
  slug: 'slug',
  title: 'title',
  summary: 'summary',
  description: 'description',
  'use-cases': 'use_cases',
  audience: 'audience',
  tags: 'tags',
  topics: 'topics',
  'search-terms': 'search_terms',
  freshness: 'freshness',
  author: 'author',
  note: 'note',
  status: 'status',
  type: 'type',
};

/** 两个头都发：网关可能占用 authorization，自定义头优先，authorization 兜底 */
function authHeaders(extra = {}) {
  return { 'x-hub-token': HUB_TOKEN, authorization: `Bearer ${HUB_TOKEN}`, ...extra };
}

const REQUIRED = [
  ['title', '成果标题，中文 ≤20 字'],
  ['summary', '一句话价值，≤30 字，让人一眼判断跟自己有没有关'],
  ['description', '2-3 句说明：这是什么、核心结论/内容、为什么值得看'],
  ['tags', '3-6 个细粒度关键词，逗号分隔'],
  ['search-terms', '6-12 个检索词，同事可能怎么搜：口语、简称、同义词、英文缩写'],
  ['freshness', '时效：evergreen / 6个月 / 一次性 / 需定期更新'],
];
const RECOMMENDED = [
  ['use-cases', '什么时候该看，2-3 条'],
  ['audience', '适合谁看，如 市场部、品类发展'],
  ['topics', '1-3 个业务大类，如 竞品分析、电商内容'],
];

// --meta meta.json 可以一次性传全部字段，字段多时比一长串命令行参数更不容易出错
const values = {};
if (opts.meta) {
  const p = opts.meta;
  if (!fs.existsSync(p)) {
    console.error(`--meta 文件不存在：${p}`);
    process.exit(1);
  }
  try {
    const j = JSON.parse(fs.readFileSync(p, 'utf8'));
    for (const [cli, api] of Object.entries(FIELD_MAP)) {
      const v = j[api] ?? j[cli];
      if (v == null) continue;
      values[cli] = Array.isArray(v) ? v.join('、') : String(v);
    }
  } catch (e) {
    console.error(`--meta 不是合法 JSON：${e.message}`);
    process.exit(1);
  }
}
for (const cli of Object.keys(FIELD_MAP)) {
  if (opts[cli] !== undefined && opts[cli] !== 'true') values[cli] = opts[cli];
}

// 作者名优先级：对话里明确指定 > 本机 .env 的 HUB_AUTHOR > 服务端兜底（会显示令牌名）
if (!String(values.author ?? '').trim() && DEFAULT_AUTHOR) values.author = DEFAULT_AUTHOR;
if (!String(values.author ?? '').trim()) {
  console.error(
    '提示：未指定发布者，卡片作者会显示为令牌名称。请在本机 .env 填 HUB_AUTHOR=你的名字，或用 --author 指定。',
  );
}

// 没给标题时从 HTML 的 <title>/<h1> 兜底，至少不会退化成文件名。
// 但覆盖升级模式（--allow-partial，语义就是"沿用旧卡片信息"）下不提取，否则会把已定好的标题顶掉。
if (!values.title && opts['allow-partial'] !== 'true' && positional[0] && fs.existsSync(positional[0])) {
  const head = fs.readFileSync(positional[0]).subarray(0, 200000).toString('utf8');
  const m = head.match(/<title[^>]*>([\s\S]*?)<\/title>/i) || head.match(/<h1[^>]*>([\s\S]*?)<\/h1>/i);
  if (m) {
    values.title = m[1].replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim().slice(0, 80);
  }
}

// 覆盖升级时只改文件、沿用旧卡片描述是合理的，此时不必强求全套字段
const isUpdate = opts['allow-partial'] === 'true' || opts['refresh-meta'] === 'true';
if (!isUpdate) {
  const missing = REQUIRED.filter(([k]) => !String(values[k] ?? '').trim());
  const weak = RECOMMENDED.filter(([k]) => !String(values[k] ?? '').trim());
  if (missing.length) {
    console.error('发布中止：以下必填字段为空，请先读一遍成果内容把它们补上再发。\n');
    console.error('缺失字段（必填）：');
    for (const [k, hint] of missing) console.error(`  --${k}  ${hint}`);
    if (weak.length) {
      console.error('\n缺失字段（建议）：');
      for (const [k, hint] of weak) console.error(`  --${k}  ${hint}`);
    }
    console.error(
      '\n提示：字段较多时推荐先写一份 meta.json，再用 --meta meta.json 提交。',
    );
    console.error('若本次只是覆盖升级、沿用旧卡片描述，加 --allow-partial 跳过校验。');
    process.exit(2);
  }
  if (weak.length) {
    console.error('注意：以下建议字段为空（不影响发布，但卡片信息会不完整）：');
    for (const [k, hint] of weak) console.error(`  --${k}  ${hint}`);
    console.error('');
  }
}

if (opts['dry-run'] === 'true') {
  console.log(JSON.stringify({ wouldSend: values, file: positional[0] ?? null, url: opts.link ?? null }, null, 2));
  process.exit(0);
}

if (opts.link) {
  const body = { url: opts.link };
  for (const [cli, api] of Object.entries(FIELD_MAP)) {
    if (values[cli] !== undefined) body[api] = values[cli];
  }
  const res = await fetch(withShareCode(`${HUB_URL}/api/publish`), {
    method: 'POST',
    headers: authHeaders({ 'content-type': 'application/json' }),
    body: JSON.stringify(body),
  });
  await handle(res);
} else {
  const file = positional[0];
  if (!file) {
    console.error('缺少文件参数：publish.mjs <文件.html> [--slug xxx]');
    process.exit(1);
  }
  if (!fs.existsSync(file)) {
    console.error(`文件不存在：${file}`);
    process.exit(1);
  }
  const form = new FormData();
  const buf = fs.readFileSync(file);
  const type = file.endsWith('.pdf')
    ? 'application/pdf'
    : file.endsWith('.md') || file.endsWith('.txt')
      ? 'text/plain'
      : 'text/html';
  form.append('file', new Blob([buf], { type }), path.basename(file));
  for (const [cli, api] of Object.entries(FIELD_MAP)) {
    if (values[cli] !== undefined) form.append(api, values[cli]);
  }
  if (opts['refresh-meta'] === 'true') form.append('refreshMeta', '1');

  const res = await fetch(withShareCode(`${HUB_URL}/api/publish`), {
    method: 'POST',
    headers: authHeaders(),
    body: form,
  });
  await handle(res);
}

async function handle(res) {
  let data = {};
  try {
    data = await res.json();
  } catch {
    /* 非 JSON 响应时按状态码处理 */
  }
  if (!res.ok) {
    console.error(`发布失败 ${res.status}：${data.error ?? JSON.stringify(data).slice(0, 300)}`);
    process.exit(1);
  }
  console.log(
    JSON.stringify(
      {
        url: data.url,
        slug: data.slug,
        version: data.version,
        created: data.created,
        title: data.title,
        incomplete: data.incomplete ?? [],
        aiGenerated: data.aiGenerated,
        aiError: data.aiError,
      },
      null,
      2,
    ),
  );
  if (data.incomplete?.length) {
    console.error(
      `\n注意：这些字段仍是空的 -> ${data.incomplete.join(', ')}\n` +
        '建议补齐后用同一 slug 再推一次（会升级版本，旧版本保留可回滚）。',
    );
  }
}
