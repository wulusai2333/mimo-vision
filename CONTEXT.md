# mimo-vision Context

DSH 原生工具插件的领域语言：把图片发给 mimo-v2.5 视觉模型、把文字描述返回给主模型的"视觉桥"。

## Language

**视觉桥 (vision bridge)**:
`describe_image` 工具的角色——读取图片、发往视觉模型、返回文字描述。
_Avoid_: 图像理解、看图

**线路 (route)**:
一组 `(baseUrl, model)`，对应 opencode Zen 表面的一个可用端点。
_Avoid_: endpoint、通道、上游

**免费线路 (free route)**:
默认线路：`https://opencode.ai/zen/v1` + `mimo-v2.5-free`。

**付费线路 (paid route)**:
兜底线路：`https://opencode.ai/zen/go/v1` + `mimo-v2.5`。

**回退 (fallback)**:
免费线路请求失败（任意非 2xx / 超时）后改发付费线路；每请求最多一次。
_Avoid_: 重试（丢失线路语义）

**成本开关 (cost switch)**:
Config 字段 `allowPaid`（默认 true）；false 时只走免费线路、失败即报错。

**key 接缝 (credentials seam)**:
`ctx.credentials` 服务；`resolve(ref)` 按 DSH 分层（env > `.credentials.yaml` > `.env`）取当前值。
_Avoid_: 凭据文件、key 解析

**key 引用 (credential reference)**:
`OPENCODE_GO_API_KEY`、`OPENCODE_API_KEY` 两个可寻址引用，按此顺序取第一个非空。

**文件接缝 (fs seam)**:
`ctx.fs` 服务；`resolve` / `stat` / `readBytes` 在沙箱与远端文件系统下提供统一读图。

**工具注册 (tool registration)**:
`ctx.tools.register(defineTool({...}))`；返回 disposer，插件卸载即反注册（可逆效果）。

**规范值 (canonical value)**:
`execute` 返回的 lossless-JSON 值，受 `output.schema` 校验；`describe_image` 的规范值是描述文本字符串。

**工具级错误 (tool-level error)**:
`execute` throw 任意 Error 即 `isError`，进程不退出、会话不断。

**会话日志 (session log)**:
模型所见上下文的唯一事实源；工具结果自动以 `tool/result` 入日志（模型可见 ⟺ 已入日志）。

**describe_image**:
本插件注册的唯一工具，签名 `(path, question?)`，协议保持稳定。

## Built-in paradigm（核心范式）

本插件是 DSH「一切皆插件」原语的直接落地——`apply` 只有一个动作：把能力注册成 dsh 的一等公民工具。依赖、文件、凭据、子进程全部走 dsh 已定义的能力接缝，卸载即干净回收。

- **注册即可逆 effect**：`apply` 仅 `ctx.tools.register(defineTool(...))`；派发即反注册、schema 自动撤出 system-prompt，卸载干净是**结构保证**而非手写清理。
- **`inject` 声明依赖**：`['tools','fs','credentials']` 纯 Cordis 余效果；`subprocess` 为可选能力、缺省降级、用在执行期。是「声明依赖」，不是「探测依赖」。
- **能力走接缝**：文件 `ctx.fs` + `fs/observed`，凭据 `ctx.credentials.resolve`（不手写解析），转码 `ctx.subprocess`；唯一例外是转码中间文件经 `node:fs` 写系统临时目录（`ctx.subprocess` 需真实 OS 路径、`ctx.fs` 是抽象目标），转换后即删。
- **可卸载 / 可组合**：disposer 一跑即干净回收，无落盘、无 timer、无长连接需手动收尾。
