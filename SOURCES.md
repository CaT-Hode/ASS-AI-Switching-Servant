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

## 视觉

ASS 蓝色花瓣 logo 为本项目生成的原创位图；ICO 只是该图的尺寸和容器转换。其他图标使用 Lucide。系统字体、原生 dialog 和克制的交互反馈，针对横向桌面窗口设计。
