# publish-html-hub

把工作成果发布到内部「市场部 AI 工作成果共享台」（成果台）。这个 Skill **不只是发 HTML**——它会先判断成果形态，再决定走哪条通道：

| 成果形态 | 发布方式 |
|---|---|
| 已上线的网站 / 平台 / 在线文档 / **GitHub 仓库** | `--link <公网地址>` 登记为外部链接 |
| 本地 HTML Demo | 上传文件 |
| PDF | 上传文件，详情页浏览器直接翻页看 |
| **本地 Skill 目录（含 `SKILL.md`）或 `.zip` 安装包** | `--skill <目录>` 或 `<文件.zip>`，自动打包并发布为「Skill共享」，详情页提供下载与一键复制安装指令 |
| **Skill 已发布到 GitHub** | `--link <仓库> --type skill`，只登记链接与 ZIP 下载直链，不占成果台存储 |
| 本机 `localhost` / 内网地址 | **不发布**，改建议发 HTML Demo；没有 Demo 就问用户要不要做 Demo，或把系统搭建思路写成一份 HTML 分享文档 |
| Word / PPT / Excel | 浏览器打不开，先转成 PDF/HTML，或找公开在线链接走 `--link` |

发布后脚本会返回 `preview` 字段，告诉 Agent 这份成果能不能在浏览器直接打开看。完整判断规则、字段规格、slug 覆盖升级与报错处理见 [SKILL.md](./SKILL.md)。

需要 Node.js 18 或更高版本。仓库**不含任何发布令牌**。

## 安装到 WorkBuddy

在成果台前台点 **「安装发布 Skill」**，选「复制指令给 Agent」，把整段指令粘给 Agent 即可自动下载、安装并写好 `.env`（指令里自带你的专属令牌）。

手动安装：

1. 在仓库页面点 **Code → Download ZIP**（或 `git clone`），把含 `SKILL.md`、`scripts/`、`.env.example` 的目录重命名为 `publish-html-hub`。
2. 放到 `~/.workbuddy/skills/publish-html-hub`。
3. 在技能目录执行 `cp .env.example .env`，填写四项配置。

## 安装到 Codex

同上，把目录放到 `~/.codex/skills/publish-html-hub`，命令示例里的 `~/.workbuddy/skills/` 换成 `~/.codex/skills/`。

## 配置

| 变量 | 说明 |
|---|---|
| `HUB_URL` | 成果台裸域名，不带 `?sharecode` |
| `HUB_TOKEN` | **专属发布令牌**：去成果台前台点「安装发布 Skill」领取。不要找别人要、不要提交到 Git |
| `HUB_SHARECODE` | 线上部署才需要，分享码在成果台访问链接里 |
| `HUB_AUTHOR` | 本机真实署名，之后每次发布自动带上 |

> 线上站与本地站是两套独立数据库，令牌不通用。发布报 403 时先看返回里的 `hint`，常见原因就是拿本地库令牌发到线上。

**可选：更新源**（默认指向本仓库 `main` 分支）

| 变量 | 说明 |
|---|---|
| `HUB_SKILL_VERSION_URL` | 版本文件 `VERSION` 直链，默认 `https://raw.githubusercontent.com/630898288-collab/publish-html-hub/main/VERSION` |
| `HUB_SKILL_ZIP_URL` | 新安装包 ZIP 直链，默认 GitHub `archive/refs/heads/main.zip` |
| `HUB_SKILL_CHECK_HOURS` | 检查间隔小时数，默认 12 |

## 自动更新（安装后无需手动管）

包根目录的 `VERSION` 是版本标识。`scripts/update.mjs` 会在每次发布时自动比对云端与本地版本（默认 12 小时查一次，
结果缓存在技能目录 `.update-cache.json`），并在输出 JSON 里给出 `update` 字段。**检测到新版本只会提醒，不会自动安装**：
Agent 必须先问用户，用户同意后才执行更新。

