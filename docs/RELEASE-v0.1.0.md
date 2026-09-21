# AI Switch Servant v0.1.0 · Preview

首个 Windows x64 便携预览版。下载 ZIP 后完整解压，运行 `ASS.exe`；同时提供 SHA-256。未签名，不需要关闭系统防护。

## 本版功能

- 独立 Electron 窗口、托盘与蓝色花瓣图标。
- 兼容旧版供应商 JSON 导入；官方 Codex / 第三方 API 明确分流，使用 Windows 信任证书与系统代理，不静默 fallback。
- 模型协议和上下文默认值，思维范围双滑块与可选档位；非 GPT 默认关闭 ultra。
- 10 类余额 / 套餐端点，自动识别和自定义同源 GET。
- Codex / Claude Code / OpenCode / pi / DeepSeek Harness 的 API 注入、独立账户目录与启动切换。
- DeepSeek、OpenCode Go API 配置自动成为相应账户；Codex / Claude 可管理多套原生授权。
- 读取本机 pi OAuth 注册表，将兼容的 Codex / Claude / OpenCode 授权导入新的 pi 账户；来源文件不修改。

## 使用前请注意

1. 本包不含个人 API 配置、OAuth、原生 harness 或聊天记录。首次打开请自行导入配置，安装 / 选择原生客户端。
2. 接入 Codex 前关闭其他工具的路由接管。ASS 会备份配置；接入后重启 Codex 并新建任务。旧任务不自动迁移。
3. OAuth 导入是授权快照，不是双向同步；两端刷新或撤销可能互相影响。供应商权益与计费仍由其决定。
4. 账户选择只影响 ASS 新启动的客户端，不替换已运行的 Codex App 登录。重启 ASS 后需重新启动经路由的其他客户端。
5. **Codex 到 Anthropic / Chat 的跨协议工具兼容仍为实验性**。当前 Codex 某些模式不传标准工具定义，此时只验证文本；建议原生 Responses，或用 Claude Code / pi 原生 Anthropic 接入。
6. 上游不支持的模型、思维档位、余额端点或异常流不会被标为成功，也不会通过官方账户兜底。

## 验证

27 项核心测试、Electron 交互检查、Windows 打包窗口检查通过，npm audit 0 项已知漏洞。本机 pi 原生凭据读取器确认能读取合成 Codex OAuth；未刷新用户真实授权。官方 HTTP/SSE 在当前 Windows CA 环境返回完整响应。

完整边界和原生客户端版本见 [验证记录](https://github.com/CaT-Hode/ASS-AI-Switching-Servant/blob/main/docs/VALIDATION.md)。
