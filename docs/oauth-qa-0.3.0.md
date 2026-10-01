# OAuth 专项修复

本轮基于本地 `ee63964`，使用补充包的证据继续修复。报告的旧基线为 `b998e09`；OpenCode v2 已有的只读数据库和公有 CLI 适配不重复算成新回归。

| 问题 | 处理 |
| --- | --- |
| 导入失败留下空的 selected profile | 先写凭据，最后一次提交 profile、来源元数据与 selected。写入、rename 或状态提交失败回滚内存和未提交文件；重启按无秘密的事务标记恢复。只删除内容摘要匹配的自有文件，不递归清理目录；原生新增文件或轮换后的 auth 保留。 |
| Pi legacy 授权缺少 access JWT 内账户 ID | 使用 Pi 原生请求消费者要求的嵌套 `https://api.openai.com/auth.chatgpt_account_id`。存储层或 ID token 的账户 ID 不能代替；缺失、opaque 和账户冲突拒绝。SIWC 与 legacy 仍分开，不改写 provider 或 JWT。 |
| Claude 用户级设置覆盖切号 | 在解析后的 CLAUDE_CONFIG_DIR 检查 settings.json.env，至少覆盖已复现的 CLAUDE_CODE_OAUTH_TOKEN 与 ANTHROPIC_AUTH_TOKEN；保留六项进程环境保护。preview 与 apply 都重查；格式不明时阻止切号，提示不含值，不修改用户设置。项目/本地设置的 print 模式负对照不推导成其他运行模式的保证。 |
| Claude → Pi client ID 冲突 | Anthropic 显式 client ID 必须匹配已核对的 Pi 刷新客户端。明确 scopes 必须包含 user:inference 且属于核对范围；未知 issuer/resource/授权扩展约束拒绝。兼容记录保留来源 token 元数据；没有元数据的旧记录只标为格式兼容。OpenCode Anthropic 来源适用同一检查。 |
| OpenCode v2 DB-only 来源缺失 | 复用现有只读 credential 适配列出各 OAuth 记录，按稳定 selector 在导入时重新读取。数据库错误不回退陈旧 auth.json；不写 SQLite，也不更改原生 active 账户。 |
| 导入方向被误解 | 界面明确 Codex / Claude / OpenCode → pi 单向导入。Pi → OpenCode 与 OpenCode OAuthHistory 尚未实现。原生 OpenCode auth switch 验收不代表 ASS OAuthHistory 支持该功能。 |

所有兼容性判断都是本地格式检查，JWT 解码不验证签名。过期记录提示由原生 pi 刷新或重新登录；ASS 不探测真实 refresh。复制会共享 refresh grant，两端轮换或撤销可能互相影响；独立账户目录不等于独立授权。未验证真实登录、服务端刷新、撤销、权益或计费。

集中验收使用普通 `npm test`、`npm run build`，以及可选的固定消费者专项入口：

```powershell
node scripts/native-contract/oauth.cjs --enable --prefix C:\absolute\installed-harnesses
```

所需目录与已有原生检查相同：`pi/node_modules/@earendil-works/pi-coding-agent@0.99.1`、`claude/node_modules/@anthropic-ai/claude-code@2.1.285`、`opencode-v2/node_modules/@opencode/cli@2.0.20`。入口不下载安装，使用合成账户和隔离 HOME/XDG/APPDATA，Claude CLI 请求本机 mock，Pi 官方模块的刷新完全在内存 mock 中验证。结果和请求证据保存在输出的临时目录。

支持 `--only pi,claude,settings,opencode` 按组补跑。Windows 本轮集中单测首轮为 **724/725**；修正新增验收断言后，涉及的 **31/31** 项补跑通过。最后的异常读盘恢复补充验收也通过。合并每项最新结果为 **725 项单测通过**，构建通过；原生专项 **6 项通过**（首次通过的 3 项不重复运行，失败验收夹具修正后另外 3 项补跑通过）。未做真实服务端 OAuth 检查、Ubuntu 原生检查或 GUI 截图验收。

本轮未更新已发布 v0.3.0 标签、release 资产或本机开始菜单安装。