```bash
# 只看有没有新版本（输出 JSON 给 Agent）
node ~/.workbuddy/skills/publish-html-hub/scripts/update.mjs
node ~/.workbuddy/skills/publish-html-hub/scripts/update.mjs --force   # 忽略缓存

# 用户确认后执行更新；或直接在 publish.mjs 上跑
node ~/.workbuddy/skills/publish-html-hub/scripts/update.mjs --apply
node ~/.workbuddy/skills/publish-html-hub/scripts/publish.mjs --self-update

# 用户说「先不更新」：记下被忽略的版本，同一版本不再反复问
node ~/.workbuddy/skills/publish-html-hub/scripts/publish.mjs --dismiss-update

# 离线时跳过检查
node ~/.workbuddy/skills/publish-html-hub/scripts/publish.mjs ... --skip-update-check
```

更新会下载仓库 ZIP、校验条目路径、备份当前包到系统临时目录，再逐文件覆盖；**所有 `.env*`（`.env.example` 除外）一律跳过，
专属令牌不会丢也不会被写进安装包**。检查失败或 GitHub 不可达时静默降级，不影响发布。

> 维护者注意：每次改包都要把根目录 `VERSION` 往上调并同步到 GitHub，否则已安装的同事收不到提醒。

## 使用

```bash
# 已上线平台 / GitHub 仓库 → 登记外部链接
node ~/.workbuddy/skills/publish-html-hub/scripts/publish.mjs \
  --link https://github.com/630898288-collab/publish-html-hub --meta meta.json

# 本地 HTML Demo
node ~/.workbuddy/skills/publish-html-hub/scripts/publish.mjs 平台Demo.html --meta meta.json

# PDF
node ~/.workbuddy/skills/publish-html-hub/scripts/publish.mjs 月度复盘.pdf --meta meta.json

# 发布一个本地 Skill（自动打包，排除 .env 等凭据）
node ~/.workbuddy/skills/publish-html-hub/scripts/publish.mjs \
  --skill ~/.workbuddy/skills/geo-report-writer --meta meta-skill.json

# 发布 GitHub 上的 Skill（不上传文件）
node ~/.workbuddy/skills/publish-html-hub/scripts/publish.mjs \
  --link https://github.com/630898288-collab/geo-report-writer --type skill --meta meta-skill.json

# 把当前对话总结成「精选对话」（Agent 按模板生成 conversation.json 后提交）
node ~/.workbuddy/skills/publish-html-hub/scripts/publish.mjs \
  --conversation /tmp/conversation.json --title "从盲测到体验即内容" --tags "净饮机、事件营销"

# 发布前先看形态判断（不需要令牌）
node ~/.workbuddy/skills/publish-html-hub/scripts/publish.mjs --link https://example.com/app --meta meta.json --dry-run
```

普通成果复制 `example-meta.json`、Skill 共享复制 `example-meta-skill.json` 改成自己的 `meta.json` 再执行。字段必须填全，脚本会在缺字段时拒绝发布（退出码 2）；本地地址、Office 二进制文档会被拒绝并给出替代建议（退出码 3）。

发布 Skill 目录时需要系统 `zip` 命令（macOS / Linux 自带）。打包会保留 `.env.example` 模板、排除 `.env` 等真实凭据；现成 zip 不重新打包，由发布者自己确认里面没有令牌。

同一份成果升级时用相同 `slug` 再推一次即可，旧版本自动归档、可在详情页回滚。先发 Demo、后拿到线上地址，也用同一个 slug，不会多出一张卡片。

## 精选对话

模板见 `example-conversation.json`，完整规则见 SKILL.md「形态 5」。**Skill 不读取聊天记录** —— 由装有它的 Agent 依据自身上下文，按固定 6 区块（为什么聊 / 思维链导图 / 碰撞火花 / 聊出了什么 / 可带走 / 原始摘录）总结成 JSON，再用 `--conversation` 上传。

服务端校验必填字段（一句话结论、要解决的问题、脉络节点 ≥2、关键结论 ≥1）并重写成标准形状，缺字段拒收；因此每个人在详情页看到的区块顺序完全一致。前台有独立的「精选对话」分区，导图节点可点击查看每一轮「人的质疑 → AI 回应 → 转向结果」。默认不上传对话全文，原话摘录需人工勾选并脱敏。
