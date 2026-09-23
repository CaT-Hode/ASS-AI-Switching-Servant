# 新增客户端适配

本页记录实际实现的能力，不把发现配置文件视为在线授权或模型调用成功。完整接入目标尚未完成。

| 客户端 | 当前能力 | 尚未完成 |
| --- | --- | --- |
| Kimi Code | 新旧版目录与原生账户识别；原生登录发起；文件型 OAuth 自动加密记录与确认切换；官方资料、编程额度、加量包余额查询；按供应商直写 TOML，支持 Chat / Responses / Anthropic；同步及撤回 | 原生请求测试、本地 Token 账本 |
| ZCode | CLI / Windows 桌面安装识别；原生登录发起；默认、环境变量和桌面自定义数据目录；完整 OAuth 会话自动保存与切换；可识别 Desktop 版本时查询 Start Plan 额度；按供应商直写规则、同步及撤回 | CLI 额度版本适配、Coding Plan / Team / MCP 额度、完整内置目录合并、原生请求测试、本地 Token 账本 |
| Antigravity | `agy` 命令、Windows LocalAppData 下的 CLI；`.gemini/antigravity-cli/settings.json`；Gemini API 模式 | IDE 适配、系统密钥库 OAuth 读取 / 切换、模型配置写入、请求测试、用量与额度 |

未检测到安装入口或配置来源的客户端不进入首页汇总；仍可在“更多客户端”选择路径。有效配置也是识别证据，但不证明该客户端已安装或在线。

## 读取约束

- 检测不启动客户端，不执行密钥辅助程序、不刷新授权、不发送模型请求。只读识别单文件最多读取 2 MiB，拒绝链接路径；解析失败保留原文件。开启或同步接入时才写模型配置；单独确认 OAuth 账户切换时才写凭据。
- Kimi 新旧数据目录分开识别，不互相借用 token；自定义目录不猜测版本。只读取配置引用的同目录 OAuth 文件；拒绝路径穿越、非文件存储、冲突凭据配置。撤销 tombstone 不产生账户，过期 / 待刷新明确保留状态。
- ZCode 解密遵循原生实现：自定义 `ZCODE_CREDENTIAL_SECRET` 或 OS 平台 / 真实 home / 用户名派生密钥，覆写数据根目录不改变密钥身份。只读取官方命名空间，忽略 MCP 授权及无关凭据；解密失败不伪造账户。用户资料仅展示同一命名空间缓存中的白名单字段，不推断套餐。
- 只有精确官方 HTTPS 端点的 API 才成为客户端账户。第三方配置模型单独聚合；模型声明不增加账户计数。未声明的上下文、协议、思维能力保持未知，不套用猜测值。
- Antigravity 的 `GEMINI_API_KEY` 只有在 `modelProvider = "gemini"` 时生效；`GOOGLE_API_KEY` 不算登录。官方 OAuth 使用系统密钥库，不读取 Gemini CLI 的 `oauth_creds.json` 代替。
- 前端及后端共同限制尚未实现的账户选择 / 启动操作；Antigravity 仍只读。旧版五 / 六客户端接入状态可直接读取，新增客户端默认关闭，不触发自动写入原生配置。

## OAuth 账户切换

- Kimi 与 ZCode 接入现有加密历史和账户卡片。原生登录发生变化后自动保存；点击“切换账户”确认后写回目标目录，不需要开启模型接入，不自动关闭或重启原生客户端。
- Kimi 只跟踪配置实际引用的文件 OAuth，不扫描无关凭据；中国区、Global 与不同 slot 分开。只替换六个原生 token 字段，保留 TOML 和其他 JSON 字段。无法确定身份的 opaque token 按 refresh grant 区分，不虚构邮箱，也不把轮换令牌当作同一个人。
- ZCode 只记录 `oauth:active_provider` 对应的完整会话（用户资料、access / refresh、共享 `zcodejwttoken` 和登录归因），不把残留的另一供应商 token 配上当前用户 JWT。切换遵循原生互斥身份域规则，清除另一 OAuth 命名空间的旧 token / 用户字段，但保留 API、MCP 等无关凭据。写回使用原生 AES-GCM 格式，并遵循同一文件锁；锁占用时提示重试，不删除别人的锁。
- 完整性、区域、目录或环境覆盖有冲突时停止切换。ZCode 会话 JWT 已到期即拒绝切换，不因为 provider 仍有 refresh token 就认为会话有效。只有孤立 token、缺少当前供应商或完整用户资料的旧记录仍可只读显示，但不开放换号。
- 两套 Kimi 配置需先选择版本；CLI / Desktop 同时存在不同有效 ZCode 登录目录时需先指定目录。更多恢复与并发约束见 [OAuth 账户历史](OAUTH-HISTORY.md)。

