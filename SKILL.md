---
name: publish-html-hub
description: 把工作成果发布到内部「市场部AI工作成果共享台」（简称成果台），让同事能搜到、点开看或用上。会先判断成果形态：已上线的网站/平台/在线文档/GitHub 仓库登记为外部链接，本地 HTML Demo 与 PDF 直接上传，Skill（目录含 SKILL.md 或 .zip 安装包）按「Skill共享」发布并提供下载与安装指令，本机 localhost/内网链接不发布并建议改发 HTML Demo 或写一份搭建思路文档，Word/PPT 等浏览器打不开的文件先转成 PDF/HTML。当用户说"发布到成果台""推到成果台""发到共享台""存到成果库""上传到导航站""发到内部网站""把这个网站/链接/文档/Skill 分享给同事"，或明确表示某份成果值得沉淀给同事时使用该技能。支持用同一 slug 覆盖升级版本。安装后每次运行会自动检查 GitHub 上的新版本，检测到更新时先询问用户是否升级。
---

# 把成果发布到市场部AI工作成果共享台

> 下文统一简称「成果台」。

## 第零步：运行时自动检查本 Skill 有没有新版本（别跳过）

**每次使用这个 Skill 时**，脚本都会自动查一次云端 `VERSION`（默认 12 小时一次，带本地缓存，网络失败静默跳过），
并在输出的 JSON 里给出 `update` 字段；也可以单独跑一次看结果：

```bash
node ~/.workbuddy/skills/publish-html-hub/scripts/update.mjs
# 或（忽略缓存强制查）：node .../scripts/publish.mjs --check-update
```

`update.available === true` 表示 GitHub 上的 Skill 比本机新。**这时必须先问用户，不能自己更新**：

1. 用一句话问：「检测到成果发布 Skill 有新版本 `update.latestVersion`（当前 `update.currentVersion`），要现在更新吗？」
2. 用户明确同意 → 执行 `update.updateCommand`（即 `node .../scripts/publish.mjs --self-update`），等返回 `ok: true` 后**重新执行原本的发布任务**（脚本已换成新版）。更新会自动保留 `.env`，不用重新填令牌。
3. 用户拒绝或说「先不用」 → 执行 `update.dismissCommand`（`--dismiss-update`），同一版本不再反复问，然后继续原任务，**不要反复追问**。
4. 网络检查失败（`update.checked: false`）→ 什么也不用说，照常发布，不要把它当成报错告诉用户。

用户主动说「更新一下发布 Skill / 升级 Skill」时不用再问，直接跑 `--self-update`。

**硬规则**：绝不自动下载覆盖、绝不改动或重填 `.env`、绝不把令牌写进安装包；更新只覆盖包内文件，不删除用户自己加的文件。
只想跳过检查时用 `--skip-update-check`（例如离线演示）。维护者每改一次包都要把根目录 `VERSION` 往上调，否则用户端收不到提醒。

## 第一步：先判断「发什么形态」（最重要，别跳过）

这个 Skill **不只发 HTML**。发布前你必须先判断用户手上的是什么，再决定走哪条通道。不要一看到「发布」就去找 HTML 文件，也不要把用户给的链接原样丢上去。

