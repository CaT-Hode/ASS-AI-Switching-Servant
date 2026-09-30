# 原生客户端兼容性检查

普通 `npm test` 保持离线、快速，不下载或启动原生客户端。`npm run test:native` 默认返回 skipped；明确启用：

```powershell
npm run test:native -- --enable --prefix "C:\isolated-consumers"
```

先自行安装官方固定版本到 `<prefix>/<名称>/node_modules/<包名>`；运行器验证包名及版本，不自动下载未知二进制。版本固定在 `scripts/native-contract/run.cjs`：Codex 0.159.2、CC 2.1.285、OpenCode v1 1.18.33 / v2 2.0.20、pi 0.99.1、DSH 0.2.0-rc.2、Kimi 2.1.1、ZCode Desktop 3.14.4。OpenCode v2 官方包需完成其安装步骤以准备平台二进制。

运行器为每个客户端创建独立 HOME、USERPROFILE、APPDATA、XDG 目录，使用合成凭据和回环 mock。Node 网络保护仅允许回环；原生二进制设置禁用遥测、模型下载与不可用的外连代理，不宣称是操作系统防火墙。结果区分 pass、fail、skipped、blocked，原始请求和错误保存在输出的临时证据目录。缺少客户端不会伪装成通过；ZCode 使用 `<prefix>/zcode/resources/app.asar` 的官方桌面元数据、`resources/glm/zcode.cjs` 和 `resources/config/provider/zcode-builtin.json`，不能以无关 npm 包替代。失败修复后可用 `--only codex,opencode-v2` 仅重跑涉及的客户端。

DSH / pi / OpenCode 历史检查由真实原生客户端恢复 ASS 输出，对 mock 请求中的历史上下文断言，并读取原生追加结果。Windows 与 Ubuntu 单测在 CI 中分别运行；本机未运行的平台应标为未验证。Windows 可见终端启动属于额外的平台集成检查，不能由配置导出或 `--help` 代替。

## 配置与删除边界

- DSH 0.2 使用单独首帧头；实际 profile 一致用于配置、账户、模型启动和对话继续。ultra 不是 DSH 原生档位；ultra-only 或默认 ultra 会在写入前拒绝，混合模型保留受支持的显式档位。
- Kimi 模型支持 provider_id/name、default_provider 和内联 base_url/api_key/protocol/name；冲突别名不推断。非空 KIMI_MODEL_NAME 启用环境模型，完整或缺 key 的覆盖均阻止 OAuth 切换；只有其他 KIMI_MODEL_* 变量时按官方客户端语义不视为已生效。
- OpenCode v2 从 credential service 数据库读取多账户和 active 状态，切换调用官方 CLI；ASS 供应商密钥使用原生配置 apiKey，不修改 SQLite。若同一受管供应商已有不同密钥、OAuth 或携带额外配置的 credential 会拒绝写入，防止原生 credential 优先级覆盖配置；旧版迁移且密钥一致的简单 credential 可继续使用。会话按 session_v2 / session_message 和新版 transfer/CLI 分派，v1 保持旧适配。独立启动使用 --standalone，避免复用其他 profile 的后台服务器。
- DSH 路径遵循运行平台文件系统：Windows 的反斜杠是分隔符，POSIX 的反斜杠是合法文件名字符。静态解析 CMD 声明不意味着在 POSIX 上模拟 Windows 文件系统。
- **Codex 删除采用明确边界方案**：移除 rollout 与可恢复的 state_N.threads 索引，ASS 永久清理仅移除 ASS 副本和恢复备份。Codex 0.159.2 migrate-rollouts 生成的 thread_history_1.sqlite.thread_items 正文可能仍存在；界面在删除前和永久清理前明确说明。没有承诺正文数据库、WAL、远端或物理安全擦除。共享数据库不能为一个会话整体删除。
