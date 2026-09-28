# ASS v0.1.31

## 修复 CC 无账号启动的 spawn EINVAL

- 修复 Windows npm 安装入口 `claude.cmd` 在版本检测中被当成原生可执行文件，导致开启确认窗口报 `spawn EINVAL` 的问题。
- `.cmd` / `.bat` / `.ps1` 检测通过隐藏的 PowerShell 宿主执行，路径和参数按字面量传入；`.exe` / Node.js 入口仍直接执行。
- 检测失败给出可操作的提示，仍保留 8 秒时限和 Claude Code 2.1.242 最低版本要求。
- 测试模式不再跳过正式版本检查；加入旧版本拒绝和 Windows 脚本入口回归测试，避免测试通过但正式版无法开启。

这次只修复开启前的版本检查，不修改已有供应商、API Key、OAuth 或模型配置；Codex 的开关逻辑未改动。

## 验证

- 本机真实 npm `claude.cmd` 版本检测通过。
- Windows `.cmd` / `.ps1` 含空格、括号、单引号及 `&` 的路径实测通过；原生 Node 入口、旧版本拒绝、启动失败提示通过。
- 使用独立用户数据和模拟接口验证打包版的开启确认、版本门槛、重启持久化、关闭恢复；不关闭用户正在运行的客户端。

## 更新

从托盘退出旧版 ASS 后启动新版，再开启 CC 的无账号模式。旧版窗口不会通过重新打开快捷方式自动升级，版本号应显示 v0.1.31。

原因参见 [Node.js 官方 Windows 脚本启动说明](https://nodejs.org/api/child_process.html#spawning-bat-and-cmd-files-on-windows)。