| 用户给的东西 | 判断 | 怎么发 |
|---|---|---|
| **已上线的公网地址**：网站、平台、应用、在线文档、看板、**GitHub 仓库**、已发布的 Skill 页面 | `https://` 且不是本机/内网，同事在公网能打开 | **登记外部链接**：`--link <地址>`。不上传文件、不另存一份页面 |
| **本机 / 内网地址**：`localhost`、`127.0.0.1`、`192.168.x`、`10.x`、`172.16~31.x`、`0.0.0.0`、`::1`、`file://`、本机临时端口（`:3000`、`:5173` 等开发预览地址） | 只在你自己电脑上能开 | **禁止发布**。跳到下面「只有本地 Demo 时怎么办」 |
| **本地 HTML / HTM 文件** | 最常见的 Demo 形态 | 上传文件 |
| **本地 PDF 文件** | 浏览器能直接翻页看 | 上传文件，发布后告诉用户可在详情页直接看 |
| **本地 Word / PPT / Excel**（`.doc .docx .ppt .pptx .xls .xlsx`） | 浏览器**打不开**，会变成一张只能下载的死卡片；`.docx` 还会被误判成 HTML 显示乱码 | **不要直接传二进制**。先转成 PDF 或 HTML 再发；如果文档已经在飞书/腾讯文档等在线且有公开可读链接，改走 `--link` |
| **要分享的就是一个 Skill**：本地目录里有 `SKILL.md`，或手上是一个 `.zip` 安装包 | 同事的需求是「下载安装包」或「复制安装指令让 Agent 装」，不是打开网页看 | **走 Skill 共享**：`--skill <目录>` 或直接给 `<文件.zip>`。脚本自动打包 / 上传，成果台详情页会给下载按钮和一键复制安装指令。详见下面「Skill 共享怎么发」 |
| **Skill 已经发布到 GitHub** | 公网可访问，不必把文件再传一份到成果台 | **登记为 Skill 共享**：`--link <仓库地址> --type skill`。脚本会自动补 `main` 分支的 ZIP 下载直链；不是 `main` 就用 `--skill-download-url` 指定 |
| 用户说「我做了个网站 / 平台」，但**既没给地址也没给文件** | 无法判断 | **先问一句**：「已经发布到线上了吗？给我公网地址；还是只有本地跑的 Demo？」不要自己猜 |

判断要自己做完，**不要每件事都反问用户**。只有两种情况必须开口问：① 说不清是线上还是本地；② 只有本地地址、又没有 HTML Demo（见下）。

### 只有本地 Demo 时怎么办

用户给你一个 `http://localhost:xxxx` 或 `file:///...`，说明服务/页面只跑在他自己电脑上，**别人打不开**。不要把它登记进成果台。按顺序处理：

1. 有现成的 HTML Demo 文件 → 直接上传这份 Demo，并在 `description` 里注明「本地 Demo 版本，线上地址待补」，让同事知道这不是线上系统。
2. 没有 Demo → **必须问用户**，给两个明确选项，让他选一个再做：
   - 「要我把这个平台做一份 **HTML Demo**（静态可点、还原关键界面和流程）发上来吗？」
   - 「或者我把**这个系统的搭建思路单独写成一份 HTML 分享文档**（架构、模块划分、技术选型、踩坑与复盘）发上来？」
   - 用户没选之前，不要自己编一份内容冒充他的成果发出去。
3. 用户后来把平台部署上线了 → 用**同一个 slug** 再推一次 `--link`，卡片会升级成外部链接版本，旧的 Demo 留在版本历史里可回滚。

### Skill 共享怎么发（这个 Skill 自己也能被这样分享）

Skill 是「要被安装使用」的成果，不是「打开看」的文档。成果台给它单独的资料类型 **Skill共享**：详情页提供下载按钮与一键复制安装指令，不做内嵌预览。

三种形态，**判断完直接做，不要再问用户发文件还是发链接**：

| 手上有什么 | 命令 | 说明 |
|---|---|---|
| 本地 Skill 目录（含 `SKILL.md`） | `node ... --skill <目录> --meta meta.json` | 脚本自动打包 ZIP、从 frontmatter 补标题/描述/技能目录名，按 `type=skill` 上传 |
| 现成的 `.zip` 安装包 | `node ... <文件.zip> --meta meta.json` | 原样上传，技能目录名默认取 zip 文件名 |
| 已发布到 GitHub | `node ... --link <仓库> --type skill --meta meta.json` | 不上传文件，只登记仓库 + ZIP 下载直链，不占成果台存储 |

**关键判断点**：GitHub 链接本身看不出是不是 Skill，必须由你判断后显式加 `--type skill`；本地目录则靠 `SKILL.md` 自动识别，`.zip` 靠扩展名自动识别。用户说「把我做的这个 Skill 分享给同事」时，别按普通网页发。

**Skill 专属字段**（命令用短横线参数，meta.json 里用下划线字段名）：

| 参数 / meta 字段 | 说明 |
|---|---|
| `--skill-dir` / `skill_dir` | 安装到 `~/.workbuddy/skills/` 的目录名。不填时：目录形态取 `SKILL.md` 的 `name`，zip 形态取文件名，GitHub 形态取仓库名 |
| `--skill-download-url` / `skill_download_url` | 安装包 ZIP 直链。GitHub 形态必填，脚本按 `main` 分支自动补；默认分支不是 main 时必须自己指定 |
| `--skill-repo-url` / `skill_repo_url` | 仓库 / 来源地址，详情页「查看来源」用 |
| `--skill-requires-env` / `skill_requires_env` | 需要 `.env` 配置时填 `true`，安装指令会提示填凭据且不要提交到 Git |
| `--skill-install-note` / `skill_install_note` | 安装补充说明，如「需要先配置飞书多维表权限」 |

