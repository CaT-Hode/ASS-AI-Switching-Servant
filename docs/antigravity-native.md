# Antigravity 原生识别

> 历史归档：ASS 已停止提供 Antigravity 客户端入口、自动扫描和账户切换。本页仅保留旧版数据格式说明，便于安全升级；不代表当前支持范围。

当前源码支持 Windows CLI、2.0 Desktop 与独立 IDE 的安装发现，以及新原生运行时的共享 OAuth 状态读取。没有启动客户端、登录、刷新 token、修改凭据或关闭任务的隐式操作。

## 安装与账户

- CLI：PATH 中的 `agy`、`%LOCALAPPDATA%/agy/bin/agy.exe` 及官方文档中的 Program Files 路径。
- Desktop / IDE：用户安装和 Program Files 目录，检查产品元数据，不把任意重命名 EXE 算作安装；桌面程序不接收 CLI 的登录参数。同时发现两种桌面程序时，先选择具体入口才开放“打开桌面端”。
- 配置来源分别是 `.gemini/antigravity-cli`、`.gemini/antigravity`、`.gemini/antigravity-ide`。目录存在只表示发现客户端数据，不表示已登录。
- 系统凭据仅查询 `gemini:antigravity`，不枚举、不读取其他服务。应用启动或刷新客户端时异步读取，最多等待 5 秒；凭据值只在主进程内解析，界面与持久化状态不接收 token。
- 文件回退为 `.gemini/jetski-standalone-oauth-token`，支持新 `StoredToken` 对象与旧 OAuth2 Token 对象。正常优先系统条目；系统条目不存在 / 读取失败时使用原生文件；一小时内的 `cache/antigravity-keyring-unavailable` 标记使文件优先。ASS 不创建、清除或更新该标记。
- 空的当前系统授权不会用旧文件伪装成另一个已登录账户；过期、待原生刷新、缺失访问令牌分别保留状态。不会把仅有套餐或项目信息的残留记录算作账户。
- ASS 运行时定期检测当前原生存储的 OAuth 变化，把完整 `StoredToken` 连同恢复事务用 Windows DPAPI 加密保存；界面只拿到账户白名单字段。
- 账户卡片可在确认后切换已保存的 OAuth。切换前重新比对当前值；写入失败会回滚，外部登录已再次改动时停止自动恢复。系统条目固定为 `gemini:antigravity`，文件回退只写原生 token 文件。
- 自定义目录不借用默认系统凭据；测试 home 不访问宿主密钥库。路径拒绝符号链接，文件最多读取 2 MiB。
- `modelProvider: "gemini"` 配合 `GEMINI_API_KEY` 才算 CLI API 账户。单独出现环境变量、普通 Gemini CLI 凭据、IDE UI 缓存都不是 Antigravity 登录证据。CLI API 模式与已发现 Desktop / IDE 的共享 OAuth 分开显示。

账户卡片只展示现有字段：Google ID Token 的邮箱、名称、用户 ID、组织域名，以及原生记录的套餐、项目、区域、授权类型与到期时间。ID Token 只解码为本机显示元数据，不作为在线验证结果；套餐为本机记录，不当作实时余额。共享 OAuth 只显示一张卡片。

## 尚未开放

原生登录发起、第三方模型注入、模型请求测试及额度 / Token 查询。旧 IDE 若使用不同的专有存储，不猜测或扫描其 SQLite 密钥。当前本机没有安装 Antigravity，真实登录、换号与旧版本兼容性仍需联调。

## 实现依据

- [官方 CLI 安装与授权](https://antigravity.google/docs/cli/install)、[独立 IDE 说明](https://antigravity.google/docs/ide/overview/)、[官方下载页](https://antigravity.google/download)。
- 官方更新清单提供的 [agy 1.2.9 Windows 二进制](https://storage.googleapis.com/antigravity-public/antigravity-cli/1.2.9-5905287731871744/windows-x64/cli_windows_x64.exe)，SHA512 `f903d73005b1b0374abc73de9cea260f1c80d18c9411db15dd67d05372a1a93b3560d1d8cb907125a3f00274758143c7394af490d3624dcbe82c8874ebb51a8a`。只做离线检查，未执行。
  - `code_assist_client/token_storage.go`：StoredToken JSON 字段、keyring service `gemini`、默认文件路径和旧 Token 兼容读取。
  - `auth_client/auth_client.go`：keyring user `antigravity`。
  - `code_assist_client/composite_token_storage.go`：系统 / 文件优先级、失败标记与一小时有效期。
- 官方 Google LLC 签名的 [Desktop 2.16.0 安装包](https://storage.googleapis.com/antigravity-public/antigravity-hub/2.16.0-4917332007583744/windows-x64/Antigravity-x64.exe)，仅解包：`package.json`、`dist/paths.js`、`dist/ideInstall/constants.js` 用于桌面产品身份、配置路径和 IDE 安装目录。没有安装或运行程序。
- [go-keyring Windows 实现](https://github.com/zalando/go-keyring/blob/master/keyring_windows.go) 使用 `service:username` 作为 Generic Credential 目标。ASS 只对固定目标调用 `CredReadW`、`CredWriteW`、`CredDeleteW` 与 `CredFree`，不实现凭据枚举。

这属于对指定原生版本的适配，不是 Google 对第三方账户管理器的稳定接口承诺。原生布局变化时保留“无法读取”，不代用其他账户。
