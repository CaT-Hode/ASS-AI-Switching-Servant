# 第二轮 QA 修复记录

日期：2026-10-01。报告基线是较早的 24f30b2；本轮从当前 main 532f958 继续修改。当前版本号保持 0.3.1，未修改已发布标签或发布附件。

## 已修复

| 报告项目 | 当前处理 |
| --- | --- |
| PB-01 | 完整 SSE 事件经过校验后才转发；分片的 response.failed/error 不会把错误正文或密钥提前发给客户端。失败返回完整规范错误帧。 |
| PB-02 / PB-03 | 读流退出、异常、取消和协议终止均取消 reader，并在路由 finally 中中止 controller、释放计时器和活动计数。Chat 的 finish_reason 不作为协议终止，仍接收后续 usage 和 [DONE]。 |
| PB-04 | 拒绝与 content_filter 在跨协议转换中明确报错，不再输出空的正常完成；未完成工具不发布可执行的最终完成。 |
| PB-05 | 完整的空 Anthropic 工具输入转换为 {}；已有输入和后续参数片段保留。 |
| PB-06 | 背压等待在 drain、close、error 任意路径清除其他监听器。 |
| PB-07 | 共用有界 UTF-8 SSE 解析器，支持 LF、CRLF、单独 CR、跨读边界 CRLF、多行 data、注释与截断检测。协议终止后的同批字节丢弃。 |
| H1 / H2 | OpenCode 按版本读取目录，导入前拒绝同 ID 异内容，导入后校验目录、身份和内容；不再依赖 Imported session 英文输出。比较忽略导入生成的 projectID 和 time.updated，同时保留正文、角色和其他原生语义。Windows 路径按统一规则比较。 |
| H3 | 显式可信版本优先，其次安装清单和专属会话表；共享 credential 表不再被当作 v2 标记。歧义或未知的已安装 CLI 拒绝猜测。v1 使用公开 export 命令，v2 使用 session export --standalone。账户读取与 OAuth 导入也遵守此分类。 |
| H4 | Codex 只共享生命周期确认完成的回合，中断或仍进行中的回合只留在原生记录/预览；没有生命周期标记的旧格式保持兼容。 |
| H5 | 整步预检索引后才删除或恢复记录；并发名称替换不被覆盖。中途失败写入操作进度，界面区分删除未完成和恢复未完成；重启后完成恢复的记录不会再被旧 deleted 标记隐藏。 |
| KIMI-01 | 模型级地址/密钥/协议优先级按原生行为解析，模型仅有密钥也能发现；同主机不同路径/密钥的模型拥有独立路由身份，密钥不进入公开模型字段。任意 overrides 元数据不提升为路由覆盖。OAuth 地址变化拒绝发送授权。 |
| OAUTH-R1 | Pi 切换与恢复使用原生兼容 auth.json.lock 目录锁。先获取锁，再重新校验确认快照和凭据；其他客户端的锁不抢占、不删除。切换入口只接受已识别 0.99.x 安装的锁协议，未知版本需要先配置受支持的安装目录。 |
| PB-C1 | 配置边界拒绝 API Key 控制字符，Harness 错误返回及日志对供应商密钥和本地令牌脱敏。 |
| PB-C2 | 重复的完整工具名称继续兼容；无法安全确定的变化/分段工具名称明确失败，避免向客户端提交错误工具身份。 |
| WIN-01 | 当前基线已经有真实 COM 属性读取和 8.3 路径归一化修复；本轮全量 Windows 测试覆盖并通过。 |

OpenCode v1 的消息读取还修复了按时间排序导致缺少时间戳的新消息重排的问题，改为与原生消息 ID 的顺序一致。未新增 Pi→OpenCode OAuth 导入或 OpenCode OAuth History 切换能力，现有能力边界继续保留。

## 验证结果与边界

- 全量 Windows 测试：747/747 通过；前端生产构建通过。测试和 QA 工具仍在开发目录，生产文件白名单继续排除 tests、scripts/native-contract、docs 和复现资料。本轮未重新发布安装包。
- OpenCode 1.18.33 与 2.0.20：真实原生 CLI + 当前 Electron 回调通过重复续聊、删除恢复、重启后可见性、独立入口无 package.json 的专属表分类/公开导出命令，以及原始 4 条消息→Pi 追加 2 条→归回 6 条→关闭同步和清理投影。
- Pi 0.99.1：真实 FileAuthStorageBackend 持锁期间 ASS 切换被阻止；释放后可切换并被原生读取；其他供应商保留。使用合成凭据，不声称验证了真实 OAuth 刷新、模型执行或 0.99.2 刷新链路。
- Kimi 2.1.1：原生真实请求和 ASS 的实际 URL、wire model、Authorization 对照通过，覆盖供应商声明、模型地址与密钥覆盖、仅模型密钥和同主机两条独立内联路由。
- 本机只有固定版本。OpenCode 1.18.34、2.0.21 和 Pi 0.99.2 的原生验证标为 blocked，不能算通过；未重复下载客户端。原生入口新增 --latest，明确使用报告列出的固定 latest 版本，同时记录安装清单和启动文件 SHA-256；不自动下载或使用浮动版本。
- 附件中的归档 OAuth 复现脚本没有执行。复现、日志及全部原生 HOME 位于独立验证目录，未访问或改写真实登录目录、用户会话或运行中的安装版 ASS。

本机证据：C:/Users/a8789/AppData/Local/ASS-validation/round2-20261001-161250。主日志：verified.log、build.log、native-six-turns.log、native-fixed.log、latest-availability.log。真实原生轮次的完整产物路径写在各 native 日志结尾。

SSE 行结束和 data 字段解析依据：[WHATWG HTML Server-sent events](https://html.spec.whatwg.org/multipage/server-sent-events.html#parsing-an-event-stream)。本实现还增加了 AI 协议的 JSON 校验、事件大小限制与显式失败处理。
