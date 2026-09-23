# 新增客户端适配

本页记录实际实现的能力，不把发现配置文件视为在线授权或模型调用成功。完整接入目标尚未完成。

| 客户端 | 当前读取范围 | 尚未完成 |
| --- | --- | --- |
| Kimi Code | 新版 `.kimi-code` / `KIMI_CODE_HOME`、旧版 `.kimi` / `KIMI_SHARE_DIR`；官方 API 与文件 OAuth；TOML 中显式模型及上下文、思维档位 | 原生 TOML 字段注入 / 撤回、登录操作、OAuth 历史与切换、原生请求测试、用量与额度 |
| ZCode | `.zcode/v2`、`ZCODE_DATA_BASE_DIR`；原生 AES-256-GCM 凭据及旧明文记录；Z.ai / BigModel 账户；个人配置显式模型 | 桌面安装发现、供应商规则注入 / 撤回、OAuth 切换、完整内置目录合并、原生请求测试、用量与额度 |
| Antigravity | `agy` 命令、Windows LocalAppData 下的 CLI；`.gemini/antigravity-cli/settings.json`；Gemini API 模式 | IDE 适配、系统密钥库 OAuth 读取 / 切换、模型配置写入、请求测试、用量与额度 |

未检测到安装入口或配置来源的客户端不进入首页汇总；仍可在“更多客户端”选择路径。有效配置也是识别证据，但不证明该客户端已安装或在线。

## 读取约束

- 检测不启动客户端，不执行密钥辅助程序、不刷新授权、不发送模型请求。单文件最多读取 2 MiB，拒绝链接路径；解析失败保留原文件。没有写入这些客户端的配置或凭据。
- Kimi 新旧数据目录分开识别，不互相借用 token；自定义目录不猜测版本。只读取配置引用的同目录 OAuth 文件；拒绝路径穿越、非文件存储、冲突凭据配置。撤销 tombstone 不产生账户，过期 / 待刷新明确保留状态。
- ZCode 解密遵循原生实现：自定义 `ZCODE_CREDENTIAL_SECRET` 或 OS 平台 / 真实 home / 用户名派生密钥，覆写数据根目录不改变密钥身份。只读取官方命名空间，忽略 MCP 授权及无关凭据；解密失败不伪造账户。用户资料仅展示同一命名空间缓存中的白名单字段，不推断套餐。
- 只有精确官方 HTTPS 端点的 API 才成为客户端账户。第三方配置模型单独聚合；模型声明不增加账户计数。未声明的上下文、协议、思维能力保持未知，不套用猜测值。
- Antigravity 的 `GEMINI_API_KEY` 只有在 `modelProvider = "gemini"` 时生效；`GOOGLE_API_KEY` 不算登录。官方 OAuth 使用系统密钥库，不读取 Gemini CLI 的 `oauth_creds.json` 代替。
- 前端及后端共同限制尚未实现的账户选择 / 启动 / 供应商注入操作。原有五种客户端接入状态格式、OAuth 历史及恢复日志未扩展或重写。

## 官方依据

2026-09-23 核对：

- [Kimi Code 数据位置](https://moonshotai.github.io/kimi-code/en/configuration/data-locations.html)、[配置文件](https://moonshotai.github.io/kimi-code/en/configuration/config-files.html)。源码 `MoonshotAI/kimi-code` 提交 `6451f1e056e90037bbf832f3578955cf8e55db64`：`packages/oauth/src/storage.ts`、`toolkit.ts`（逻辑 key 到存储 slot 的映射）、`types.ts`、`token-state.ts`、`packages/agent-core-v2/src/app/kosongConfig/configSection.ts`。旧 CLI 提交 `9ab1286b8fe4e6bcd116949a27ce5e0ac3389c82`，`src/kimi_cli/config.py`、`auth/oauth.py`。
- [ZCode 原生凭据](https://github.com/zai-org/ZCode/blob/872ad960de7ec172591f7e1952f7849229f94521/apps/zcode-cli/packages/adapters/src/auth/shared-credentials.ts)、同目录 `credential-cipher.ts`；配置结构参照同提交 `packages/provider-node/src/provider-config-file-codec.ts` 与 `packages/provider/src/config/rule-data-schema.ts`。
- [Antigravity CLI 安装与授权](https://antigravity.google/docs/cli/install)。文档中的 Gemini API 模式不是通用 OpenAI / Anthropic 协议接入。

当前验证使用合成凭据及隔离 Electron 窗口。本机默认位置未发现三者的实际账户，不宣称真实用户登录、订阅额度或完整 Agent 任务已验证。
