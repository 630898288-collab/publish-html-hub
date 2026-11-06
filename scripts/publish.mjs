#!/usr/bin/env node
// 把工作成果发布到内部成果台：自动判断「线上链接 / 本地 HTML Demo / PDF / Skill 包」等形态。
// 用法与判断规则见同目录 SKILL.md
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { checkForUpdate, applyUpdate, dismissUpdate, formatUpdate } from './update.mjs';

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

/* ------------------------------------------------------------------ *
 * 第零步：运行时检查本 Skill 有没有新版本（见 SKILL.md）
 * 结果只「提醒」，绝不自动安装：用户确认后由 Agent 再跑 --self-update。
 * 网络失败时 checkForUpdate 会静默降级，发布流程照常继续。
 * ------------------------------------------------------------------ */
let updateState = null;

if (opts['self-update'] === 'true') {
  const r = await applyUpdate();
  console.log(JSON.stringify(r, null, 2));
  process.exit(r.ok ? 0 : 1);
}
if (opts['dismiss-update'] === 'true') {
  const r = await dismissUpdate();
  console.log(JSON.stringify(r, null, 2));
  process.exit(r.ok ? 0 : 1);
}
if (opts['skip-update-check'] !== 'true') {
  updateState = formatUpdate(await checkForUpdate({ force: opts['check-update'] === 'true' }));
  if (updateState.available) {
    // stderr 单独给一行人话提示：即使后面形态判断被拦下，Agent 也看得到
    console.error(`\n[Skill 更新] ${updateState.message}\n`);
  }
}
// 只想查版本、不发布：把结构化结果直接输出给 Agent
if (opts['check-update'] === 'true' && !opts.link && !opts.skill && !positional.length) {
  console.log(JSON.stringify(updateState, null, 2));
  process.exit(0);
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
  // Skill 共享专属字段
  'skill-dir': 'skill_dir',
  'skill-download-url': 'skill_download_url',
  'skill-repo-url': 'skill_repo_url',
  'skill-requires-env': 'skill_requires_env',
  'skill-install-note': 'skill_install_note',
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
  const v = opts[cli];
  if (v === undefined) continue;
  // 参数解析把「没带值的开关」记成字符串 'true'。但 --skill-requires-env true
  // 的字面值也是 'true'，不能一律跳过，否则这条字段永远发不出去。
  if (v === 'true' && cli !== 'skill-requires-env') continue;
  values[cli] = v;
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
  skill: 'application/zip',
};
const OFFICE_EXT = ['.doc', '.docx', '.ppt', '.pptx', '.xls', '.xlsx', '.rtf', '.odt', '.pages', '.key', '.numbers'];