**打包规则（安全）**：目录形态用系统 `zip` 打包，自动排除 `.env`、`.env.local`、`.env.production` 等凭据文件，以及 `node_modules`、`.git`、`__pycache__`、`*.zip`；**保留 `.env.example` 模板**。不要把令牌写进 `SKILL.md` 或脚本。现成 zip 不重新打包，由发布者自己确保里面没有凭据。

**必填字段仍然是全套**（标题 / 一句话价值 / 作用与价值 / 标签 / 检索词 / 时效）。目录形态会自动从 `SKILL.md` 的 `name`、`description` 补标题与描述，但 `tags`、`search-terms`、`freshness` 要按这份 Skill 的实际用途写，否则同事搜不到。

### 发布后要确认「能不能在浏览器直接打开看」

脚本返回的 JSON 里有 `preview` 字段（`browserViewable` / `mode` / `hint`），按它给用户结论：

- `html` / `pdf` / `image`：详情页直接内嵌打开，可以说「已发布，可直接看」。
- `link`：成果台会尝试框架式内嵌预览；若对方站点用 `X-Frame-Options` / CSP 拒绝，页面会给出原因和「新窗口打开」按钮。飞书/内部文档需要登录时可能白屏，要把分享权限设为「互联网上获得链接的人可阅读」。
- `skill` / `skill-link`：`browserViewable` 为 `false`。**不要说「已发布可直接查看」**，正确说法是「已发布到 Skill共享分类，同事可下载安装包，或一键复制安装指令发给 Agent 自动安装」。
- `browserViewable: false`：**主动说明并给替代方案**（转成 PDF/HTML、或改发在线链接），不要说「已发布可查看」。

## 第二步：元数据由你来填，不要指望服务端

这份成果是**你在本次会话里生成的，或用户刚交给你的**，你比服务端更清楚它讲的是什么、解决什么问题、对谁有用。服务端可能没接 LLM，就算接了也只是读正文猜——猜出来的描述远不如你写的准。

所以：**发布前必须自己填好全部字段。** 脚本会在字段缺失时直接拒绝发布（退出码 2）并告诉你缺什么，补齐后再发一次即可。

不要出现「只发了链接和标题」的废卡片——那种卡片同事搜不到、也判断不出跟他有没有关系，等于没发。**登记外部链接时尤其容易犯这个错**：链接只是入口，价值、适用场景、检索词都得你写。

## 配置（首次安装填一次）

在本技能目录把 `.env.example` 复制成 `.env` 并填写四项。**仓库里只有空模板，不含任何令牌**：

| 变量 | 说明 |
|---|---|
| `HUB_URL` | 成果台地址（裸域名，不带 `?sharecode`） |
| `HUB_TOKEN` | 你的**专属发布令牌**：去成果台前台点「安装成果发布 Skill」即可领到，弹窗里也有一段可直接发给 Agent 的安装指令。**不要找别人要令牌，不要把令牌写进任何成果文件或提交到 Git** |
| `HUB_SHARECODE` | 线上部署才需要：平台网关要求带分享码，否则请求进不到应用。分享码就在成果台链接里（`https://xxx/?sharecode=XXXXXX`），也可在「安装成果发布 Skill」弹窗看到 |
| `HUB_AUTHOR` | **本机发布者名字**，安装时填一次自己的名字，之后每次发布自动带上 |

配置也可用同名环境变量或 `--url / --token / --code` 临时覆盖。换地址时改本目录 `.env`；发布报 403 时先看返回的 `hint`，不要自行乱改配置。

**更新源（可选）**：默认指向 GitHub 仓库 `630898288-collab/publish-html-hub` 的 `main` 分支。仓库换了地址、默认分支不是 `main`，或在内网做了镜像时，在 `.env` 里加：

| 变量 | 说明 |
|---|---|
| `HUB_SKILL_VERSION_URL` | 版本文件 `VERSION` 的直链（纯文本一行版本号） |
| `HUB_SKILL_ZIP_URL` | 新安装包 ZIP 直链 |
| `HUB_SKILL_CHECK_HOURS` | 检查间隔小时数，默认 12；失败后固定 1 小时重试 |