## 从 ASS 发起登录

- 在 Kimi / ZCode 的“官方账户”标题右侧点击登录图标，选择区域或供应商并确认。先加密保存可识别的旧 OAuth，再打开原生登录终端，由原生客户端处理浏览器授权与令牌写入；ASS 自动记录文件登录变化，不会自动重启客户端。
- 新版 Kimi 使用 `login --region mainland-cn|global`；旧版使用 `login`，仅提供原生默认中国区。能从 npm 包识别新版；程序版本不明确时，先在客户端设置中选择版本，不根据 `kimi.exe` 文件名猜测。两套目录并存或入口与所选版本不一致时要求明确选择。
- ZCode 使用 `login zai|bigmodel`。桌面版必须存在 `resources/glm/zcode.cjs`，通过桌面版自身的 Electron Node 模式运行，不向运行中的桌面窗口传递 CLI 参数。凭据目录须能表示为 `<数据根目录>/.zcode/v2`；自定义配置文件按已选位置保留。
- 登录可能由原生客户端更新默认模型。确认窗提示先结束任务；登录期间不允许 ASS 再次登录、换号或修改同一客户端的接入。终端失败时保留错误等待关闭，避免一闪而过。
- 每次登录使用 ASS 内新的空工作目录，避免加载用户项目 `.env`。子进程清除第三方 API / 授权端点和 Node 启动脚本覆盖项，保留标准代理 / CA 环境变量，Node 启用系统 CA；不关闭 TLS 校验。ZCode 保留原生加密密钥环境，不写入脚本或界面。
- 仅验证了隔离环境中的发起、取消、参数、旧账户保存和并发限制；未替用户进行真实浏览器授权。原生客户端的网络实现与服务端登录结果仍由该客户端负责。

## 账户资料与额度

- Kimi 使用对应中国区 / Global 官方 `/coding/v1/me`、`/coding/v1/usages`。显示返回的用户 ID、邮箱、昵称、会员等级与时间字段，不读取或展示任意资料字段。5h / 7d / 月度总额 / 月度编程额度只显示接口实际返回的窗口；`used_ratio` × 100 为已用百分比，缺失窗口不补零。
- 加量包按原接口固定精度换算，`amountLeft` 不存在时不假定余额为零；保留原币种，不与 Moonshot 通用 API 余额混淆。
- ZCode 使用会话 JWT 读取 `/api/v1/zcode-plan/billing/balance`，仅查询 Start Plan。`app_version` 来自已识别 Desktop 的构建元数据或包信息；没有可信版本则不发请求，不借用 ASS 版本或写死一个新版本。CLI 单独查询及 Coding Plan / Team / MCP 额度尚未实现。
- Start Plan 按可明确归属的有效套餐、额度桶显示剩余 / 总额 / 已用与重置时间，不跨单位求和。剩余使用 `remaining_units`；`available_units` 会扣除进行中请求的预留量，不作为剩余的替代字段。过期与归属不明确的桶不混入当前额度。
- 当前和已保存的 OAuth 账户使用自己的令牌查询，包括既有 Codex / Claude / pi 订阅，不用当前原生文件代替历史账户，也不为查看额度切换登录。缓存按授权指纹隔离、加密持久化；资料与额度独立保留上次成功结果，局部失败不清空其他数据，不把旧额度的时间更新成当前时间。
- 查询只读，复用系统 CA / 系统代理、禁止跳转、限制响应大小，不静默刷新令牌。自定义授权端点或无法确认官方作用域的记录不自动向官方服务器发送凭据。实现以官方源码字段为依据；隔离测试不等于真实用户额度已在线核验。

## Kimi 供应商接入

- “客户端与账户 → Kimi Code”可选择供应商，然后开启接入；更改范围后点击同步。直接使用供应商地址与 API Key，不依赖 ASS 路由服务。退出 ASS 不撤回直连配置。
- 新版默认 `.kimi-code`，旧版 `.kimi`；遵循各自环境变量。只存在一套配置时自动识别，同时存在两套或使用未知自定义目录时，在客户端设置选择配置版本。接入期间更换版本或目录须先断开。
- 新旧版本分别使用 `openai` / `openai_legacy`；Responses 和 Anthropic 独立分组。新版写入模型上下文、输出长度、思维范围与默认档位；输出长度是否使用仍由原生协议实现决定。旧版未提供模型级思维范围字段，因此只写其支持的模型字段，思维控制保留在原生客户端。
- 不改 `default_model`、现有供应商和 OAuth 文件。新增 `ass-…` 表由加密日志记录；同步/撤回只处理这些表。未被客户端重排时保留原文件字节；原生客户端去除注释并重排 TOML 后仍按日志确认所有权，不重写其他表。外部修改了 ASS 字段值时停止覆盖。
- 如果用户已把默认模型切到即将撤回的 ASS 模型，先在 Kimi 中切换模型后再关闭，避免留下无效默认模型。

