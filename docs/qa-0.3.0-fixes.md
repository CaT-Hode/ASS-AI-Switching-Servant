# v0.3.0 QA 修复记录

基线：b998e0939c1b337ca1756236bcc94a0cc130d7ac。根据随附复现包的九项问题集中完成修改，最后统一执行单测、构建和原生检查；仅失败项或新增验收项补跑相关客户端。

| 项目 | 修改与验证结果 |
| --- | --- |
| DSH Zstd 首帧 | 首帧仅一行 session 头，事件使用后续帧。真实 0.2.0-rc.2 恢复中文/Emoji 历史，mock 请求包含历史问答；原生 v4 追加结果可由 ASS 读取。空记录、长文本、截断、损坏由单测覆盖；截断不再静默当成完整记录。 |
| DSH profile | 配置目标、模型启动、账户启动、项目继续统一解析 profile；独立账户复制受限 bundle 清单。原生自定义 qa-web 和独立 HOME 的 dump-config 验收通过；默认 headless 实际请求通过。 |
| DSH 思考档位 | ultra-only、默认 ultra、没有可表示档位在写入前拒绝；支持的显式档位不降级。实测拒绝时配置和加密所有权日志不变。 |
| Kimi 配置发现 | provider_id/name、default_provider、flat inline 归一化；别名冲突与未知供应商不推断，元数据 overrides 不改变路由。真实 2.1.1 分别用三种形式消费 Chat / Responses / Messages 配置并请求本地 mock。 |
| Kimi 环境覆盖 | 依据原生 KIMI_MODEL_NAME 非空门控判断；完整与缺 key 的覆盖阻止 OAuth preview/apply，状态和独立模型检测使用相同判断。空值、未生效的单独变量、秘密不出现在提示中由单测覆盖。 |
| OpenCode v1/v2 | @opencode/cli 及原生 bin 识别；只读 credential 数据库、多账户 active 状态、公有 CLI 切换；配置密钥与服务凭据冲突保护；session_v2/session_message/new transfer 适配。真实 v1 1.18.33 和 v2 2.0.20 请求认证、历史继续、原生追加读取、删除和重新导入通过；v2 先初始化 credential service 再接入仍正确认证。 |
| DSH 路径契约 | 静态启动器声明按宿主文件系统解释；POSIX 反斜杠不被无条件改写。Windows 测试通过，Ubuntu 已加入 CI 矩阵但本机未运行。 |
| 原生检查入口 | 普通单测不启动原生客户端。test:native 显式启用、固定版本验证、独立 HOME/XDG/APPDATA、合成凭据、本机 mock、结果与证据保留，支持只重跑涉及客户端。ZCode 支持官方 Desktop 资源布局；本机固定包缺失，记 blocked。 |
| Codex 删除边界 | 选择报告允许的边界说明方案：删除前、永久清理前和历史存储页明确说明 thread_history_*.sqlite 正文与远端不在范围。真实 0.159.2 migrate-rollouts 生成 2 条 thread_items；删除 rollout/索引、恢复及清理 ASS 备份后 2 条仍存在，与说明一致。 |

最终单测 **717/717 通过**，`npm run build` 通过。合并各客户端最新验收结果为 **15 项原生检查通过、1 项 blocked（ZCode）**。Windows CLI 检查已运行；Windows 可见终端/开始菜单运行和 Ubuntu 原生消费者未在本轮运行，不能据此宣称跨平台原生验收完成。GUI 清理提示完成构建；本轮未进行 GUI 截图验收。

消费者使用 QA 包指定的官方固定版本，OpenCode v2 源码参考官方 v2.0.20（84c9be93a56304a108f1a22df0c5d62c26d5b6ca）；DSH/Kimi 同时检查已安装固定版本的实际实现。无真实 OAuth 登录、真实用户凭据、外部模型调用。本机运行时 Node 25.8.0；CI 配置 Node 24.19.0，CI 结果需另行观察。

运行和解释方式见 [native-contracts.md](native-contracts.md)。这些修改不覆盖已经发布的 v0.3.0 标签或 release 资产。