> **线上站和本地站是两套独立数据库，令牌不通用**：在 `localhost:8787` 后台生成的令牌拿去线上用必然 403。

## 自动更新机制（背景，不必记命令）

安装包根目录有 `VERSION`，`scripts/update.mjs` 负责比对云端与本地版本、缓存结果、下载并安全覆盖。
覆盖前会审一遍 ZIP 条目路径（防目录穿越）、备份当前包到系统临时目录，**排除所有 `.env*`（保留 `.env.example`）**，
然后逐文件复制，不整目录删除。检查状态写在技能目录 `.update-cache.json`，不会随安装包分发。
更新完成后缓存自动失效，下次运行重新核对。

## 发布者名字：不要自己编

成果台是多人共用的，作者名必须反映**真实发布者**。脚本会自动带上本机 `.env` 里的 `HUB_AUTHOR`，所以正常情况下你**不需要、也不应该**凭空写一个名字：

- 用户没说作者是谁 → 什么都不传（meta.json 里也不要写 `author`），脚本自动用本机配置
- 用户明确说了「作者写 XXX」→ 用 `--author XXX` 或 meta.json 的 `author` 覆盖
- 本机还没配 `HUB_AUTHOR` → 提醒用户去 `.env` 填自己的名字，**不要用 `Martin` 或任何别人的名字代替**
- 两者都没有时脚本会打印提示（不阻断发布），此时服务端兜底会把作者显示成令牌名称

⚠️ **不要照抄本文档示例里的名字，也不要沿用历史会话或记忆里的作者名。** 每个同事安装时都填自己的 `HUB_AUTHOR`，这才是作者名的唯一来源。

## 字段规格

| 字段 | 必填 | 标准 | 示例 |
|---|---|---|---|
| `title` | ✅ | 中文 ≤20 字，说清「是什么」，不要写成文件名或裸 URL | `营销数据看板 · 竞品与社媒监听` |
| `summary` | ✅ | **一句话价值**，≤30 字。同事扫一眼要能判断「跟我有没有关」。写价值，不写内容清单 | `一处看全竞品动作与社媒声量` |
| `description` | ✅ | 2-3 句：这是什么 → 核心结论/内容 → 为什么值得看 | `把竞品情报、社媒监听与电商表现汇到同一看板，支持按品类与时间对比。适合做月度复盘和投放调整时快速定位异常。` |
| `tags` | ✅ | 3-6 个细粒度关键词，逗号分隔 | `数据看板、竞品情报、社媒监听、营销复盘` |
| `search-terms` | ✅ | **6-12 个**，同事「可能怎么搜」：口语、简称、同义词、英文缩写、相关业务词。这是能不能被搜到的关键 | `看板、dashboard、竞品、社媒、声量、口碑、月报、复盘、投放、GEO` |
| `freshness` | ✅ | 时效：`evergreen` / `6个月` / `一次性` / `需定期更新` | `需定期更新` |
| `use-cases` | 建议 | 什么时候该看，2-3 条 | `月度复盘时、写投放策略时、追踪竞品上新时` |
| `audience` | 建议 | 适合谁看 | `市场部、品类发展、电商内容` |
| `topics` | 建议 | 1-3 个业务大类，粒度要粗 | `数据分析` |
| `author` | **自动带** | 脚本自动读取本机 `.env` 的 `HUB_AUTHOR`。**不要自己编造作者名、不要照抄示例**；只有用户明确说了发布者是谁，才用 `--author` 覆盖 | `张三`（仅用户明确指定时） |
| `note` | 可选 | 这版改了什么，会显示在版本历史上 | `v1 首版` / `v2 换成了线上正式地址` |

**常见错误**：
- `summary` 写成内容清单（「包含竞品对比、价格分析、渠道策略」）→ 应该写价值和结论
- `search-terms` 只把标题拆开 → 应该想同事会用什么口语词搜
- 登记外部链接时把 `description` 写成「这是一个链接」→ 要写清这个平台/仓库解决什么问题、谁该去看

## 用法

字段多（尤其 `description` 较长）时，**优先写一份 `meta.json` 再用 `--meta` 提交**，比拼一长串命令行参数可靠得多。仓库里有 `example-meta.json` 可复制。

