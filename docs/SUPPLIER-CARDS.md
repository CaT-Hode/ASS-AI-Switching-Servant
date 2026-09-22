# 供应商卡片：额度、图标与排序

## 额度来源

| 来源 | 只读接口 / 官方依据 | 卡片含义 |
| --- | --- | --- |
| OpenAI / ChatGPT OAuth | [Codex 账户接口](https://learn.chatgpt.com/docs/app-server#auth-endpoints)、[Codex 客户端实现](https://github.com/openai/codex/blob/main/codex-rs/backend-client/src/client/rate_limit_resets.rs) | `GET https://chatgpt.com/backend-api/wham/usage`；Codex 额度剩余百分比，不是 Platform API 余额 |
| Anthropic / Claude OAuth | [Claude 状态栏字段](https://code.claude.com/docs/en/statusline)；原生客户端兼容接口 `GET https://api.anthropic.com/api/oauth/usage` | `five_hour` / `seven_day` 的已用比例换算为剩余比例 |
| DeepSeek API | [余额接口](https://api-docs.deepseek.com/api/get-user-balance/) | `total_balance`，按 CNY / USD 分开，不混加、不额外加上赠金 |
| OpenCode Go API | [官方 usage 路由](https://github.com/anomalyco/opencode/blob/dev/packages/console/app/src/routes/zen/go/v1/usage.ts) | 滚动 / 周 / 月窗口剩余比例，不推断 Zen 充值余额 |
| OpenRouter API | [当前 Key 接口](https://openrouter.ai/docs/api/api-reference/api-keys/get-current-api-key) | 当前 Key 剩余额度，不等同于整个账户的现金余额 |
| 其他支持余额的 API | 已配置的余额适配器 | 仅向当前供应商同源 GET；单位及含义取自适配器，不把套餐百分比当现金 |

OpenAI 与 Claude 的 OAuth HTTP 路径属于原生客户端兼容接口，不是对第三方承诺长期稳定的公开 Platform API。401 / 403 会显示权限错误；ASS 不自动刷新令牌、不回退到第三方、不提交付费模型请求、不消耗重置券。Claude 状态栏文档确认的是字段含义，不是对这个 HTTP 路径的公共支持承诺。

OpenAI `used_percent` / `usedPercent` 表示已用，剩余为 `clamp(100 - used, 0, 100)`。优先使用 `rateLimitsByLimitId.codex`；直接 HTTP 响应取 `rate_limit`。窗口依据真实持续时间标注：18000 秒为 5h，604800 秒为周，其他持续时间保留实际值；没有窗口就不显示，绝不补零。只展示 Codex 额度，不混入其他模型专属额度、购买 credits 或重置券。重置时间按设备本地时区显示。

查询读取所选账户自身的原生授权文件，覆盖 Codex、Claude、OpenCode、pi、DSH 中兼容的 OpenAI / Anthropic OAuth 格式。ChatGPT 显式工作区 ID 优先于令牌声明；请求带账户头，响应返回不同账户 ID 时拒绝采用。原生登录与 ASS 独立账户各自缓存，展示账户选择不切换客户端登录。

已适配的官方资料用 Windows safeStorage 加密保存；缓存绑定账户 / 凭据 / 接口，切换或更换凭据不沿用旧账户数据。自动查询合并正在进行的请求并限频至每 5 分钟，失败也限频；手动刷新可立即查询。失败保留上次成功值及原更新时间并标出警告，绝不把上次值冒充本次成功。通用余额适配器沿用运行期缓存，重开页面重新查询。

## 图标与排序

图标来自 [Lobe Icons](https://github.com/lobehub/lobe-icons) 的 `@lobehub/icons-static-svg@1.95.1`，21 个自包含 SVG 随包分发，MIT 许可见 [LICENSE](../public/providers/LICENSE.txt)。供应商商标归各自权利人，展示不代表隶属或背书。不会向第三方 favicon 服务发送供应商地址或凭据。

已知官方 API 服务优先匹配；名称匹配仅采用明确品牌词。中转站出售 GPT / Claude 模型不代表它是 OpenAI / Anthropic，不能据模型名称套用官方 logo；没有匹配时使用文字头像。

排序保存在 `preferences.json`。拖动只从专用手柄开始，释放到目标卡片后提交；Esc、失焦或无有效目标取消。方向键也可排序，筛选时保持隐藏来源的位置。磁盘保存失败显示提示并保留旧序；新来源追加，删除的来源不会因旧排序复活。减少动态效果模式不添加弹性或惯性。

## 连接测试记录

`diagnostics.enc.json` 用 Windows safeStorage 加密，按供应商 + 模型保存最后一次完成的成功 / 失败结果、完整 ISO 时间和耗时；不保存原始响应、Key 或令牌。界面相对时间由本地共享时钟更新，不为时间显示发送模型请求。

显示名称、上下文标注等非连接字段不清除记录；供应商地址、网络、认证头 / Key、模型 ID、协议或实际思维配置变化则失效。官方账户刷新令牌但身份未变时可保留；换账户不继承测试。取消不覆盖旧结果，首次取消不算完成；记录保存失败会明确标注。损坏的历史不会阻止应用启动。

v0.1.13 及更早版本只在进程内存中保留连接测试记录。升级后需要重新测试一次；不能恢复已退出的旧版进程记录。
