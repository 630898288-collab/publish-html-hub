#!/usr/bin/env node
/**
 * 成果发布 Skill 的运行时更新检查与自更新。
 *
 * 设计约束（很重要，改之前先读）：
 *  1. 检查必须「不打扰」：网络失败 / GitHub 暂时不可达时静默降级，绝不阻断发布，也不打印报错吓用户。
 *  2. 绝不自动安装：本脚本只判断「有没有新版本」并告诉 Agent，由 Agent 先问用户，用户同意后才 --apply。
 *  3. .env 是个人凭据：更新只覆盖包内文件，所有 .env*（.env.example 除外）一律跳过，备份也不含它。
 *  4. 只从固定仓库取版本与安装包；默认 12 小时查一次，结果落在技能目录的 .update-cache.json。
 *  5. 下载的包先解压到临时目录、校验路径，再逐文件复制；不整目录删除，避免误删用户自己的东西。
 *
 * 版本源：仓库根目录的 VERSION 文件（纯文本，一行语义化版本号，如 1.6.0）。
 * 维护者每次改包都要把 VERSION 往上调，否则用户端不会收到提醒。
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
export const SKILL_ROOT = path.resolve(HERE, '..');
const VERSION_FILE = path.join(SKILL_ROOT, 'VERSION');
const ENV_FILE = path.join(SKILL_ROOT, '.env');
const CACHE_FILE = path.join(SKILL_ROOT, '.update-cache.json');

const DEFAULT_REPO = '630898288-collab/publish-html-hub';
const DEFAULT_BRANCH = 'main';
export const DEFAULT_VERSION_URL =
  `https://raw.githubusercontent.com/${DEFAULT_REPO}/${DEFAULT_BRANCH}/VERSION`;
export const DEFAULT_ZIP_URL =
  `https://github.com/${DEFAULT_REPO}/archive/refs/heads/${DEFAULT_BRANCH}.zip`;

const HOUR = 3600000;
/** 检查失败后的重试间隔：比成功间隔短，避免一次断网就 12 小时不知道有更新 */
const RETRY_MS = HOUR;

