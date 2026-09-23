# ASS v0.1.21 · 原生客户端识别

- 新增 Kimi Code 新 / 旧版、ZCode、Antigravity CLI 的本机识别。
- Kimi / ZCode 可查看原生账户与配置中声明的模型；第三方模型不混入官方账户，不虚构上下文或订阅余额。
- Kimi 新旧目录分离；ZCode 原生加密凭据只在主进程解密。令牌与 API Key 不进入界面快照。
- Antigravity 识别明确启用的 Gemini API；系统密钥库 OAuth 尚未读取，不借用 Gemini CLI 凭据。

这是分阶段适配版本：新增三类客户端的账户切换、配置注入与用量采集尚未完成；原有 Codex / Claude Code / OpenCode / pi / DSH 接入不变。完整范围见 [新增客户端支持边界](https://github.com/CaT-Hode/ASS-AI-Switching-Servant/blob/main/docs/ADDITIONAL-HARNESSES.md)。

未重启生产客户端，未修改真实凭据，未发送付费模型请求。等待当前任务结束后从托盘退出旧 ASS，完整解压 ZIP 并启动新版。
