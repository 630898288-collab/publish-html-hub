#!/usr/bin/env node
// 把工作成果发布到内部成果台：自动判断「线上链接 / 本地 HTML Demo / PDF」等形态。
// 用法与判断规则见同目录 SKILL.md
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
  'embed-url': 'embed_url',
  'embed-mode': 'embed_mode',
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

/* ------------------------------------------------------------------ *
 * 形态判断：先决定「发什么」，再决定「怎么发」
 * ------------------------------------------------------------------ */

/** 本机 / 回环 / 私网地址：同事在公网打不开，不能登记进成果台 */
function inspectWebUrl(raw) {
  let u;
  try {
    u = new URL(raw);
  } catch {
    return { local: true, host: '', reason: '链接格式不正确' };
  }
  if (u.protocol !== 'http:' && u.protocol !== 'https:') {
    return { local: true, host: u.hostname, reason: `不支持 ${u.protocol} 协议，只接受 http/https 网页地址` };
  }
  const h = u.hostname.toLowerCase().replace(/^\[/, '').replace(/\]$/, '');
  const local =
    !h ||
    h === 'localhost' || h.endsWith('.localhost') || h.endsWith('.local') ||
    h === '::1' || h === '::' || h === '0.0.0.0' ||
    /^127\./.test(h) || /^10\./.test(h) || /^192\.168\./.test(h) || /^169\.254\./.test(h) ||
    /^::ffff:(127\.|10\.|192\.168\.|172\.)/.test(h) ||
    !h.includes('.');
  const m = h.match(/^172\.(\d+)\./);
  const isPrivate172 = Boolean(m && Number(m[1]) >= 16 && Number(m[1]) <= 31);
  const cgnat = h.match(/^100\.(\d+)\./);
  const isCgnat = Boolean(cgnat && Number(cgnat[1]) >= 64 && Number(cgnat[1]) <= 127);
  if (local || isPrivate172 || isCgnat) {
    return { local: true, host: h, reason: '这是本机/内网地址，同事在公网打不开' };
  }
  return { local: false, host: h, reason: '' };
}

const FILE_KINDS = {
  '.html': 'html', '.htm': 'html',
  '.pdf': 'pdf',
  '.md': 'md', '.markdown': 'md', '.txt': 'txt',
  '.png': 'image', '.jpg': 'image', '.jpeg': 'image', '.gif': 'image', '.webp': 'image', '.svg': 'image',
};
const MIME = {
  html: 'text/html; charset=utf-8',
  pdf: 'application/pdf',
  md: 'text/plain; charset=utf-8',
  txt: 'text/plain; charset=utf-8',
  image: 'application/octet-stream',
};
const OFFICE_EXT = ['.doc', '.docx', '.ppt', '.pptx', '.xls', '.xlsx', '.rtf', '.odt', '.pages', '.key', '.numbers'];

const linkUrl = opts.link ? String(opts.link).trim() : '';
const file = positional[0] ?? '';

if (linkUrl && file) {
  console.error('只能选一种形态：要么 --link 登记线上地址，要么给一个本地文件。');
  process.exit(3);
}
if (!linkUrl && !file) {
  console.error('缺少内容：--link <公网地址> 或 <本地文件.html/.pdf>。');
  console.error('本机 localhost / 内网地址不能发布；只有本地 Demo 时请发 HTML 文件，见 SKILL.md。');
  process.exit(1);
}

let kind = 'link';
let fileName = '';
if (linkUrl) {
  const check = inspectWebUrl(linkUrl);
  if (check.local) {
    console.error(`发布中止（退出码 3）：${check.reason}${check.host ? `（${check.host}）` : ''}。`);
    console.error('');
    console.error('不要把本机/内网地址登记进成果台，同事打不开。请按 SKILL.md 处理：');
    console.error('  1. 有本地 HTML Demo → 直接传 Demo 文件，并在 description 注明「本地 Demo，线上地址待补」；');
    console.error('  2. 没有 Demo → 问用户要不要做一份 HTML Demo，或把这个系统的搭建思路单独写成一份 HTML 分享文档；');
    console.error('  3. 平台已经部署上线 → 换成公网地址再用 --link 登记。');
    process.exit(3);
  }
  kind = 'link';
} else {
  if (!fs.existsSync(file)) {
    console.error(`文件不存在：${file}`);
    process.exit(1);
  }
  const ext = path.extname(file).toLowerCase();
  if (OFFICE_EXT.includes(ext)) {
    console.error(`发布中止（退出码 3）：${ext} 是 Office 二进制文档，浏览器无法直接打开预览。`);
    console.error('');
    console.error('直接上传会得到一张只能下载、点开是乱码的死卡片。请改成：');
    console.error('  1. 转成 PDF 或 HTML 后再发布（推荐，Agent 可以直接做转换）；');
    console.error('  2. 文档已经在飞书/腾讯文档等在线且公开可读 → 用 --link <公开链接> 登记为外部链接；');
    console.error('  3. 用户坚持要传原件 → 明确告知同事「此成果需下载后用本地 Office 打开」。');
    process.exit(3);
  }
  kind = FILE_KINDS[ext] ?? '';
  if (!kind) {
    console.error(`发布中止（退出码 3）：暂不支持 ${ext || '无扩展名'} 文件。`);
    console.error('成果台可在线预览：HTML/HTM、PDF、Markdown/TXT、常见图片；其它格式请先转成上述格式。');
    process.exit(3);
  }
  fileName = path.basename(file);
}

