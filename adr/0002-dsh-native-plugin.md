# ADR-0002: 从跨工具 MCP server 改造为 DSH 原生工具插件

- 状态: **已接受 (Accepted)** — 2026-08-11
- 日期: 2026-08-11
- 决策人: 本人（个人项目）
- 取代: [0001-cross-tool-vision-mcp-auto-apikey.md](0001-cross-tool-vision-mcp-auto-apikey.md)（该决策整体不再适用）
- 关联: `mimo-vision`（本仓库即该包的源码）

---

> **修订 (2026-08)**:本 ADR 第 4 条「移除图片预处理」已部分回退——提交 `6d3c3b8` / `78cf1ce` 重新加入了非原生格式（SVG/TIFF/HEIC/…）经 ImageMagick（`ctx.subprocess` 接缝）转 PNG 的能力（见 `src/transcode.ts` 与 README「自动转码」）。当前为三层格式策略：原生直发 / 非原生转码 / 明确拒绝；第 4 条关于"移除缩放压缩"的结论不再完全适用。

## 背景 (Context)

mimo-vision 原是一个跨工具视觉 MCP server（Python 标准库、stdio + JSON-RPC），把图片发给 mimo-v2.5 系多模态模型、把文字描述返回给主模型。目标工具链已从"多个 agent 工具"收敛到 **DeepSeek Harness（DSH）**，且 DSH 本身就是"一切皆插件、注册即效果"范式（Cordis）的生产级落地。

继续维护一个独立进程的 MCP server 与 DSH 的插件体系脱节：key 发现手写解析 DSH 凭据文件、无会话概念、无法热卸载、无法复用 DSH 的沙箱/文件/凭据能力接缝。因此把本项目改造为 **DSH 原生工具插件**，忠实落实论文的"可逆效果 + 响应式余效果"：注册是效果（卸载即反注册）、`inject` 声明依赖（credentials/fs 接缝）、文件读取走能力接缝（`ctx.fs`）。

## 决策 (Decision)

### 1. 形态：原生 TypeScript 工具插件
- 包名 `mimo-vision`，函数插件导出 `name`/`inject`/`Config`/`apply`（无 default export，保留 Loader 注入元数据）。
- `apply` 里用 `ctx.tools.register(defineTool({...}))` 注册唯一工具 `describe_image(path, question?)`；`register()` 返回的 disposer 使插件卸载自动反注册（HMR 安全）。
- 工具契约：`parameters` 声明 schema（模型可见、自动校验）、`output.schema = { type: 'string' }` 声明规范值、`output.render` 投影模型文本、`execute` 只返回规范字符串、throw 即 `isError`。

### 2. key 发现：只走 `ctx.credentials` 接缝，只发现 DSH 的 opencode key
- `inject: ['tools', 'fs', 'credentials']`；执行时 `ctx.credentials.resolve(credentialRef(...))` 按 `OPENCODE_GO_API_KEY` → `OPENCODE_API_KEY` 顺序取第一个非空。
- **移除**所有手写 key 解析：不再读 `~/.dsh/.credentials.yaml` 的扁平 YAML、不再读 `~/.local/share/opencode/auth.json`、不再有自定义 env 优先级（DSH 凭据接缝自身已含 env > 文件 > .env 分层）。

### 3. 线路：免费 → 付费回退
- 免费线路 `https://opencode.ai/zen/v1` + `mimo-v2.5-free` 优先；失败（任意非 2xx / 超时）按请求回退付费 `https://opencode.ai/zen/go/v1` + `mimo-v2.5` 一次。
- 两条线路均 401 时返回"key 被拒"的可操作提示，不再换源。

### 4. 移除图片预处理
- 原 ImageMagick 缩放/压缩（`-resize`/`-quality`/`-strip`）整体移除；原图经 `ctx.fs.readBytes` 读取后 base64 直发。
- 读图加 20 MiB 硬上限（超出即 `FS_TOO_LARGE`），防内存/请求过大。

### 5. 极简 Config（Schemastery，从 cordis.patch.yml 传入）
- 仅 `allowPaid`（默认 true）+ `freeBaseUrl`/`freeModel`/`paidBaseUrl`/`paidModel`（均有默认值，可覆写）。
- key 名固定、不暴露为配置；移除 `MIMO_VISION_BASE_URL`/`MIMO_VISION_MODEL`/`MIMO_VISION_ALLOW_PAID` 等环境变量。

### 6. 文件读取走能力接缝 `ctx.fs`
- 用 `ctx.fs.resolve`（相对路径按会话 workspace cwd 解析）+ `ctx.fs.stat`（非普通文件拒绝）+ `ctx.fs.readBytes`；成功后 `ctx.emit('fs/observed', target, {kind:'present', version}, exec)`。
- 这样在远端沙箱/自定义 fs provider 下，`describe_image` 与 `read`/`read_image` 看到同一执行世界。

### 7. 删除 Python 实现
- 删除 `vision_server.py`、`pyproject.toml`、Python `tests/`；仓库整体成为可丢进 `packages/vision/tool-vision` 的插件包。

## 后果 (Consequences)

正面：
- 与 DSH 同构：注册/卸载可逆、依赖经接缝注入、文件访问随沙箱走；
- key 发现复用 DSH 凭据分层，改 key 无需重启（每请求 `resolve`）；
- 工具 schema 自动进 system-prompt 组装，UI 卡片经 `presentCall` 声明。

负面 / 风险：
- 需放进 DSH monorepo 才能 `pnpm install`/typecheck/build/test（`@deepseek-ai/dsh-*` 未发布 npm）；
- 移除预处理后大图 token 成本上升（20 MiB 上限兜底）；
- 依赖 `ctx.fs`/`ctx.credentials` 接缝存在（base bundle 均提供，headless 精简组装需自行挂载）。

## 备选方案 (Alternatives)

- **A. MCP 桥接**（保留 Python，用 dsh 的 `mcp-client` 挂载）：改动最小，但不体现"一切皆插件/接缝注入"，被否。
- **B. 混合壳**（TS 插件 shell 出到 Python）：保留零依赖 Python，但引入进程边界、与 dsh 接缝脱节，被否。
- **C. 保留 ImageMagick 预处理**：改为 `ctx.subprocess` 接缝可实现，但违背"移除额外属性"，且引入子进程复杂度，被否（必要时可作为独立插件/`tools/execute` 包装器另加）。

## 参考 (References)

- [DSH 源码导读](../../dsh/doc/DEEPSEEK-HARNESS-OVERVIEW.md)（工具契约、能力接缝、注册即效果）
- 参考实现：`packages/todo/tool-todo`（工具插件形态）、`packages/fs/tool-fs`（`ctx.fs` 读文件与 `read_image` 工具）
