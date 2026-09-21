<p align="center"><img src="public/ass-logo.png" width="104" alt="ASS chrysanthemum logo" /></p>

# ASS

**模型随你切，账户由你管。**

ASS（AI Switch Servant）是你的 Windows 桌面 AI 路由与账户助手。把模型、API 凭据与官方授权放到一个独立窗口，切换客户端时不必反复搬配置。关闭窗口后继续在托盘运行。

## 能做什么

- 导入包含 `providers` 的旧版路由 JSON，保留供应商 ID、模型协议及显式上下文设置。
- Codex 官方请求与第三方 API 严格分流；第三方失败不会自动切到官方账户。
- 通过 Electron / Chromium 网络栈使用 Windows 信任证书和系统代理，不关闭 TLS 校验。
- 按供应商、模型名称推导上下文默认值，支持手动覆盖。
- 双滑块选择 `low / medium / high / xhigh / max / ultra` 范围，也可逐项勾选。非 GPT 模型默认不启用 ultra。
- 内置余额和套餐用量接口，支持同源自定义 GET 接口。
- Codex、Claude Code、OpenCode、pi、DeepSeek Harness 的启动注入与账户选择。
- 每个客户端独立的接入开关；简短警告后确定或取消，确认后恢复注入、按需结束 ASS 窗口与停止服务。
- 在本机 pi 支持时，将 Codex / Claude Code / OpenCode 的兼容 OAuth 导入新的 pi 账户。
- “客户端与账户”按客户端绑定显示已有 API / OAuth 账户；添加入口保留官方 API 预设、OpenRouter PKCE 和 Cursor Key 保管。
- “供应商与模型”聚合卡片与二级菜单；已配置模型可直接修改 ID、显示名称、接口、上下文和默认思维强度，或删除模型。
- 自动检测五类客户端的本机 OAuth / API 凭据，按账户与供应商在右侧显示卡片。支持默认目录、环境变量目录与手动指定目录。
- 账户卡片显示凭据中已有的邮箱、套餐、账户 / 组织、权限与到期时间；DeepSeek / OpenRouter 可只读刷新官方资料。字段来源与未支持范围见 [账户资料对照](docs/ACCOUNT-INFO.md)。
- 路由状态固定在左栏底部；侧栏鼠标悬停、按下与选中反馈支持键盘即时操作和减少动态效果。
- 每个模型右侧的闪电单独检查连接；选中供应商自动获取模型目录，可搜索并一键添加，再用小请求检测协议、工具调用与思维参数。
- 自动识别客户端入口，支持安装目录、npm 包目录、JS 入口及 DeepSeek Harness 源码目录。
- 自动检查 ASS 新版本，支持正式 / 预览渠道、手动检查、发布说明与下载入口；不静默安装，不打断当前请求。

## 下载与启动