/** 发布后的浏览器可查看性，结构化回传给 Agent，避免它凭感觉回复用户 */
const PREVIEW = {
  link: {
    browserViewable: true,
    mode: 'external',
    hint: '成果台会尝试框架式内嵌预览；对方站点若用 X-Frame-Options/CSP 拒绝，会给出原因与「新窗口打开」。飞书/需登录文档要设为「互联网上获得链接的人可阅读」，否则可能白屏。',
  },
  html: { browserViewable: true, mode: 'iframe', hint: '详情页以 iframe 直接内嵌打开，可立即查看。' },
  pdf: { browserViewable: true, mode: 'embed', hint: '浏览器内置 PDF 阅读器，详情页可直接翻页查看。' },
  md: { browserViewable: true, mode: 'iframe', hint: '详情页以纯文本/iframe 打开。' },
  txt: { browserViewable: true, mode: 'iframe', hint: '详情页以纯文本/iframe 打开。' },
  image: { browserViewable: true, mode: 'image', hint: '详情页直接显示图片。' },
};

// 没给标题时从 HTML 的 <title>/<h1> 兜底，至少不会退化成文件名。
// 但覆盖升级模式（--allow-partial，语义就是「沿用旧卡片信息」）下不提取，否则会把已定好的标题顶掉。
if (!values.title && opts['allow-partial'] !== 'true' && kind === 'html' && fs.existsSync(file)) {
  const head = fs.readFileSync(file).subarray(0, 200000).toString('utf8');
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
    console.error('\n提示：字段较多时推荐先写一份 meta.json，再用 --meta meta.json 提交。');
    console.error('登记外部链接时尤其要写清「这个平台/仓库解决什么问题、谁该去看」。');
    console.error('若本次只是覆盖升级、沿用旧卡片描述，加 --allow-partial 跳过校验。');
    process.exit(2);
  }
  if (weak.length) {
    console.error('注意：以下建议字段为空（不影响发布，但卡片信息会不完整）：');
    for (const [k, hint] of weak) console.error(`  --${k}  ${hint}`);
    console.error('');
  }
}

// 作者提示放在形态判断之后：被拦下的场景只输出该怎么做，不夹带无关噪音
if (!String(values.author ?? '').trim()) {
  console.error(
    '提示：未指定发布者，卡片作者会显示为令牌名称。请在本机 .env 填 HUB_AUTHOR=你的名字，或用 --author 指定。',
  );
}

if (opts['dry-run'] === 'true') {
  console.log(JSON.stringify({
    wouldSend: values,
    kind,
    file: fileName || null,
    link: linkUrl || null,
    preview: PREVIEW[kind],
    blocked: false,
  }, null, 2));
  process.exit(0);
}

// 形态判断与 dry-run 不需要令牌；只有真的要发请求时才校验配置，
// 这样还没装好 .env 的同事也能先用 --dry-run 看清该发什么形态。
if (!HUB_URL || !HUB_TOKEN) {
  console.error('缺少配置：需要 HUB_URL 与 HUB_TOKEN 环境变量，或用 --url / --token 传入。');
  console.error('专属令牌在成果台前台点「安装成果发布 Skill」即可领取，仓库不含通用令牌。');
  process.exit(1);
}

if (kind === 'link') {
  const body = { url: linkUrl };
  for (const [cli, api] of Object.entries(FIELD_MAP)) {
    if (values[cli] !== undefined) body[api] = values[cli];
  }
  if (opts['refresh-meta'] === 'true') body.refreshMeta = true;
  const res = await fetch(withShareCode(`${HUB_URL}/api/publish`), {
    method: 'POST',
    headers: authHeaders({ 'content-type': 'application/json' }),
    body: JSON.stringify(body),
  });
  await handle(res, kind);
} else {
  const form = new FormData();
  const buf = fs.readFileSync(file);
  form.append('file', new Blob([buf], { type: MIME[kind] }), fileName);
  for (const [cli, api] of Object.entries(FIELD_MAP)) {
    if (values[cli] !== undefined) form.append(api, values[cli]);
  }
  if (opts['refresh-meta'] === 'true') form.append('refreshMeta', '1');
  const res = await fetch(withShareCode(`${HUB_URL}/api/publish`), {
    method: 'POST',
    headers: authHeaders(),
    body: form,
  });
  await handle(res, kind);
}

async function handle(res, publishKind) {
  let data = {};
  try {
    data = await res.json();
  } catch {
    /* 非 JSON 响应时按状态码处理 */
  }
  if (!res.ok) {
    console.error(`发布失败 ${res.status}：${data.error ?? JSON.stringify(data).slice(0, 300)}`);
    if (data.hint) console.error(`诊断信息：${data.hint}`);
    process.exit(1);
  }
  const finalKind = data.asset?.type || publishKind;
  console.log(
    JSON.stringify(
      {
        url: data.url,
        slug: data.slug,
        version: data.version,
        created: data.created,
        title: data.title,
        kind: finalKind,
        preview: PREVIEW[finalKind] ?? PREVIEW.link,
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
