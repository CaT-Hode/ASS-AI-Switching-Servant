# ASS v0.1.28

## 无账号启动

- Codex / Claude Code 的客户端页增加“无账号启动”开关，仅在已有非空且已同步的模型接入后可开启。
- Codex 桌面端使用原生自定义 provider 配置，不伪造 OAuth、不替换 auth.json；模型目录只保留已注入项。开启、关闭仍使用原有确认和可选强制重启流程。
- Claude Code 使用隔离配置、API 路由令牌和自定义模型列表。Default 仍是客户端固定入口，但解析到注入模型；没有官方内置模型兜底。启动前检查 2.1.242+，本机已获授权升级到 2.1.283。
- 模式、目录与专用本地凭据随已应用配置加密保存，重启后保留；关闭恢复常规启动。官方账户及其切换记录不删除。

## 模型协议检测与转换

- 保存供应商、添加/修改模型会排队发起少量请求；注入前补查所选供应商的启用模型。逐模型闪电测试强制刷新协议结果。
- 每个模型分别验证 Responses 和 Messages，必要时再检查 Chat。429 会停止后续检测；401/403 不作为协议不支持的结论。
- Codex 优先 Responses，Claude Code 优先 Messages；DSH / OpenCode / pi / Kimi / ZCode 优先 Responses，再选其他已验证接口。后三方客户端仍直接写入原生配置，不因检测而改用代理。
- 支持 Responses → Messages / Chat，以及 Messages → Responses / Chat 的路由转换。保留文本、图片、函数工具、工具结果、流式结束标记和用量；Codex 自定义文本工具及 namespace 工具通过 JSON 函数桥接后恢复原有身份，ASS 不执行工具。
- 修复新版 CC 附加 system 消息导致跨协议请求在本地被拒绝；同步修复 DeepSeek 原生 Messages 的地址选择。
- 结果保存在加密的 protocols.enc.json，含检测时间、HTTP 状态与请求耗时。已确认结果 24 小时后重新检查，未知结果 5 分钟后可重查；编辑地址、Key、网络出口、额外请求头或模型 ID 后失效。临时失败保留历史成功，不用一次 502 改判不支持。
- 检测不切换正在运行的路由：新协议需确认同步后才进入已应用快照。不会切换到其他模型或官方账户，不在已输出内容后自动重放请求。

## 验证与边界

- 444 项自动测试通过；隔离的 Electron 窗口验证启用前提、两个客户端开关、自动协议选择、重启持久化及原 OAuth 不变。
- 本机 CC 2.1.283 实际验证：无 OAuth、7 个注入模型；Claude 原生 Messages 请求成功，GPT 经 Messages → Responses 转换成功，并完成测试 MCP 工具调用及第二轮结果回复。
- 实际供应商双协议检测：GPT 的 Responses 成功、Messages 返回 403；Claude 两种协议均成功。403 保留为权限/访问待确认，不误写为永久不支持。
- 已安装 Codex 桌面端的 app-server 在独立无 auth.json 目录返回 account=null、requiresOpenaiAuth=false，模型列表只有注入项。未重启用户当前 Codex 或 DSH，未宣称完成真实桌面 GUI 重启验证。
- 协议转换不能补齐模型自身没有的能力。托管服务端工具、服务端 compact、缺少完整历史的 previous_response_id，以及无法表达的内容会明确拒绝；上游欠费、权限、限流与故障也不保证可用。实际测试仅证明所测试模型/请求，不代表所有供应商的所有高级功能。

实现参照 [CC Switch 双向转换架构](https://github.com/farion1231/cc-switch/blob/main/docs/guides/codex-claude-routing-guide-en.md)，按 ASS 的路由和原生配置体系独立实现。Claude 模型目录依据 [官方 modelPicker 配置](https://code.claude.com/docs/en/settings-reference#modelpicker)，Codex 无 OAuth 接入依据自定义 provider 的 requires_openai_auth 配置及本机桌面运行时验证。
