# 原生 API 接入

DSH、OpenCode、pi 的第三方 API 直接连接供应商。ASS 管理下面的配置字段，不转发它们的模型请求。官方账户卡片与模型接入独立；账户切换不改变默认模型，接入不替换官方登录。

| 客户端 | 模型与默认项 | API 凭据 |
| --- | --- | --- |
| OpenCode | 全局 `opencode.jsonc` / `opencode.json` 的 `provider.<ASS ID>` | `XDG_DATA_HOME/opencode/auth.json` 的独立 API 项 |
| pi | `PI_CODING_AGENT_DIR/models.json` 的 `providers.<ASS ID>` | 同目录 `auth.json` 的独立 `api_key` 项 |
| DSH | `DSH_HOME/settings.yaml` 的 `llm-pi-ai.providers.<ASS ID>` | `.credentials.yaml` 的 `records.llm-pi-ai/<ASS ID>` |

未设置环境目录时采用客户端默认位置；凭据目录覆盖使用客户端页所选路径。OpenCode 尊重 `OPENCODE_CONFIG` 与 `XDG_CONFIG_HOME`，默认文件优先级为 jsonc、json、旧 config.json；项目配置等更高优先级来源仍可能覆盖全局默认项，ASS 不修改项目文件。

## 使用与撤回

- 接入开关先预览警告，确认后写入全局已启用、有 Key 且兼容的模型，扣除本客户端排除项；无需绑定 API 账户。每个供应商按协议生成稳定的 `ass-<hash>-<protocol>` 标识，不覆盖 `openai`、`anthropic`、`deepseek` 等内置账户。
- 接入范围按供应商整组开关；不再选择或接管默认模型。旧版曾接管的默认项在下一次确认同步时恢复，外部冲突仍拒绝覆盖。选择 / 移除账户卡片不改变接入范围。
- 保存供应商 / 模型 / 接入范围只保存草稿；已有接入显示“待同步”，经同步按钮确认才写入。新开的独立账户目录继承上次已应用的字段，已有目录不改写；不会以启动账户为由应用草稿。首次从旧版代理迁移同样需主动确认。
- 客户端页移除“启动模型”，在原生客户端选择模型；官方账户仍可独立启动。DSH 使用当前源码实际支持的 `web` profile。
- 退出 ASS 保留原生直连配置及窗口。主动关闭对应接入开关、或“停止全部接入”，才撤回字段。旧代理窗口仍按原保护流程退出；未由 ASS 启动的任务无法判断是否空闲，请先结束任务。
- 断开只还原 ASS 字段：原生 OAuth 刷新记录、其他供应商、MCP / 插件等无关数据保留。自己改过 ASS 字段时拒绝覆盖。新增文件可留下空对象，DSH `version: 1` 保留，避免破坏后来加入的原生凭据。

## 安全与限制

- **原生客户端需要真实 Key**：ASS 自身凭据及恢复记录仍由 Windows DPAPI 加密；写入原生 `auth.json` / `.credentials.yaml` 的 Key 则采用客户端原生格式，不是 DPAPI 密文。不要分享这些文件。额外请求头写入原生配置，若包含秘密也须同样保护。
- pi 自定义供应商必须声明 `apiKey` 字段才能通过原生目录校验；ASS 写入未设置的 `$ASS_PI_AUTH_REQUIRED` 引用作为声明，实际请求优先读取 `auth.json` 的 Key。不会复制一份明文 Key 到模型目录；删除原生凭据后不会回退到伪造密钥。
- 配置按字段合并，JSONC / YAML 注释保留。写入前核对文件与管理字段，跨文件失败用加密事务记录恢复；恢复遇到外部改动会停止。不要让两个程序同时改同一受管字段。
- 代理与 TLS 由原生运行时负责。ASS 启动时保留代理及 `NODE_EXTRA_CA_CERTS` 环境，启用 `NODE_USE_SYSTEM_CA=1`，不禁用 TLS 验证。ASS 的“系统 / 直连”选项仍用于自身诊断与查询，不等于原生客户端的逐供应商网络设置；普通启动需自行确保客户端的代理 / CA 环境正确。
- pi / DSH 当前原生思维档位最高为 `max`：模型目录不写 `ultra`，不替客户端设置默认档位。OpenCode 的 Anthropic 思维预算交由原生 SDK 处理，不把 OpenAI 的 `reasoningEffort` 强塞给它。
- 直连请求不出现在 ASS 路由日志 / 活跃计数中；客户端卡片标记“原生直连”。ASS 模型闪电测试验证供应商协议和流，不等于验证每种客户端完整任务。

## 依据与验证边界

配置格式以 [OpenCode Config](https://opencode.ai/docs/config/)、[OpenCode Providers](https://opencode.ai/docs/providers/)、[pi 自定义模型](https://github.com/earendil-works/pi/blob/main/packages/coding-agent/docs/models.md)、[pi Settings](https://github.com/earendil-works/pi/blob/main/packages/coding-agent/docs/settings.md)、[DSH llm-pi-ai](https://github.com/deepseek-ai/deepseek-harness/tree/main/packages/llm/llm-pi-ai) 和 [DSH credentials-local](https://github.com/deepseek-ai/deepseek-harness/tree/main/packages/credentials/credentials-local) 为依据。

2026-09-22，v0.1.17：pi 0.73.1 的实际 ModelRegistry、AuthStorage 与 CLI 模型列表，OpenCode 1.18.31 的 `debug config/paths`，本机 DSH 0.1.5-rc.1 的 Settings / Credentials 服务与 `--dump-config` 均接受生成结果。没有发送模型请求；这些结果证明配置可读及凭据归属，不代表完整客户端任务或所有上游权限已实测。历史三协议合成流验证及本版隔离 Electron 回归见 [验证记录](VALIDATION.md)。