```bash
# 形态 1：平台已经部署上线 → 登记外部链接（不上传任何文件）
node ~/.workbuddy/skills/publish-html-hub/scripts/publish.mjs \
  --link https://work-hub-50935.app.workbuddy.host/ --meta /tmp/meta.json
```

```bash
# 形态 1b：GitHub 上的仓库 / Skill 也能作为外部链接分享上来
node ~/.workbuddy/skills/publish-html-hub/scripts/publish.mjs \
  --link https://github.com/630898288-collab/publish-html-hub --meta /tmp/meta.json
```

```bash
# 形态 2：本地 HTML Demo → 上传文件
node ~/.workbuddy/skills/publish-html-hub/scripts/publish.mjs 平台Demo.html --meta /tmp/meta.json

# 形态 3：PDF → 上传，浏览器可直接翻页
node ~/.workbuddy/skills/publish-html-hub/scripts/publish.mjs 月度复盘.pdf --meta /tmp/meta.json

# 形态 4：分享一个本地 Skill → 自动打包并按「Skill共享」发布
node ~/.workbuddy/skills/publish-html-hub/scripts/publish.mjs \
  --skill ~/.workbuddy/skills/geo-report-writer --meta /tmp/meta-skill.json

# 形态 4b：手上已经是 zip 安装包 → 直接上传
node ~/.workbuddy/skills/publish-html-hub/scripts/publish.mjs geo-report-writer.zip --meta /tmp/meta-skill.json

# 形态 4c：Skill 已发布到 GitHub → 只登记链接，不上传文件
node ~/.workbuddy/skills/publish-html-hub/scripts/publish.mjs \
  --link https://github.com/630898288-collab/geo-report-writer --type skill --meta /tmp/meta-skill.json
```

```bash
# 字段少时也可以直接用参数
node ~/.workbuddy/skills/publish-html-hub/scripts/publish.mjs 平台Demo.html \
  --slug marketing-dashboard-demo \
  --title "营销数据看板 Demo" \
  --summary "一处看全竞品动作与社媒声量" \
  --description "把竞品情报、社媒监听与电商表现汇到同一看板。适合月度复盘和投放调整时快速定位异常。" \
  --tags "数据看板、竞品情报、社媒监听、营销复盘" \
  --search-terms "看板、dashboard、竞品、社媒、声量、口碑、月报、复盘、投放" \
  --freshness "需定期更新" \
  --note "v1 本地 Demo，线上地址待补"
```

```bash
# 发布前先看看会提交什么、属于哪种形态（不真的上传）
node ... --meta /tmp/meta.json --dry-run --link https://example.com/app
node ... --meta /tmp/meta.json --dry-run 平台Demo.html
```

> Codex 环境把上面路径里的 `~/.workbuddy/skills/` 换成 `~/.codex/skills/`。

**不要这样发**：
```bash
# ❌ 本机地址，同事打不开；脚本会直接拒绝（退出码 3）
node ... --link http://localhost:3000/ --meta /tmp/meta.json
# ❌ Word 二进制，浏览器打不开；脚本会拒绝并建议你转成 PDF/HTML（退出码 3）
node ... 方案.docx --meta /tmp/meta.json
```

## slug 规则（关键）

**slug 是成果的稳定标识。** 想覆盖旧版本，第二次推送必须用**同一个 slug**，否则会变成两张卡片。

- 英文小写 + 短横线：`marketing-dashboard`、`geo-monitor-weekly`
- **必须显式传**，不传时服务端用文件名/标题生成，后续想覆盖就要记住这个名字，容易出错
- `--link` 与文件上传**共用同一套 slug**：先发 Demo、后发线上地址，用同一个 slug 就是一次升级，不会多出一张卡片
- 返回里的 `slug` 记下来，下次覆盖用同一个

## 覆盖升级（做了一版更好的）

用同一个 slug 再推一次即可：

```bash
# Demo 升级成正式线上地址
node ... --link https://正式域名/ --meta /tmp/meta-v2.json
```

- 版本号 +1（v1 → v2），卡片上会显示版本
- 旧版本自动归档，**可回滚**（成果台详情页 → 版本历史）
- **默认沿用旧卡片的描述和标签**（你在后台人工改过的不会被冲掉）
- 想连同描述一起更新 → 加 `--refresh-meta`
- 只想换文件、沿用旧描述 → 只传 `--slug` 和 `--note`，加 `--allow-partial` 跳过字段校验

