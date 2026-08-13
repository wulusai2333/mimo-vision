# mimo-vision Context

跨工具视觉 MCP server 的领域语言：把图片发给多模态模型、把文字描述返回给主模型的"视觉桥"。

## Language

**线路 (route)**:
一组 `(base_url, model)` 组合，对应 opencode.ai 的一个可用端点。
_Avoid_: endpoint、通道、上游

**免费线路 (free route)**:
默认线路：`https://opencode.ai/zen/v1` + `mimo-v2.5-free`（200K 上下文，免费）。

**付费线路 (paid route)**:
兜底线路：`https://opencode.ai/zen/go/v1` + `mimo-v2.5`（1M 上下文，按量计费）。

**key 源 (key source)**:
一个可提供 API key 的位置——环境变量或某个工具（DSH / opencode）的 auth 文件。
_Avoid_: 凭据库、key 文件

**自动发现 (auto-discovery)**:
零配置模式：按固定优先级从各 key 源读取第一个非空 key 的机制。

**显式配置 (explicit config)**:
约定俗成模式：由用户在客户端配置的 `env` 里直接给出 `OPENCODE_API_KEY` / `MIMO_VISION_BASE_URL` / `MIMO_VISION_MODEL`。

**回退 (fallback)**:
免费线路请求失败后改发付费线路的重试动作；每请求最多 1 次。
_Avoid_: 重试（过于泛化，丢失线路语义）

**成本开关 (cost switch)**:
环境变量 `MIMO_VISION_ALLOW_PAID`；设 false 时禁用付费线路、失败即报错。

**工具级错误 (tool-level error)**:
`describe_image` 失败时的返回形态：`{isError: true, content:[{type:"text", ...}]}`，进程不退出、连接不断。

**describe_image**:
本 MCP server 暴露的唯一工具，签名 `(path, question?)`，协议保持稳定。
