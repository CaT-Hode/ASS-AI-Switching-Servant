<p align="center"><img src="public/ass-logo.png" width="104" alt="ASS chrysanthemum logo" /></p>

# AI Switch Servant · ASS

Windows 桌面端 AI 路由与账户切换工具。独立窗口、托盘运行，不需要打开浏览器管理页面。

## 能做什么

- 导入包含 `providers` 的旧版路由 JSON，保留供应商 ID、模型协议及显式上下文设置。
- Codex 官方请求与第三方 API 严格分流；第三方失败不会自动切到官方账户。
- 通过 Electron / Chromium 网络栈使用 Windows 信任证书和系统代理，不关闭 TLS 校验。
- 按供应商、模型名称推导上下文默认值，支持手动覆盖。
- 双滑块选择 `low / medium / high / xhigh / max / ultra` 范围，也可逐项勾选。非 GPT 模型默认不启用 ultra。
- 内置余额和套餐用量接口，支持同源自定义 GET 接口。
- Codex、Claude Code、OpenCode、pi、DeepSeek Harness 的启动注入与账户选择。
- 在本机 pi 支持时，将 Codex / Claude Code / OpenCode 的兼容 OAuth 导入新的 pi 账户。

## 下载与启动

从 [Releases](https://github.com/CaT-Hode/ASS-AI-Switching-Servant/releases) 下载 Windows x64 ZIP，完整解压后运行 `ASS.exe`。不要只复制 EXE：旁边的资源和 DLL 必须保留。

这是未签名的早期版本。Windows 可能显示来源警告，请核对仓库和 SHA-256；不要关闭系统防护。ASS 不内置各个 harness，请自行安装原生客户端，或在“客户端与账户”选择已有的 exe / cmd / ps1。

### 接入 Codex App

1. 先关闭其他工具的 Codex 路由接管，确保没有竞争修改配置。
2. 在 ASS 导入供应商配置，核对模型协议和地址。官方账户继续使用你现有的 ChatGPT 登录。
3. 点击“检测连接”；它会发送一条小请求，产生少量模型用量。
4. 点击“接入 Codex”，然后完全重启 Codex 并新建任务。

ASS 备份并向 `%USERPROFILE%\.codex\config.toml` 写入带标记的 `ass_router` provider 和模型目录路径，不覆盖保留的 `openai` provider。旧任务可能保留原 provider，不会自动迁移。可在“连接诊断 → 断开 Codex”恢复 ASS 接入前的配置字段；接入后修改的无关字段会保留。

关闭 ASS 主窗口只会隐藏到托盘。退出托盘或停止路由后，经 ASS 的请求无法继续。ASS 重启会轮换客户端本地访问令牌，其他 harness 需从 ASS 重新启动。更改模型目录后，Codex 也需要重启刷新。

### 客户端与账户

| 客户端 | API 账户 | 授权账户 / 切换方式 |
| --- | --- | --- |
| Codex CLI | 已保存供应商，经 Responses 入口或协议适配 | 多个 ChatGPT 原生登录目录；不替换正在运行的 Codex App 登录 |
| Claude Code | 仅 Anthropic Messages 协议模型 | 多个独立 `CLAUDE_CONFIG_DIR`，原生 `auth login / logout` |
| OpenCode | 自动识别 OpenCode Go，支持其他三种 API 协议 | 独立 XDG 目录，原生 `auth login / logout` |
| pi | Responses / Chat Completions / Anthropic | 独立 `PI_CODING_AGENT_DIR`，原生或扩展 `/login /logout` |
| DeepSeek Harness | DeepSeek 配置直接作为 API 账户，也可用其他兼容供应商 | 独立 `DSH_HOME`，生成 `llm-pi-ai` 与默认模型设置，无需重复输入 Key |

在页面中选择账户、模型与工作目录，点击“使用此账户启动”。第三方 API Key 只留在 ASS 后端；客户端获得本地路由令牌，实际请求由 ASS 加上对应供应商凭据。注入只影响 ASS 启动的进程及其专用目录，不写原客户端全局配置，不强制终止已有会话。

官方 OAuth 使用原生客户端刷新机制；ASS 不实现登录服务器、不代替用户授权，不保证某个订阅在另一 harness 中享有相同权益或计费方式。

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
```

可选原生客户端检查：设置 `ASS_QA_CLIENTS` 指向另行安装客户端的 `node_modules`，再运行 `node scripts/harness-qa.cjs`。它使用合成凭据，不执行真实 OAuth 刷新。`live-qa.cjs` / `codex-qa.cjs` 是需要显式环境变量的实网测试，会产生模型用量，不属于默认测试。

打包 Windows x64 便携应用：

```powershell
npm.cmd run package
node scripts/package-qa.cjs
```

产物在 `release/ASS-win32-x64`。打包包含 Electron，所以安装体积不等同于原生小工具；轻量化主要指无额外后台服务、无多余管理功能。客户端接入验证脚本是可选项，参数及环境变量见脚本头部。

实现按 `core/`（路由、账户、目录与配置）、`electron/`（原生窗口、网络和凭据）、`src/`（React UI）划分。设计及协议来源见 [SOURCES.md](SOURCES.md)。