/** 只读取与更新相关的三个键，绝不把 HUB_TOKEN 之类的凭据读进内存或输出 */
function envConfig() {
  const file = {};
  try {
    for (const line of fs.readFileSync(ENV_FILE, 'utf8').split('\n')) {
      const m = line.match(/^\s*(HUB_SKILL_VERSION_URL|HUB_SKILL_ZIP_URL|HUB_SKILL_CHECK_HOURS)\s*=\s*(.+?)\s*$/);
      if (m) file[m[1]] = m[2].replace(/^["']|["']$/g, '');
    }
  } catch {
    /* 没装 .env 也能检查更新 */
  }
  const pick = (k, fb) => String(process.env[k] ?? file[k] ?? fb).trim() || fb;
  const hours = Number(pick('HUB_SKILL_CHECK_HOURS', '12'));
  return {
    versionUrl: pick('HUB_SKILL_VERSION_URL', DEFAULT_VERSION_URL),
    zipUrl: pick('HUB_SKILL_ZIP_URL', DEFAULT_ZIP_URL),
    checkHours: Number.isFinite(hours) && hours > 0 ? Math.min(hours, 720) : 12,
  };
}

export function readLocalVersion() {
  try {
    return fs.readFileSync(VERSION_FILE, 'utf8').trim().split(/\r?\n/)[0].trim() || '0.0.0';
  } catch {
    // 老版本安装包没有 VERSION 文件：当作 0.0.0，云端一旦有 VERSION 就会提醒升级
    return '0.0.0';
  }
}

/** 返回 1 表示 a 比 b 新；格式不合法时退回字符串比较 */
export function compareVersions(a, b) {
  const pa = String(a ?? '').trim().split(/[.\-_]/).map(Number);
  const pb = String(b ?? '').trim().split(/[.\-_]/).map(Number);
  if (!pa.length || !pb.length || pa.some(Number.isNaN) || pb.some(Number.isNaN)) {
    const sa = String(a ?? ''), sb = String(b ?? '');
    return sa === sb ? 0 : sa > sb ? 1 : -1;
  }
  const n = Math.max(pa.length, pb.length);
  for (let i = 0; i < n; i++) {
    const x = pa[i] ?? 0, y = pb[i] ?? 0;
    if (x !== y) return x > y ? 1 : -1;
  }
  return 0;
}

function readCache() {
  try {
    const j = JSON.parse(fs.readFileSync(CACHE_FILE, 'utf8'));
    return j && typeof j === 'object' ? j : {};
  } catch {
    return {};
  }
}

function writeCache(next) {
  // 必须与已有缓存合并后再落盘：只写 next 会把 dismissedVersion 等字段抹掉，
  // 导致用户刚拒绝过的版本在下一次检查后又冒出来反复打扰。
  const merged = { ...readCache(), ...next };
  try {
    fs.writeFileSync(CACHE_FILE, JSON.stringify(merged, null, 2), 'utf8');
  } catch {
    /* 目录只读时不影响主流程 */
  }
  return merged;
}

/** 本机/内网地址不要走系统代理（开发镜像、冒烟测试用） */
function isLocalUrl(url) {
  return /^(https?|file):\/\/(localhost|127\.|192\.168\.|10\.|\[::1\]|\[::\])/i.test(url) ||
    url.startsWith('file:');
}

function assertRemoteUrl(url) {
  if (!/^(https?|file):\/\//i.test(url)) {
    throw new Error(`不支持的更新地址协议：${String(url).slice(0, 60)}`);
  }
}

/**
 * 取远端内容。优先系统 curl（自动读 HTTPS_PROXY，国内访问 GitHub 更可靠），
 * 失败再退回 Node fetch。两者都失败就抛错，由调用方静默降级。
 */
async function fetchRemote(url, { timeoutMs = 4000, outFile = '' } = {}) {
  assertRemoteUrl(url);
  const common = ['-fsSL', '--max-time', String(Math.ceil(timeoutMs / 1000))];
  if (isLocalUrl(url)) common.push('--noproxy', '*');
  try {
    if (outFile) {
      execFileSync('curl', [...common, '-o', outFile, url], { timeout: timeoutMs + 3000, stdio: 'pipe' });
      return fs.readFileSync(outFile);
    }
    return Buffer.from(execFileSync('curl', [...common, url], {
      timeout: timeoutMs + 3000, stdio: 'pipe', encoding: 'utf8', maxBuffer: 1024 * 1024,
    }));
  } catch {
    if (url.startsWith('file:')) throw new Error('无法读取本地更新镜像');
    const res = await fetch(url, { signal: AbortSignal.timeout(timeoutMs) });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const buf = Buffer.from(await res.arrayBuffer());
    if (outFile) fs.writeFileSync(outFile, buf);
    return buf;
  }
}

function decide(state, cache) {
  const hasUpdate = Boolean(state.latestVersion) &&
    compareVersions(state.latestVersion, state.localVersion) > 0;
  const dismissed = hasUpdate && cache.dismissedVersion === state.latestVersion;
  return {
    ...state,
    hasUpdate,
    dismissed,
    // available 才是「需要现在问用户」的信号：用户明确拒绝过的版本不再重复打扰
    available: hasUpdate && !dismissed,
  };
}

/**
 * 检查是否有新版本。带缓存：默认 12 小时查一次，失败 1 小时后重试。
 * 任何网络异常都返回 available=false，调用方照常发布，不要把它当错误抛给用户。
 */
export async function checkForUpdate({ force = false } = {}) {
  const cfg = envConfig();
  const localVersion = readLocalVersion();
  const cache = readCache();
  const base = {
    localVersion,
    latestVersion: cache.latestVersion ?? null,
    checked: false,
    checkedAt: cache.checkedAt ?? null,
    reason: '',
    versionUrl: cfg.versionUrl,
    zipUrl: cfg.zipUrl,
  };
  const nextCheckAt = Number(cache.nextCheckAt ?? 0);
  if (!force && nextCheckAt && Date.now() < nextCheckAt && cache.latestVersion) {
    return decide({ ...base, checked: true, reason: 'cached' }, cache);
  }
  try {
    const raw = await fetchRemote(cfg.versionUrl, { timeoutMs: 4000 });
    const latestVersion = raw.toString('utf8').trim().split(/\r?\n/)[0].trim();
    if (!latestVersion || latestVersion.length > 40 || /\s/.test(latestVersion)) {
      throw new Error('VERSION 内容异常');
    }
    const next = writeCache({
      checkedAt: Date.now(),
      nextCheckAt: Date.now() + cfg.checkHours * HOUR,
      latestVersion,
      lastError: '',
    });
    return decide({
      ...base,
      latestVersion,
      checked: true,
      checkedAt: next.checkedAt,
      reason: 'ok',
    }, next);
  } catch (e) {
    // 失败也写缓存，避免每次调用都白等 4 秒；但保留上次成功拿到的版本号
    writeCache({
      checkedAt: Date.now(),
      nextCheckAt: Date.now() + RETRY_MS,
      lastError: String(e?.message ?? e).slice(0, 120),
    });
    return {
      ...base,
      checked: false,
      reason: 'check-failed',
      error: String(e?.message ?? e).slice(0, 120),
      hasUpdate: false,
      dismissed: false,
      available: false,
    };
  }
}

/** 给 Agent 的结构化结果：带可执行命令与「必须先问用户」的话术 */
export function formatUpdate(state) {
  const script = path.join(SKILL_ROOT, 'scripts', 'publish.mjs');
  const updateCommand = `node ${script} --self-update`;
  const dismissCommand = `node ${script} --dismiss-update`;
  return {
    available: Boolean(state.available),
    hasUpdate: Boolean(state.hasUpdate),
    currentVersion: state.localVersion,
    latestVersion: state.latestVersion,
    checked: Boolean(state.checked),
    checkedAt: state.checkedAt ? new Date(state.checkedAt).toISOString() : null,
    dismissed: Boolean(state.dismissed),
    reason: state.reason || '',
    updateCommand,
    dismissCommand,
    message: state.available
      ? `检测到成果发布 Skill 有新版本 ${state.latestVersion}（当前 ${state.localVersion}）。` +
        `请先问用户「要现在更新吗」，得到明确同意后执行 ${updateCommand}；` +
        `用户拒绝则执行 ${dismissCommand} 并继续原任务。不要自行更新。`
      : '',
  };
}

/** 用户拒绝更新：记下被拒绝的版本号，同一版本不再反复问 */
export async function dismissUpdate() {
  let cache = readCache();
  if (!cache.latestVersion) {
    const s = await checkForUpdate({ force: true });
    cache = readCache();
    if (!s.latestVersion) return { ok: false, error: '暂时拿不到云端版本号，稍后再试' };
  }
  writeCache({ ...cache, dismissedVersion: cache.latestVersion });
  return { ok: true, dismissedVersion: cache.latestVersion };
}

/** 遍历解压目录，找到含 SKILL.md 的那一层（GitHub ZIP 会多一层 -main 目录） */
function findSkillRoot(dir, depth = 0) {
  if (depth > 3) return null;
  if (fs.existsSync(path.join(dir, 'SKILL.md'))) return dir;
  for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
    if (!ent.isDirectory() || ent.name.startsWith('.')) continue;
    const hit = findSkillRoot(path.join(dir, ent.name), depth + 1);
    if (hit) return hit;
  }
  return null;
}

/** 凭据与本地状态绝不覆盖；这是自更新最重要的一条安全边界 */
function shouldSkip(name, rel) {
  if (name === '.git' || name === 'node_modules' || name === '__pycache__' || name === '.DS_Store') return true;
  if (name === '.update-cache.json') return true;
  if (name.endsWith('.zip')) return true;
  if (name.startsWith('.env')) return name !== '.env.example';
  void rel;
  return false;
}

function copyTree(src, dest, skipped) {
  let copied = 0;
  fs.mkdirSync(dest, { recursive: true });
  for (const ent of fs.readdirSync(src, { withFileTypes: true })) {
    if (shouldSkip(ent.name, '')) continue;
    const s = path.join(src, ent.name);
    const d = path.join(dest, ent.name);
    if (ent.isDirectory()) {
      copied += copyTree(s, d, skipped);
    } else if (ent.isFile()) {
      fs.copyFileSync(s, d);
      copied += 1;
    }
  }
  return copied;
}

/**
 * 用户确认后执行：下载 → 校验 → 备份 → 覆盖包内文件 → 清缓存。
 * 不删除技能目录里的任何既有文件（.env 保留、用户自己加的文件也保留）。
 */
export async function applyUpdate() {
  const cfg = envConfig();
  const from = readLocalVersion();
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'hub-skill-update-'));
  const zipPath = path.join(tmp, 'skill.zip');
  try {
    const buf = await fetchRemote(cfg.zipUrl, { timeoutMs: 30000, outFile: zipPath });
    if (!buf.length || buf.length > 20 * 1024 * 1024) throw new Error('安装包大小异常');
    if (buf.subarray(0, 2).toString() !== 'PK') throw new Error('下载内容不是 ZIP');

    // Zip Slip 防护：解压前先审一遍条目路径
    const entries = execFileSync('unzip', ['-Z1', zipPath], { encoding: 'utf8', maxBuffer: 4 * 1024 * 1024 })
      .split('\n').map((s) => s.trim().replace(/\\/g, '/')).filter(Boolean);
    for (const e of entries) {
      if (e.startsWith('/') || /^[A-Za-z]:/.test(e) || e.split('/').includes('..')) {
        throw new Error(`安装包含非法路径：${e}`);
      }
    }
    execFileSync('unzip', ['-q', '-o', zipPath, '-d', tmp], { stdio: 'pipe' });
    const src = findSkillRoot(tmp);
    if (!src) throw new Error('安装包里找不到 SKILL.md，已中止，本地文件未改动');

    const remoteVersionFile = path.join(src, 'VERSION');
    const to = fs.existsSync(remoteVersionFile)
      ? fs.readFileSync(remoteVersionFile, 'utf8').trim().split(/\r?\n/)[0].trim()
      : '(未标注)';

    // 备份不含 .env：令牌不该被复制到临时目录
    let backup = '';
    try {
      backup = path.join(os.tmpdir(), `publish-html-hub-backup-${Date.now()}.zip`);
      execFileSync('zip', [
        '-r', '-q', backup, path.basename(SKILL_ROOT),
        '-x', '*/.env', '*/.env.local', '*/.env.*.local',
        '*/.env.production', '*/.env.development', '*/.env.test',
        '*/node_modules/*', '*/.git/*', '*.zip', '*/.DS_Store',
      ], { cwd: path.dirname(SKILL_ROOT), stdio: 'pipe' });
    } catch {
      backup = '';
    }

    const copied = copyTree(src, SKILL_ROOT, []);
    // 更新完立即让缓存失效：下次调用重新核对，别拿旧版本号继续提醒
    try { fs.unlinkSync(CACHE_FILE); } catch { /* ignore */ }

    return {
      ok: true,
      from,
      to,
      copiedFiles: copied,
      preserved: ['.env', '.update-cache.json（已重置）', '用户自行添加的文件'],
      backup: backup || '(备份失败，但更新已完成)',
      note: '更新只覆盖包内文件，未删除任何本地文件；.env 中的专属令牌保持不变。',
    };
  } catch (e) {
    return { ok: false, error: String(e?.message ?? e), note: '本地 Skill 未改动，可稍后重试或手动下载 ZIP 覆盖。' };
  } finally {
    try { fs.rmSync(tmp, { recursive: true, force: true }); } catch { /* ignore */ }
  }
}

// 作为独立命令运行时输出 JSON 给 Agent；被 publish.mjs import 时不执行。
// 用文件名而不是全路径比对：macOS 上 /tmp 是 /private/tmp 的符号链接，
// argv[1] 与 import.meta.url 可能一个解析过、一个没解析过，全路径相等判断会误判。
const invokedDirectly = Boolean(process.argv[1] && /(?:^|[\\/])update\.mjs$/i.test(process.argv[1]));
if (invokedDirectly) {
  const args = process.argv.slice(2);
  if (args.includes('--apply') || args.includes('--self-update')) {
    const r = await applyUpdate();
    console.log(JSON.stringify(r, null, 2));
    process.exit(r.ok ? 0 : 1);
  } else if (args.includes('--dismiss')) {
    const r = await dismissUpdate();
    console.log(JSON.stringify(r, null, 2));
    process.exit(r.ok ? 0 : 1);
  } else {
    const s = await checkForUpdate({ force: args.includes('--force') || args.includes('--check-update') });
    console.log(JSON.stringify(formatUpdate(s), null, 2));
  }
}
