# 验证范围 · v0.1.0

2026-09-21，在 Windows / Node.js 24 / Electron 44 环境检查。测试数据目录与正常应用目录分离，未修改真实 Codex 全局配置。

## 自动检查

- 核心测试：导入、目录字段、配置接入/恢复、凭据分流、同源余额请求、SSE 截断与无 Content-Type 检查。
- 五种 harness 配置生成、官方与 API 环境隔离、账户切换、OAuth 格式转换、来源文件不变、pi 新账户导入、不向渲染进程发送令牌。
- Electron 窗口 UI：模型编辑、非 GPT ultra 默认限制、余额设置、配置接入/恢复、DPAPI 落盘、账户创建、键盘 Escape 和焦点恢复、减少动态效果、1100px 横向窗口无横向溢出；无页面异常。
- npm audit：发布准备阶段 0 项已知漏洞。

## 原生客户端检查

- 本机 Codex 实际加载生成目录，官方模型、MiMo Responses、Anthropic 转换文本请求完成。
- 工具验证中，官方与 MiMo 的调用进入了 Codex 命令执行路径，但被本机只读策略拒绝；未绕过策略，因此不宣称命令执行成功。当前 Codex 某些模式只在提示内声明工具，不传标准 `tools` 数组：Anthropic 转换在这种模式下没有可转换的函数定义，尚不具备完整 coding-agent 工具兼容性。请优先使用原生 Responses，或从 ASS 启动 Claude Code / pi 的 Anthropic 接入。
- pi 0.73.1 实际读取生成的模型目录；运行时读取到 anthropic / github-copilot / openai-codex OAuth 类型。其原生 AuthStorage 读取 ASS 转换的合成 Codex OAuth 文件，确认识别为已配置授权账户；来源文件不变，未调用刷新接口。
- OpenCode 1.18.31 实际解析 inline provider 配置，模型为 `ass/test-chat`，XDG 数据目录隔离生效。
- DeepSeek Harness 0.1.5-rc.2 的实际 `llm-pi-ai` schema 接受生成配置，CLI 版本和默认启动配置可读取。
- Claude Code 2.1.223 原生 auth 子命令可用。API 环境及 Anthropic 协议转发通过自动检查。

## 实网边界

- 当前 Windows CA 环境中，官方 Codex HTTP/SSE 返回完整 `response.completed`。
- 两个实际第三方模型入口返回完整响应；另一个供应商检测出现不完整流，ASS 未将其标为成功。
- Sub2API 余额接口实测成功；另两个通用中转余额探测返回 HTTP 400。其余内置适配器使用响应样本单测，不宣称全部实网验证。
- 未替用户完成新的 OAuth 网页授权，未撤销或刷新用户来源账户。OAuth 导入以格式、隔离目录、原生注册表和不可覆盖测试为证据；供应商是否允许刷新或使用由原生客户端验证。
- 不将简单文本连接检测等同于全部工具、文件、图像、长上下文、跨客户端订阅权益验证。

## 发布包检查

- Windows x64 便携版以全新测试目录启动独立窗口；检查空供应商列表、五种客户端页面、pi OAuth 导入区域、Windows 凭据加密可用及本地服务启动。
- 包内排除私有测试目录、账户文件、配置导出、开发依赖和测试脚本；校验 SHA-256 随 ZIP 发布。

没有把真实 API Key、用户导出或测试账户打入源码和发布包。UI 截图与私有测试数据不随源码发布。
