# ASS v0.1.22 · Kimi / ZCode 原生接入

- Kimi Code 新版、旧版与 ZCode CLI / Desktop 进入正式客户端列表；未识别到安装或有效配置时不显示。
- 支持从 ASS 发起 Kimi / ZCode 原生登录，自动加密记录 OAuth 变化，并在对应客户端内切换已保存账户。
- Kimi / ZCode 的第三方供应商按供应商整组直写原生配置，可同步、撤回并逐模型直连检测，不经过 ASS 代理。
- Kimi 账户资料、编程额度与加量包，ZCode Start / Coding Plan / Team / MCP 额度进入账户卡片；ZCode Start Plan 使用当前账户返回的运行时模型范围。
- 首页读取 Kimi Wire 与 ZCode SQLite 的本地 Token 记录；模型页聚合 ZCode 本机目录，连接结果继续加密持久化。
- DSH 同步后明确提示刷新已打开的 Web 页面，使新供应商模型目录可见。
- Antigravity 已退出产品支持面；界面、自动发现、账户扫描、接入和旧 IPC 均不会再启用它。仅保留旧事务恢复所需的兼容读取。

升级不会自动改写原生客户端配置或切换账户。退出旧版 ASS，完整解压 Windows x64 ZIP 后运行 `ASS.exe`；已有供应商、账户历史和接入状态继续使用原数据目录。正在运行的客户端需按界面提示刷新或重开，ASS 不会替你中断任务。