/** 读 SKILL.md 的 frontmatter：自动补标题、描述与技能目录名，避免 Agent 再手抄一遍 */
function readSkillFrontmatter(dir) {
  let head = '';
  try {
    head = fs.readFileSync(path.join(dir, 'SKILL.md'), 'utf8').slice(0, 8000);
  } catch {
    return { name: '', description: '' };
  }
  const block = head.match(/^---\s*\r?\n([\s\S]*?)\r?\n---/);
  const pick = (k) => {
    const m = block?.[1].match(new RegExp(`^${k}:\\s*(.+)$`, 'm'));
    return (m?.[1] ?? '').trim().replace(/^["']|["']$/g, '');
  };
  return { name: pick('name'), description: pick('description') };
}

/**
 * 把 Skill 目录打成 ZIP。凭据、依赖、版本库一律排除：
 * .env 里常含个人令牌，绝不能随安装包分发给同事。
 */
function packSkillDir(dir, skillDir) {
  const out = path.join(os.tmpdir(), `${skillDir}-${Date.now()}.zip`);
  const dirName = path.basename(dir);
  try {
    execFileSync(
      'zip',
      // 只排除真实凭据文件，保留 .env.example 模板（安装指令要靠它生成 .env）
      ['-r', '-q', out, dirName,
        '-x', '*/.env', '*/.env.local', '*/.env.*.local',
        '*/.env.production', '*/.env.development', '*/.env.test',
        '*/node_modules/*', '*/.git/*', '*.zip', '*/.DS_Store', '*/__pycache__/*'],
      { cwd: path.dirname(dir), stdio: 'pipe' },
    );
    const buf = fs.readFileSync(out);
    fs.unlinkSync(out);
    console.error(`已打包 Skill：${dirName} → ${(buf.length / 1024).toFixed(0)} KB（已排除 .env / node_modules / .git）`);
    return buf;
  } catch (e) {
    console.error(`打包失败：${e.message}`);
    console.error('需要系统 zip 命令（macOS / Linux 自带）。也可以自己打成 ZIP，再把 zip 文件路径传给脚本。');
    process.exit(3);
  }
}

const linkUrl = opts.link ? String(opts.link).trim() : '';
const file = positional[0] ?? '';
const skillArg = opts.skill && opts.skill !== 'true' ? String(opts.skill) : '';
// 「这是 Skill」的判定：目录里有 SKILL.md、文件是 .zip、或调用方显式 --type skill / --skill
const explicitSkill = String(values.type ?? '').trim() === 'skill' || Boolean(opts.skill);
const isUpdate = opts['allow-partial'] === 'true' || opts['refresh-meta'] === 'true';

if (linkUrl && (file || skillArg)) {
  console.error('只能选一种形态：要么 --link 登记线上地址，要么给一个本地文件 / Skill 目录。');
  process.exit(3);
}
if (!linkUrl && !file && !skillArg) {
  console.error('缺少内容：--link <公网地址>、<本地文件.html/.pdf>、<Skill 目录> 或 --skill <目录>。');
  console.error('本机 localhost / 内网地址不能发布；只有本地 Demo 时请发 HTML 文件，见 SKILL.md。');
  process.exit(1);
}

let kind = 'link';
let fileName = '';
let skillSourceDir = '';
let packedZip = null;

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
  kind = explicitSkill ? 'skill-link' : 'link';
  if (kind === 'skill-link') {
    values.type = 'skill';
    if (!values['skill-dir']) {
      values['skill-dir'] = (linkUrl.replace(/\/+$/, '').split('/').pop() || '').replace(/\.git$/i, '');
    }
    if (!values['skill-repo-url']) values['skill-repo-url'] = linkUrl;
    if (!values['skill-download-url']) {
      const m = linkUrl.match(/^https?:\/\/github\.com\/([^/]+)\/([^/#?]+)/i);
      if (!m) {
        console.error('发布中止（退出码 2）：非 GitHub 链接的 Skill 必须显式给 --skill-download-url <ZIP 直链>。');
        process.exit(2);
      }
      values['skill-download-url'] =
        `https://github.com/${m[1]}/${m[2].replace(/\.git$/i, '')}/archive/refs/heads/main.zip`;
      console.error('提示：已按 main 分支自动补 ZIP 下载直链；若默认分支不是 main，请用 --skill-download-url 改成实际地址。');
    }
  }
} else {
  const src = skillArg || file;
  if (!fs.existsSync(src)) {
    console.error(`文件或目录不存在：${src}`);
    process.exit(1);
  }
  const st = fs.statSync(src);
  if (st.isDirectory()) {
    if (!fs.existsSync(path.join(src, 'SKILL.md'))) {
      console.error(`发布中止（退出码 3）：目录 ${src} 里没有 SKILL.md，无法确认这是一个 Skill。`);
      console.error('Skill 目录必须含 SKILL.md；普通文件夹请先整理成 Skill 结构，或改用其它形态发布。');
      process.exit(3);
    }
    kind = 'skill';
    skillSourceDir = path.resolve(src);
    const fm = readSkillFrontmatter(skillSourceDir);
    const skillDir = String(values['skill-dir'] || fm.name || path.basename(skillSourceDir)).trim();
    values.type = 'skill';
    values['skill-dir'] = skillDir;
    // 覆盖升级时不要自动补描述：服务端会优先用显式值，反而顶掉人工修正过的旧卡片
    if (!isUpdate) {
      if (!values.title) values.title = skillDir;
      if (!values.summary) values.summary = (fm.description || '').split(/[。；;]/)[0].slice(0, 30) || `安装并使用 ${skillDir}`;
      if (!values.description) values.description = fm.description || `可直接安装到技能目录使用的 ${skillDir}。`;
    }
    fileName = `${skillDir}.zip`;
  } else {
    const ext = path.extname(src).toLowerCase();
    if (ext === '.zip') {
      kind = 'skill';
      values.type = 'skill';
      const base = path.basename(src, ext);
      if (!values['skill-dir']) values['skill-dir'] = base;
      if (!isUpdate && !values.title) values.title = base;
      fileName = path.basename(src);
    } else if (OFFICE_EXT.includes(ext)) {
      console.error(`发布中止（退出码 3）：${ext} 是 Office 二进制文档，浏览器无法直接打开预览。`);
      console.error('');
      console.error('直接上传会得到一张只能下载、点开是乱码的死卡片。请改成：');
      console.error('  1. 转成 PDF 或 HTML 后再发布（推荐，Agent 可以直接做转换）；');
      console.error('  2. 文档已经在飞书/腾讯文档等在线且公开可读 → 用 --link <公开链接> 登记为外部链接；');
      console.error('  3. 用户坚持要传原件 → 明确告知同事「此成果需下载后用本地 Office 打开」。');
      process.exit(3);
    } else {
      kind = FILE_KINDS[ext] ?? '';
      if (!kind) {
        console.error(`发布中止（退出码 3）：暂不支持 ${ext || '无扩展名'} 文件。`);
        console.error('成果台可在线预览：HTML/HTM、PDF、Markdown/TXT、常见图片；Skill 请给目录或 .zip。');
        process.exit(3);
      }
      fileName = path.basename(src);
    }
  }
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
  skill: {
    browserViewable: false,
    mode: 'download',
    hint: 'Skill 安装包不能在浏览器里预览。成果台详情页提供「下载 Skill 安装包」和「一键复制安装指令」：告诉用户可以自己下载 ZIP 安装，或把指令发给 Agent 自动安装，不要说「已发布可直接查看」。',
  },
  'skill-link': {
    browserViewable: false,
    mode: 'download',
    hint: '已登记为「Skill共享」的 GitHub 形态，成果台不存文件。详情页点下载会跳到 GitHub 的 ZIP 直链，同时提供一键复制安装指令。',
  },
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
    skillDir: values['skill-dir'] || null,
    skillDownloadUrl: values['skill-download-url'] || null,
    packedFrom: skillSourceDir || null,
    preview: PREVIEW[kind],
    blocked: false,
    update: updateState,
  }, null, 2));
  process.exit(0);
}

// Skill 目录在这里才真正打包：dry-run 不应产生临时文件。
// 现成的 .zip 不重新打包，保持发布者原本的文件名与内容。
if (kind === 'skill' && skillSourceDir) {
  packedZip = packSkillDir(skillSourceDir, values['skill-dir'] || 'skill');
}

// 形态判断与 dry-run 不需要令牌；只有真的要发请求时才校验配置，
// 这样还没装好 .env 的同事也能先用 --dry-run 看清该发什么形态。
if (!HUB_URL || !HUB_TOKEN) {
  console.error('缺少配置：需要 HUB_URL 与 HUB_TOKEN 环境变量，或用 --url / --token 传入。');
  console.error('专属令牌在成果台前台点「安装成果发布 Skill」即可领取，仓库不含通用令牌。');
  process.exit(1);
}

if (linkUrl) {
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
  const buf = packedZip || fs.readFileSync(skillArg || file);
  form.append('file', new Blob([buf], { type: kind === 'skill' ? MIME.skill : MIME[kind] }), fileName);
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
        // available=true 时 Agent 必须先问用户再更新；见 SKILL.md 第零步
        update: updateState,
        hidden: data.hidden ?? false,
      },
      null,
      2,
    ),
  );
  if (data.hidden) {
    console.error(
      '\n注意：这条成果当前被管理员隐藏，前台不显示。新版本已入库，但需要管理员在后台「取消隐藏」后同事才能看到。',
    );
  }
  if (data.incomplete?.length) {
    console.error(
      `\n注意：这些字段仍是空的 -> ${data.incomplete.join(', ')}\n` +
        '建议补齐后用同一 slug 再推一次（会升级版本，旧版本保留可回滚）。',
    );
  }
}
