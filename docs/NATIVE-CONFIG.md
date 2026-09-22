# 原生 API 接入

DSH、OpenCode、pi 的第三方 API 直接连接供应商。ASS 管理下面的配置字段，不转发它们的模型请求。Codex / Claude Code 保持原有接入方式；本次不会切换 Codex App 的 OAuth 账户或默认入口。

| 客户端 | 模型与默认项 | API 凭据 |
| --- | --- | --- |
| OpenCode | 全局 `opencode.jsonc` / `opencode.json` 的 `provider.<ASS ID>` 与已选 `model` | `XDG_DATA_HOME/opencode/auth.json` 的独立 API 项 |
| pi | `PI_CODING_AGENT_DIR/models.json` 的 `providers.<ASS ID>`；`settings.json` 的默认模型与强度 | 同目录 `auth.json` 的独立 `api_key` 项 |
| DSH | `DSH_HOME/settings.yaml` 的 `llm-pi-ai.providers.<ASS ID>` 与 `agent-default-model` 对应字段 | `.credentials.yaml` 的 `records.llm-pi-ai/<ASS ID>` |

未设置环境目录时采用客户端默认位置；凭据目录覆盖使用客户端页所选路径。OpenCode 尊重 `OPENCODE_CONFIG` 与 `XDG_CONFIG_HOME`，默认文件优先级为 jsonc、json、旧 config.json；项目配置等更高优先级来源仍可能覆盖全局默认项，ASS 不修改项目文件。

## 使用与撤回

- 接入开关先预览警告，确认后写入已绑定、已启用且有 Key 的供应商。每个供应商按协议生成稳定的 `ass-<hash>-<protocol>` 标识，不覆盖 `openai`、`anthropic`、`deepseek` 等内置账户。
- 只有明确选择 API 账户时才接管原生默认模型；未选择时保留默认项。切回原生 OAuth 卡片会撤回 ASS 的默认项覆盖；OAuth 本身仍由客户端管理，不复制或刷新令牌。独立授权账户继续使用其独立目录。
- 启用原生接入后，保存供应商 / 模型、绑定账户、选择 API 模型会同步管理字段。冲突时 ASS 内部编辑仍保存，客户端页显示“未同步”，修复冲突后用同步图标重试。首次从旧版代理迁移需主动确认同步，启动和只读状态检查不自动改文件。
- 退出 ASS 保留原生直连配置及窗口。主动关闭对应接入开关、或“停止全部接入”，才撤回字段。旧代理窗口仍按原保护流程退出；未由 ASS 启动的任务无法判断是否空闲，请先结束任务。
- 断开只还原 ASS 字段：原生 OAuth 刷新记录、其他供应商、MCP / 插件等无关数据保留。自己改过 ASS 字段时拒绝覆盖。新增文件可留下空对象，DSH `version: 1` 保留，避免破坏后来加入的原生凭据。

## 安全与限制

- **原生客户端需要真实 Key**：ASS 自身凭据及恢复记录仍由 Windows DPAPI 加密；写入原生 `auth.json` / `.credentials.yaml` 的 Key 则采用客户端原生格式，不是 DPAPI 密文。不要分享这些文件。额外请求头写入原生配置，若包含秘密也须同样保护。
- 配置按字段合并，JSONC / YAML 注释保留。写入前核对文件与管理字段，跨文件失败用加密事务记录恢复；恢复遇到外部改动会停止。不要让两个程序同时改同一受管字段。
- 代理与 TLS 由原生运行时负责。ASS 启动时保留代理及 `NODE_EXTRA_CA_CERTS` 环境，启用 `NODE_USE_SYSTEM_CA=1`，不禁用 TLS 验证。ASS 的“系统 / 直连”选项仍用于自身诊断与查询，不等于原生客户端的逐供应商网络设置；普通启动需自行确保客户端的代理 / CA 环境正确。
- pi / DSH 当前原生思维档位最高为 `max`：模型目录不写 `ultra`，若所选默认档位为 `ultra` 则明确拒绝同步，不静默降级。OpenCode 的 Anthropic 思维预算交由原生 SDK 处理，不把 OpenAI 的 `reasoningEffort` 强塞给它。
- 直连请求不出现在 ASS 路由日志 / 活跃计数中；客户端卡片标记“原生直连”。ASS 模型闪电测试验证供应商协议和流，不等于验证每种客户端完整任务。

## 依据与验证边界

配置格式以 [OpenCode Config](https://opencode.ai/docs/config/)、[OpenCode Providers](https://opencode.ai/docs/providers/)、[pi 自定义模型](https://github.com/earendil-works/pi/blob/main/packages/coding-agent/docs/models.md)、[pi Settings](https://github.com/earendil-works/pi/blob/main/packages/coding-agent/docs/settings.md)、[DSH llm-pi-ai](https://github.com/deepseek-ai/deepseek-harness/tree/main/packages/llm/llm-pi-ai) 和 [DSH credentials-local](https://github.com/deepseek-ai/deepseek-harness/tree/main/packages/credentials/credentials-local) 为依据。

2026-09-22：本机 DSH 源码的实际配置解析器接受生成结果；其原生凭据适配器和 pi-ai 0.85.1 对本机合成服务完成 Chat Completions / Responses / Anthropic 三种流式请求，未启动 ASS 路由、未产生付费用量。OpenCode / pi 的完整独立应用任务未在本次实测；格式与文件维护另有单元测试及隔离 Electron UI 验证。详见 [验证记录](VALIDATION.md)。
