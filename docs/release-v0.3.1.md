# ASS v0.3.1

本次发布包含 v0.3.0 后两轮 QA 修复。

- DSH 对话按原生 Zstd 分帧格式导出，截断不再静默读为完整记录；配置扫描、启动和历史继续共用 profile，兼容自定义 profile 与独立账户。无法表示的思考档位在写入前拒绝。
- Kimi 支持 provider_id、default_provider 和 flat inline 原生配置；生效的 KIMI_MODEL_NAME 环境覆盖阻止错误的 OAuth 切号。
- OpenCode 同时适配 v1 与 v2：安装入口识别、只读 credential 数据库、多账户 active 状态、公有 CLI 激活，以及新会话格式的继续、删除和恢复。v2 数据库 OAuth 可单向导入新的 pi 账户，不写 SQLite。
- OAuth 导入先准备凭据、最后提交账户与 selected；写入或状态保存失败回滚。进程中断后恢复未完成导入，只清理能确认属于事务的文件，保留原生新增文件或轮换后的凭据。
- Pi legacy 授权必须具备 access JWT 内目标需要的账户 ID；存储账户 ID 不能替代。拒绝显式 client ID 冲突、账号冲突或未知授权约束；Anthropic 兼容记录保留来源元数据。SIWC 与 legacy grant 仍分开。
- Claude 用户级 settings.env 覆盖原生授权时阻止切号，preview 与 apply 重新检查；不修改用户设置，不在提示中输出令牌。
- Codex 历史删除及永久清理明确提示范围：thread_history_*.sqlite 正文与远端数据不在本机 rollout / 索引清理范围。
- 界面明确 Codex / Claude / OpenCode → pi 的单向导入能力；Pi → OpenCode 和 OpenCode OAuthHistory 尚未实现。

## 验证

725 项单测的最新验收结果通过，构建通过。OAuth 专项的 6 项原生检查通过，涵盖官方 Pi 请求与内存刷新 mock、Claude CLI A→B→A 和 settings 覆盖，以及 OpenCode v2 CLI import / switch 和数据库来源。上一轮 DSH、Kimi、OpenCode 等原生验收见 [原生 QA 修复记录](qa-0.3.0-fixes.md)。遵循集中测试、失败项补跑的流程，详细结果见 [OAuth 专项修复](oauth-qa-0.3.0.md)。

原生检查使用隔离 HOME / XDG / APPDATA 和合成账户，模型请求仅发往本机模拟服务。未验证真实登录、服务端 refresh、撤销、订阅权益或计费；不据此宣称 Ubuntu 原生消费者或所有运行模式完成验收。复制的 refresh grant 仍可能因两端轮换或撤销而相互影响。

Windows x64 发布包的 126 个运行时文件与源码及构建产物一致，发布内容审计和隔离 Electron 启动检查通过。账户、凭据、用户对话和验证资料不包含在发布包中。

## 下载

Windows x64：`ASS-v0.3.1-win32-x64.zip`，校验文件：`SHA256SUMS.txt`。完整解压后运行 `ASS.exe`，保留资源与 DLL；更新前退出旧 ASS。此版本使用新的 v0.3.1 标签，不替换 v0.3.0 资产。
