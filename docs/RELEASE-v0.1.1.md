# AI Switch Servant v0.1.1 · 官方账户与模型检测

Windows x64 早期预览版；完整解压 ZIP 后运行 ASS.exe，应用数据继续使用 `%APPDATA%\AI Switch Servant`。

## 新增

- 独立官方账户中心，覆盖 19 组服务，包含 OpenAI、Anthropic、DeepSeek、Cursor、Kimi、Z.ai、OpenCode Go / Zen、OpenRouter 等。
- 多套 API 凭据与独立原生授权账户，连接已有模型与客户端选择；官方产品、地区、计费方式分开展示。
- OpenRouter PKCE 浏览器授权、随机单次本机回调、5 分钟超时与取消，换取 Key 后由 Windows 加密。
- Cursor 原生 API Key 加密保管、编辑、移除与主动复制；Cursor / Kimi 原生 OAuth 明确由原生客户端管理，未实现其多账户令牌切换。
- 每个模型右侧闪电检测连接；目录发现、逐模型协议 / 工具 / 思维档位能力实测，包含非法参数对照。
- 自动识别客户端与目录；支持 DSH 源码根目录，优先选择构建后的 CLI，工作目录保持独立。

## 验证与边界

44 项核心测试与真实 Electron 交互检查通过。单个 MiMo 模型 4 条实网小请求验证了 Responses、工具结构和 low 参数校验；不代表所有平台、思维档位或目录模型均已验证。OpenRouter 授权使用合成交换测试，官网权限和额度仍需用户确认。

不关闭 TLS、不将第三方失败 fallback 到官方、不修改正在运行的客户端账户。API 目录和名称默认值不等同于实测上下文或能力。Codex 跨协议工具兼容性仍属实验性，限制见 README 与 docs/VALIDATION.md。

更新前请等待经 ASS 路由的请求结束，再退出旧版。数据目录不删除；重启 ASS 后，经本地令牌接入的客户端需要重新启动。此版本未签名，请核对仓库和 SHA256SUMS.txt。
