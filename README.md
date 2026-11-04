# publish-html-hub

将 HTML 文件或已有在线链接发布到市场部 AI 工作成果共享台。支持完整成果信息、检索词、默认作者署名，以及使用相同 slug 升级版本。

## 安装到 Codex

需要 Node.js 18 或更高版本。在仓库页面点击 **Code → Download ZIP**，解压后将目录重命名为 `publish-html-hub`，复制到 `~/.codex/skills/publish-html-hub`。然后在技能目录运行：

```bash
cp .env.example .env
```

在本机 `.env` 中填写成果台地址、发布令牌、分享码和当前使用者的真实署名。配置由成果台管理员提供，仓库不包含实际凭据。下一轮对话即可使用该 Skill。

## 安装到 WorkBuddy

将同一个 `publish-html-hub` 目录复制到 `~/.workbuddy/skills/`，按上面的方式创建并填写本机 `.env`，然后重新打开 WorkBuddy 对话。脚本的工作方式相同；如手动执行，将示例路径中的 `~/.codex/skills/` 换为 `~/.workbuddy/skills/`。

## 使用

在 Codex 中说：

> 把这份 HTML 发布到成果台

也可以复制 `example-meta.json` 为自己的元数据文件，补齐内容后执行：

```bash
node ~/.codex/skills/publish-html-hub/scripts/publish.mjs 成果.html --meta meta.json
```

发布前本地预览：

```bash
node ~/.codex/skills/publish-html-hub/scripts/publish.mjs 成果.html --meta meta.json --dry-run
```

默认署名来自本机 `HUB_AUTHOR`。同一份成果升级时沿用相同 slug。完整字段与发布规则见 [SKILL.md](SKILL.md)。
