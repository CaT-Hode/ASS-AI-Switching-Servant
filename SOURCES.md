# 来源与实现边界

ASS 是独立实现，不是原产品的官方版本。界面不沿用旧产品品牌；供应商用户名称、导入 ID 和兼容字段保留以避免破坏既有模型引用。

## 兼容性参考

- [AiMaMi 公开仓库](https://github.com/borawong/AiMaMi)：公开树与 Apache-2.0 声明。所检查的公开树并不包含完整路由实现，因此不能声称从此仓库复制了完整代理内核。
- [OpenAiMaMi 证据仓库](https://github.com/MapleEve/OpenAiMaMi)：观察 1.2.6 Windows 前端供应商、协议和上下文默认值，以及已有余额端点行为。ASS 独立编写规范化、余额解析与路由实现；没有将反编译代码或安装版二进制打包发布。
- 用户导出格式中的 `providers / models / wireApi / baseUrl` 等兼容字段。真实导出不在此仓库内。

## 官方文档和原生实现

- [Electron net](https://www.electronjs.org/docs/latest/api/net)、[safeStorage](https://www.electronjs.org/docs/latest/api/safe-storage)：网络与本地 Key 保护。
- [Codex config reference](https://learn.chatgpt.com/docs/config-file/config-reference)、[authentication](https://learn.chatgpt.com/docs/auth)：provider 及账户目录。
- [Codex model protocol](https://github.com/openai/codex/blob/main/codex-rs/protocol/src/openai_models.rs)：catalog enum，含 `tool_mode=direct`、保留 provider 与工具能力声明。
- [Claude Code authentication](https://code.claude.com/docs/en/authentication)、[settings](https://code.claude.com/docs/en/settings)：原生登录、`CLAUDE_CONFIG_DIR`、API 环境变量。
- [OpenCode providers](https://opencode.ai/docs/providers/)、[config](https://opencode.ai/docs/config/)、[CLI](https://opencode.ai/docs/cli/)：Go / 通用 API、inline config、原生账户命令。
- [pi provider docs](https://github.com/badlogic/pi-mono/blob/main/packages/coding-agent/docs/providers.md)、[model docs](https://github.com/badlogic/pi-mono/blob/main/packages/coding-agent/docs/models.md)：API 与 OAuth。
- 本机测试用 pi 0.73.1 的 OAuth 注册表与凭据字段：`@mariozechner/pi-ai` 的 `dist/oauth.js`、`dist/utils/oauth/openai-codex.js`、`anthropic.js`。新 namespace `@earendil-works/pi-ai` 也可探测。运行时优先实际安装版本，不把旧网页名单写成能力承诺。
- [DeepSeek Harness llm-pi-ai](https://github.com/deepseek-ai/deepseek-harness/tree/master/packages/llm/llm-pi-ai)、[default model](https://github.com/deepseek-ai/deepseek-harness/tree/master/packages/core/agent-default-model)：隔离配置与模型接入。测试用 0.1.5-rc.2 实际 schema。

这些链接用于说明兼容性依据，不代表原作者对 ASS 的认可。第三方订阅使用范围和计费遵循相应供应商条款。

## v0.1.1 官方账户与 API 入口

- [OpenRouter PKCE](https://openrouter.ai/docs/guides/overview/auth/oauth)：S256、localhost 回调、`/api/v1/auth/keys` 换取 API Key。实现不是订阅 OAuth 通用移植器。
- [Cursor CLI authentication](https://cursor.com/docs/cli/reference/authentication)：原生浏览器登录与 API Key；本版只做原生 Key 保管，不推断 OAuth 文件格式或多账户隔离。
- [Kimi Code](https://www.kimi.com/code/docs/en/)：Kimi 原生登录、Code API / Moonshot 区域入口；本版保留 OAuth 外部管理边界。
- [Z.ai API](https://docs.z.ai/api-reference/introduction)、[OpenCode Go](https://opencode.ai/docs/go/)：套餐与一般 API 入口区分。
- [Anthropic API](https://platform.claude.com/docs/en/api/overview)：API Key 与原生订阅授权分开。
- [Gemini OpenAI compatibility](https://ai.google.dev/gemini-api/docs/openai)、[Groq](https://console.groq.com/docs/openai)、[Mistral](https://docs.mistral.ai/api)、[xAI](https://docs.x.ai/developers/rest-api-reference/inference/chat)、[SiliconFlow](https://docs.siliconflow.cn/docs/api/chat-completions-post)、[Qwen / DashScope](https://www.alibabacloud.com/help/en/model-studio/compatibility-of-openai-with-dashscope)：兼容 API 基址与协议。

模型目录字段与小请求结果分别展示为“声明”和“实测”；上游参数接受不等于不同档位的推理质量验证。未公开能力保持未知，不根据模型名称冒充实测结果。

## v0.1.2 更新检查

- [GitHub Releases API](https://docs.github.com/en/rest/releases/releases#list-releases)：公开版本、预览标记、发布资源名称与上传状态。
- [GitHub REST 最佳实践](https://docs.github.com/en/rest/using-the-rest-api/best-practices-for-using-the-rest-api)：ETag 条件请求、串行合并及限流退避。
- [Electron autoUpdater](https://www.electronjs.org/docs/latest/api/auto-updater)：Windows 原生自动安装方案涉及对应打包机制；当前 ASS 是便携 ZIP，只实现自动检查和浏览器下载，不声称已经支持后台自动安装。

## v0.1.5 本机授权检测

- [Codex authentication](https://learn.chatgpt.com/docs/auth)：`CODEX_HOME/auth.json` 与 file / keyring / ephemeral 存储边界。
- [Claude Code authentication](https://code.claude.com/docs/en/authentication)：Windows `.claude/.credentials.json` 与 `CLAUDE_CONFIG_DIR`。
- [OpenCode providers](https://opencode.ai/docs/providers/)：原生 `auth.json`，供应商分别保存凭据。
- [Pi AuthStorage 源码](https://github.com/badlogic/pi-mono/blob/main/packages/coding-agent/src/core/auth-storage.ts)：`oauth` 与 `api_key` 记录，读取时不执行动态密钥命令。
- 本机 `D:\deepseek-harness\packages\credentials\credentials-local\README.md` 与 `packages\llm\llm-pi-ai\src\auth.ts`：版本化 `.credentials.yaml`、`refs`、`records` 和 `llm-pi-ai/<provider>` grant 结构。只实现已确认格式，不把任意插件 grant 误判为 OAuth。

## 视觉

ASS 蓝色花瓣、红色空心圆环 logo 为本项目通过内置图像编辑生成的原创位图。Windows 图标从透明底图中居中裁去多余留白，主体约占 94%，再导出多尺寸 ICO；不改变花瓣比例。窗口和托盘使用同一裁切版本。其他图标使用 Lucide。系统字体、原生 dialog 和克制的交互反馈，针对横向桌面窗口设计。

图像编辑提示词保留于 [logo 编辑记录](docs/LOGO.md)。