## ZCode 供应商接入

- 在客户端页按供应商纳入模型，开启 / 同步后直写个人 `provider_config.json`。Chat Completions、Responses、Anthropic 分组为独立的 `ass-…` Provider，不开启 ASS 路由，不修改 `credentials.json` 或官方 Account Provider。
- 遵循 `ZCODE_DATA_BASE_DIR`、`ZCODE_PERSONAL_PROVIDER_CONFIG_FILE` 及手动指定目录。桌面版还读取默认 `~/.zcode/v2/setting.json` 的 `dataBaseDir`，自动发现迁移后的账户和配置。CLI 与桌面出现不同的有效位置时要求指定目录，不猜测写入目标；接入后目标固定，切换须先断开。
- 写入模型上下文、输出上限及可选思维档位，保留 ZCode 原生模型 / 协议的请求参数映射；不伪造工具、视觉等能力。ZCode 没有模型级显示名称和默认思维档位的对应字段，因此模型选择与默认档位留在原生客户端。
- 按 `providerId` 和 `providerId + modelId` 确认条目所有权，不以列表下标或整张列表作为恢复单位。原生重排列表、添加供应商后可继续同步和撤回；重复 / 冲突条目、未知结构、外部修改 ASS 条目会停止覆盖。原有排序、默认模型及非 ASS 规则保留。
- 初次创建文件时补全 `schemaVersion: 1` 和必要的空规则列表，关闭后留下合法空结构；密钥和模型规则全部撤回。当前默认模型属于待移除供应商时，要求先在 ZCode 中切换模型。
- Windows 自动发现常见安装目录下的 ZCode / ZCode Preview；通过 Electron 资源区分桌面版和 CLI。登录只使用明确存在的内置 CLI，不向桌面 UI 传递登录参数或自动重启进程。

## 官方依据

2026-09-23 核对：

- [Kimi Code 数据位置](https://moonshotai.github.io/kimi-code/en/configuration/data-locations.html)、[配置文件](https://moonshotai.github.io/kimi-code/en/configuration/config-files.html)。源码 `MoonshotAI/kimi-code` 提交 `6451f1e056e90037bbf832f3578955cf8e55db64`：`packages/oauth/src/storage.ts`、`toolkit.ts`（逻辑 key 到存储 slot 的映射）、`types.ts`、`token-state.ts`、`packages/agent-core-v2/src/app/kosongConfig/configSection.ts`。旧 CLI 提交 `9ab1286b8fe4e6bcd116949a27ce5e0ac3389c82`，`src/kimi_cli/config.py`、`auth/oauth.py`。
- [ZCode 原生凭据](https://github.com/zai-org/ZCode/blob/872ad960de7ec172591f7e1952f7849229f94521/apps/zcode-cli/packages/adapters/src/auth/shared-credentials.ts)、同目录 `credential-cipher.ts`；[供应商 / 模型规则](https://github.com/zai-org/ZCode/blob/872ad960de7ec172591f7e1952f7849229f94521/packages/provider/src/config/rule-data-schema.ts)。同提交的 `provider-config-file-codec.ts`、`provider-data-schema.ts`、`shared/src/model-config.ts` 定义写入格式；`model-execution.ts` 使用 Vercel AI SDK，Anthropic Base URL 保留 `/v1`。桌面目录与安装身份参照 `desktopDataBaseDirBootstrap.ts` 和 `desktop-product-identity.mjs`。
- [Antigravity CLI 安装与授权](https://antigravity.google/docs/cli/install)。文档中的 Gemini API 模式不是通用 OpenAI / Anthropic 协议接入。
- 登录命令以同一提交的 [Kimi `login.ts`](https://github.com/MoonshotAI/kimi-code/blob/6451f1e056e90037bbf832f3578955cf8e55db64/apps/kimi-code/src/cli/sub/login.ts)、[旧版 Kimi CLI](https://github.com/MoonshotAI/kimi-cli/blob/9ab1286b8fe4e6bcd116949a27ce5e0ac3389c82/src/kimi_cli/cli/__init__.py)、[ZCode `login-command.ts`](https://github.com/zai-org/ZCode/blob/872ad960de7ec172591f7e1952f7849229f94521/apps/zcode-cli/packages/cli/src/login-command.ts) 为依据；ZCode `auth-login.ts` 会保存默认模型，`zcodeAgentProcessManager.ts` 定义桌面内置 CLI 的 Electron Node 启动方式。

当前验证使用合成凭据及隔离 Electron 窗口。本机默认位置未发现三者的实际账户，不宣称真实用户登录、订阅额度或完整 Agent 任务已验证。