## 报错处理

| 退出码 / 提示 | 原因 | 怎么做 |
|---|---|---|
| 退出码 2 + 「发布中止：以下必填字段为空」 | 字段没填全 | 按提示补齐再发；这是设计好的拦截，不要绕过 |
| **退出码 3 + 「这是本机/内网地址」** | 想把 `localhost` / 私网地址登记上来 | 改发 HTML Demo；若已上线就换公网地址。不要试图绕过校验 |
| **退出码 3 + 「浏览器无法直接预览」** | Word/PPT/Excel 等二进制文档 | 转成 PDF 或 HTML 再发；或找在线公开链接走 `--link` |
| **退出码 3 + 「目录里没有 SKILL.md」** | 把一个普通文件夹当 Skill 发 | 确认目录结构；不是 Skill 就按其它形态发 |
| **退出码 3 + 「打包失败」** | 系统缺 `zip` 命令 | 自己打成 ZIP 后把文件路径传给脚本 |
| **退出码 2 + 「非 GitHub 链接的 Skill 必须显式给下载直链」** | `--link --type skill` 指向的不是 GitHub | 加 `--skill-download-url <ZIP 直链>` |
| 退出码 2 但你确实只想换文件 | 覆盖升级场景 | 加 `--allow-partial` |
| 输出里 `update.available: true` | 云端 Skill 有新版本 | **先问用户**；同意 → `--self-update` 后重跑原任务，拒绝 → `--dismiss-update` 后继续 |
| `--self-update` 返回 `ok: false` / 退出码 1 | 下载失败、ZIP 损坏或路径校验未过 | 本地 Skill 未改动；稍后重试，或按返回里的 `backup` / 提示手动覆盖 |
| `update.checked: false` | GitHub 暂时访问不了 | 静默忽略即可，发布照常进行，不要当用户可见的报错 |
| `缺少配置：需要 HUB_URL 与 HUB_TOKEN` | 未配置 | 检查 skill 目录下 `.env`，或 `--url / --token` 传入 |
| 401 `缺少令牌` | 请求头没带 Bearer | 用脚本发布即可，脚本会带 |
| 403 `令牌无效或已停用` | **先看返回的 `hint`**：<br>· 显示收到 `x-hub-token` → 头已透传，是**令牌不在目标站数据库里**（常见：拿本地库令牌发线上，或令牌被删/停用）<br>· 只剩 `authorization` → 网关占用/剥离了头 | 头正常时：去**目标站**前台点「安装成果发布 Skill」领新令牌并更新 `.env`；头异常时确认脚本仍带 `x-hub-token`。**不要**因为看到 403 就去怀疑分享码 |
| 返回 403 且是 HTML 页面（不是 JSON） | 线上部署缺分享码，被平台网关挡在应用外 | 在 `.env` 补 `HUB_SHARECODE`，或 `--code XXXXXX` |
| 返回里有 `incomplete: [...]` | 发布了但部分字段仍空 | 补齐后用同一 slug 再推一次（会升版本） |

## 输出

成功后输出 JSON，含 `url`（可直接分享给同事的详情页地址）、`slug`、`version`、`created`、`kind`、`preview`、`update`、`hidden`。

给用户时：
- 把 `url` 给他，并按 `preview` 说明**能不能在浏览器直接打开看**
- `kind` 是 `skill` / `skill-link` 时：**明确说「同事可在详情页下载安装包，或一键复制安装指令发给 Agent 自动安装」**，不要说「可直接查看」
- 如果是覆盖，提一句「已升到 vN，旧版本可在详情页回滚」
- 如果 `incomplete` 非空，说明还有字段没填上，**当场补齐再推一次**，别留着
- 如果 `hidden: true`：**明确告诉用户这条成果目前被管理员隐藏，前台不显示**，新版本已入库但同事看不到，需要管理员在后台取消隐藏
- 如果 `update.available: true`：按第零步先问是否更新，别把这条信息吞掉

发布前想确认判断对不对，用 `--dry-run`：会返回 `kind`、`skillDir`、`skillDownloadUrl`、`packedFrom`、`update`，不真的上传也不产生临时包。