从 [Releases](https://github.com/CaT-Hode/ASS-AI-Switching-Servant/releases) 下载 Windows x64 ZIP，完整解压后运行 `ASS.exe`。不要只复制 EXE：旁边的资源和 DLL 必须保留。

这是未签名的早期版本。Windows 可能显示来源警告，请核对仓库和 SHA-256；不要关闭系统防护。ASS 不内置各个 harness，请自行安装原生客户端，或在“客户端与账户”自动识别、选择安装目录或启动文件。

### 接入 Codex App

1. 先关闭其他工具的 Codex 路由接管，确保没有竞争修改配置。
2. 在 ASS 导入供应商配置，核对模型协议和地址。官方账户继续使用你现有的 ChatGPT 登录。
3. 点击目标模型右侧的闪电；它只检测该模型，会发送一条小请求，产生少量模型用量。
4. 打开“客户端与账户 → Codex”，开启“ASS 接入”，查看影响并确认；等已有任务结束后完全重启 Codex，并新建任务。

ASS 备份并向 `%USERPROFILE%\.codex\config.toml` 写入带标记的 `ass_router` provider 和模型目录路径，不覆盖保留的 `openai` provider。旧任务可能保留原 provider，不会自动迁移。在“客户端与账户 → Codex”关闭接入，二次确认后恢复 ASS 接入前的配置字段；接入后修改的无关字段会保留。

关闭 ASS 主窗口只会隐藏到托盘。退出托盘或停止路由后，经 ASS 的请求无法继续。ASS 重启会轮换客户端本地访问令牌，其他 harness 需从 ASS 重新启动。更改模型目录后，Codex 也需要重启刷新。

### 接入开关与安全关闭

全局“接入 Codex”按钮已移除。五种客户端各有接入开关，点击后只显示简短警告和“确定 / 取消”，不再展示分步菜单、勾选项或 PID 清单。默认焦点在取消；取消、Escape 或默认回车都不会更改接入。

- **开启**：启用该客户端的本地路由，API 注入在下次从 ASS 启动时生成。Codex 还会更新 App 配置；ASS 不擅自重启 App。其他客户端的原生 OAuth 保持官方直连。
- **断开**：警告中提示需要关闭的 ASS 窗口数量；确定后，只结束经身份校验的 ASS 启动窗口及已确认子进程，再恢复接口配置。不按进程名批量结束程序；有进行中请求、身份不明或状态变化时仍拒绝操作。
- **恢复注入**：只恢复或移除 ASS 登记的配置文件，不删除账户授权、会话、项目和工作目录。配置被其他程序修改时停止操作，不用旧备份覆盖新内容。旧版可明确识别的 ASS 配置会先保留恢复副本。
- **服务生命周期**：使用 `/clients/<harness>/…` 分开管理。关闭某一接入不会停止其他接入；关闭最后一个接入时才关闭共享路由端口。全部关闭状态跨重启保留；用户主动检测模型时可按需启动检测服务。
- **停止全部 / 安全退出**：位于客户端页及托盘，同样只显示警告和确定 / 取消，保留全部后台检查。

**请求数为 0 不代表任务结束。** 客户端可能正在执行工具或等待输入。ASS 不能判断未托管窗口的任务状态；Codex App、旧版 ASS 启动但未登记的窗口，以及自行启动的客户端需用户先退出。PID 会与创建时间、随机会话标记及父子关系重新核对；身份不明时不强制关闭。进程树检查不是 Windows Job Object 隔离，主动脱离进程树的后台服务不在自动关闭保证范围内，需由其原生客户端管理。

接入状态、注入恢复记录与窗口身份分别保存在本机 `connections.json`、`route-injections.json`、`client-processes.json`，不随源码和 Release 发布。退出后已有旧任务可能仍保留旧路由地址；重新进入原生客户端时请新建任务并选择正确账户 / 模型。

### ASS 更新

“关于 ASS”或侧栏底部版本号均可打开更新页；托盘菜单也可以手动检查。

- 默认启用自动检查：启动约 10 秒后按需检查，此后成功检查间隔 6 小时。缓存跨重启保留，不因反复启动重复请求。
- 0.x 与语义预发布版本默认包含 GitHub 预览版；可以关闭，只看正式版。按照语义版本比较，不按字符串排序，不推荐降级。
- 发现新版只显示可收起的提示；“下载 Windows 版”在浏览器打开本仓库对应的发布包，不自动安装或重启。
- 仅查询本仓库最近 100 个公开 Releases，使用系统代理与 CA、15 秒超时及 ETag 缓存。断网后自动延迟 15 分钟重试；GitHub 限流按返回时间退避。错误不影响模型路由。
- 不上传模型、账户、密钥或配置，不附带模型凭据、GitHub Token 或浏览器登录 Cookie。更新偏好与公开发布缓存单独保存在 `updates.json`。
- 发布包名称、来源 URL 与上传状态会核对；页面中的 SHA-256 来自发布元数据，不等于已在本机校验下载文件。下载后核对发布页提供的 SHA256SUMS.txt。

升级便携版时，先等路由请求结束，从托盘退出旧版，再完整解压新版并运行其中的 `ASS.exe`。桌面快捷方式若仍指向旧目录，需要更新目标。现有 `%APPDATA%\AI Switch Servant` 数据目录保持不变，无需因品牌显示调整而迁移账户。

### 客户端与账户

| 客户端 | API 账户 | 授权账户 / 切换方式 |
| --- | --- | --- |
| Codex CLI | 已保存供应商，经 Responses 入口或协议适配 | 多个 ChatGPT 原生登录目录；不替换正在运行的 Codex App 登录 |
| Claude Code | 仅 Anthropic Messages 协议模型 | 多个独立 `CLAUDE_CONFIG_DIR`，原生 `auth login / logout` |
| OpenCode | 自动识别 OpenCode Go，支持其他三种 API 协议 | 独立 XDG 目录，原生 `auth login / logout` |
| pi | Responses / Chat Completions / Anthropic | 独立 `PI_CODING_AGENT_DIR`，原生或扩展 `/login /logout` |
| DeepSeek Harness | DeepSeek 配置直接作为 API 账户，也可用其他兼容供应商 | 检测 `.credentials.yaml` 的 API refs 与 `llm-pi-ai` OAuth records；独立 `DSH_HOME` 支持原生授权设置 |

在客户端页右侧选择已有账户，点击“启动”。DeepSeek 官方 API 自动归入 DSH，OpenCode Go 自动归入 OpenCode；其他 API 通过“添加账户”选择已有供应商。旧版本已选择或使用过的 API 保留绑定。解除绑定不会删除供应商、撤销凭据或中断运行中的客户端。

模型在“供应商与模型”统一管理；各已绑定客户端的启动模型也在对应供应商下选择。API Key 只留在后端，客户端获得本地路由令牌。API 注入写入专用目录；本机账户直接使用原有凭据目录，不复制或覆盖其令牌。账户选择作用于下一次由 ASS 启动的客户端，不替换正在运行的 Codex App 登录。

本机 Codex 读取 `CODEX_HOME/auth.json`；Claude Code 读取 `CLAUDE_CONFIG_DIR/.credentials.json` 或环境中的 `CLAUDE_CODE_OAUTH_TOKEN`；OpenCode 读取 `XDG_DATA_HOME/opencode/auth.json`；Pi 读取 `PI_CODING_AGENT_DIR/auth.json`；DSH 读取 `DSH_HOME/.credentials.yaml`。未设置环境目录时使用各客户端默认位置，也可在“客户端路径与凭据目录”指定。多供应商凭据分别显示，不把一个文件当作一个账户。

“已检测 OAuth”仅证明本地存在凭据，不表示服务端验证通过。显示已到期、待原生刷新、损坏或不可识别状态，不执行密钥命令或静默刷新令牌。Codex 系统密钥库 / 临时存储显示“由原生客户端确认”，不误报未登录。OpenCode 与 DSH 的本机多供应商记录共享原生配置目录，启动后仍需在原生客户端选择供应商；Pi 可用 `--provider` 指定供应商。

账户、模型、上下文与强度、余额配置、客户端入口、指定凭据目录、工作目录、接入开关和更新偏好持久保存；页面 / 客户端 / 供应商选择也跨重启保留。界面选择保存在 `preferences.json`，账户与模型选择保存在 `clients.json`，都位于原数据目录。登录状态不缓存为配置，而在启动、返回窗口及客户端页前台每 15 秒重新读取，避免退出后继续显示旧状态。

官方 OAuth 使用原生客户端刷新机制；ASS 不实现登录服务器、不代替用户授权，不保证某个订阅在另一 harness 中享有相同权益或计费方式。

### 添加官方账户

原独立账户页面已合并至“客户端与账户”。“添加账户 → 新建 API 账户”保留官方服务与地区预设，按当前客户端协议筛选；列表不再铺开未添加的服务。原生授权通过“添加账户 → 原生授权账户”创建，pi 的 OAuth 能力仍由本机安装的客户端确认。

| 账户方式 | 管理范围 |
| --- | --- |
| 官方 API Key | 多套账户、编辑凭据、模型管理、余额查询、选择兼容客户端；与供应商配置共用一份加密凭据 |
| ChatGPT / Claude 原生 OAuth | 创建独立账户目录、原生登录、选择账户启动、状态刷新；原生退出流程位于“客户端与账户” |
| GitHub Copilot OAuth | 本机 pi 注册表确认支持后，创建 pi 授权账户并原生登录 |
| OpenRouter PKCE | 浏览器确认权限和额度，本机随机回调 + S256，换取独立 API Key 后加密保存；不是订阅令牌 |
| Cursor API Key | 多套加密保管、更新、移除和主动复制到原生客户端；不转换为通用模型 API |
| Cursor / Kimi 原生 OAuth | **由原生客户端管理**；本版本不提供其 OAuth 多账户快照、切换或跨客户端移植 |

同一服务的不同产品与地区分开列出，例如 Kimi Code / Moonshot、Z.ai 通用 API / Coding Plan、OpenCode Go / Zen。它们的 Key 和额度不应混用。支持的服务名不等于所有账户与模型均已实网验证。

官方归类按已知 API 域名匹配，不按自定义名称或品牌猜测。Cursor Key 从“添加原生客户端 Key”保存；已有 Cursor Key 在对应客户端卡片中管理，不提供路由开关。主动复制后，若剪贴板未被替换，30 秒后清空；系统剪贴板历史和其他应用可能保留副本。

### 模型卡片与行内配置

供应商卡片显示地址、模型数、接口、上下文、思维档位、检测结果与余额；菜单提供发现模型、编辑供应商和余额查询。“查看全部模型”定位到主页面的“已配置模型”。五个常用字段直接编辑，逐行保存或取消；高级设置仍提供思维范围双滑块。

重命名模型同步更新 ASS 保存的启动模型选择；删除模型移除对应配置并清理旧选择，不删除供应商密钥。重复 ID、无效上下文和过时草稿会被拒绝。官方订阅的接口固定为 Responses；不支持将订阅端点改成其他协议。

原生账户能读取的模型声明一并聚合为只读目录（Claude settings、pi models、OpenCode provider 配置、DSH llm-pi-ai 配置）；没有目录时明确标为未读取，不据账户登录状态猜测全部可用模型。它们不是联网验证，也不把原生 OAuth 当作通用 API 密钥。

### 自动识别安装或源码目录

“客户端与账户 → 自动识别”检查 PATH 与有限的常见安装位置。DeepSeek Harness 也检查如 `D:\deepseek-harness` 的源码位置；不全盘扫描，不自动安装依赖或执行构建脚本。

选择 DSH 源码根目录时，核对 package manifest 后优先使用 `apps/cli/lib/bin.js`，不存在时才检查源文件及已安装的本地 tsx。缺少运行条件会明确报错；检测到多套入口时由用户选择。启动入口与工作目录分开，项目工作目录不会被替换成 harness 源码目录。

### 模型连接与能力检测

- 闪电：只验证被点击的模型，结果按“供应商 + 模型”保存。检查完整流，不将 HTTP 200 或截断流当作成功。
- “发现模型与能力”：同源查询 `/models`，展示供应商明确声明的上下文、模态、工具与思维参数；可逐项加入配置，不覆盖已有模型。
- 模型右侧能力按钮：“自动检测能力”经确认发送少量小请求，每条最多请求 512 输出 tokens；检测协议、带随机标记的真实工具调用结构、已配置思维档位以及非法值对照。工具不会被执行；遇到认证错误、限流或服务器错误停止继续探测。
- 缺失声明标为未知。非法值也被接受时，合法档位标为“接受但未确认生效”；即使参数校验通过，也不代表不同档位的推理质量已得到证明。
- 不盲测精确上下文上限或大体积图像 / 音频 / 视频。官方 Codex 订阅读取本机目录并使用闪电检测，不套用通用 API 探测。结果仅在本次会话保留；变更配置后清除旧结论。

### 将 OAuth 导入 pi

1. 先在 Codex / Claude Code / OpenCode 中完成原生登录。
2. 在 ASS 为 pi 选择已安装的 npm 启动文件，点击“刷新状态”。ASS 从该安装的 pi-ai OAuth 注册表读取支持的类型。
3. 在 pi 页的“从其他客户端导入 OAuth”选择兼容来源，确认导入。
4. ASS 创建一个新的 pi 账户，转换必要字段；不会覆盖已有 pi 账户或来源文件。

已实现 Codex → `openai-codex`、Claude → `anthropic`、OpenCode 兼容 OAuth → 对应 pi provider。只有 API Key、缺失 refresh / expiry / account ID、不受本机 pi 支持的来源均拒绝作为 OAuth 注入。独立二进制或动态扩展无法被本地注册表探测时，仍可在 pi 中原生登录，但跨客户端导入不会猜测兼容性。

**导入是授权快照，不是跨客户端同步。** 两端独立刷新或退出授权，可能让另一端失效。遇到刷新冲突请重新登录，不能通过该功能绕过供应商权限或额度。

## 余额接口

内置 NewAPI、Sub2API、DeepSeek、StepFun、SiliconFlow、OpenRouter、Novita、Kimi、Kimi Coding Plan、MiniMax Token Plan。自动识别官方域名，通用中转依次尝试 NewAPI / Sub2API。未匹配可配置自定义路径、数值字段、单位和换算系数。

余额请求只发往该供应商同源地址，不跟随重定向。不同币种分别显示，套餐剩余百分比不冒充现金余额，缺失字段不当作 0。具体 API 是否开放、需要普通 Key 还是管理 Key，由供应商决定。

## 数据与安全边界

- 应用数据：`%APPDATA%\AI Switch Servant`；退出应用不会删除它。
- API Key 和额外请求头由 Windows DPAPI 加密。不能直接将加密数据文件复制到另一 Windows 用户使用。
- OAuth 文件按各客户端原生方式保存在专用账户目录，不承诺其是 DPAPI 加密文件。不要分享整个应用数据目录。
- 请求日志只保留模型、来源、状态、耗时和脱敏错误，不记录对话正文和授权头。轮换日志约 2 MiB。
- 导出配置不含 Key 或额外请求头。发布包不携带账户、个人配置或聊天记录。
- 只监听 `127.0.0.1:25819`，拒绝带浏览器 Origin 的管理外请求。没有远程 Web 管理接口。
- 不修改全局证书、不关闭 TLS 校验、不替换登录域名、不静默跨供应商 fallback。

## 协议和能力限制

Codex Responses 可透传；转换到 Chat Completions / Anthropic 的路径当前只支持文本与函数工具，不支持图片、文件、跨协议 `previous_response_id` 和服务端 compact。其他 harness 使用相同协议原样转发工具结构，无需经 Codex 格式转换。

**Codex 跨协议工具支持仍为实验性**：若当前 Codex 模式没有发送标准 `tools` 定义，ASS 不能凭提示文本重建所有工具；Anthropic 转换只能验证文本，不等同于完整编程代理。此时请选择原生 Responses 模型，或使用 Claude Code / pi 原生协议接入。ASS 不绕过客户端执行策略。

上下文和思维强度菜单是配置声明，**不是上游能力验证**。某些供应商忽略参数，某些返回 400 / 502。ASS 不静默将 ultra 降级为 max，也不把错误流标为成功。pi 等客户端自身支持的思维档位可能少于 ASS / Codex，启动时不会强塞客户端不识别的参数。

仅本地连接测试成功，不代表所有模型、工具、长上下文和登录刷新都已经端到端验证。各客户端、服务端协议可能升级，详见 [验证记录](docs/VALIDATION.md)。

## 开发

Windows、Node.js 24+、npm。无需 Python 服务端。

```powershell
npm.cmd ci
npm.cmd test
npm.cmd run build
npm.cmd start
```

运行 UI 自动测试（使用独立测试数据，不接管你的 Codex）：

```powershell
node scripts/qa.cjs
node scripts/features-qa.cjs
```

可选原生客户端检查：设置 `ASS_QA_CLIENTS` 指向另行安装客户端的 `node_modules`，再运行 `node scripts/harness-qa.cjs`。它使用合成凭据，不执行真实 OAuth 刷新。`live-qa.cjs` / `codex-qa.cjs` 是需要显式环境变量的实网测试，会产生模型用量，不属于默认测试。`inspection-live-qa.cjs` 还需指定 `ASS_IMPORT_FILE / ASS_LIVE_PROVIDER / ASS_LIVE_MODEL`，仅探测一个模型的 low 档位。UI 测试使用独立目录与 25820 测试端口。

打包 Windows x64 便携应用：

```powershell
npm.cmd run package
node scripts/package-qa.cjs
```

产物在 `release/v<版本号>/ASS-win32-x64`，不同版本独立打包目录，避免旧目录句柄占用影响更新。打包包含 Electron，所以安装体积不等同于原生小工具；轻量化主要指无额外后台服务、无多余管理功能。客户端接入验证脚本是可选项，参数及环境变量见脚本头部。

实现按 `core/`（路由、账户、目录与配置）、`electron/`（原生窗口、网络和凭据）、`src/`（React UI）划分。设计及协议来源见 [SOURCES.md](SOURCES.md)。
