# publish-html-hub

把工作成果发布到内部「市场部 AI 工作成果共享台」（成果台）。这个 Skill **不只是发 HTML**——它会先判断成果形态，再决定走哪条通道：

| 成果形态 | 发布方式 |
|---|---|
| 已上线的网站 / 平台 / 在线文档 / **GitHub 仓库** | `--link <公网地址>` 登记为外部链接 |
| 本地 HTML Demo | 上传文件 |
| PDF | 上传文件，详情页浏览器直接翻页看 |
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

## 使用

```bash
# 已上线平台 / GitHub 仓库 → 登记外部链接
node ~/.workbuddy/skills/publish-html-hub/scripts/publish.mjs \
  --link https://github.com/630898288-collab/publish-html-hub --meta meta.json

# 本地 HTML Demo
node ~/.workbuddy/skills/publish-html-hub/scripts/publish.mjs 平台Demo.html --meta meta.json

# PDF
node ~/.workbuddy/skills/publish-html-hub/scripts/publish.mjs 月度复盘.pdf --meta meta.json

# 发布前先看形态判断（不需要令牌）
node ~/.workbuddy/skills/publish-html-hub/scripts/publish.mjs --link https://example.com/app --meta meta.json --dry-run
```

先复制 `example-meta.json` 改成自己的 `meta.json` 再执行。字段必须填全，脚本会在缺字段时拒绝发布（退出码 2）；本地地址、Office 二进制文档会被拒绝并给出替代建议（退出码 3）。

同一份成果升级时用相同 `slug` 再推一次即可，旧版本自动归档、可在详情页回滚。先发 Demo、后拿到线上地址，也用同一个 slug，不会多出一张卡片。
