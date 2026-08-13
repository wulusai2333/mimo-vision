# ADR-0001: 泛用视觉 MCP —— API Key 自动发现 + 免费线路优先

- 状态: **已接受 (Accepted)** — 2026-08-11 评审通过
- 日期: 2026-08-11
- 修订: 2026（DSH 凭据优先，见"评审细化"第 6 条）
- 决策人: 本人（个人项目）
- 关联: 自研 mimo-vision MCP（`vision_server.py`）

---

## 背景 (Context)

主模型 `deepseek-v4-flash` 无视觉输入能力，需要一个"视觉桥"：把图片发给多模态模型（mimo-v2.5 系），把返回的文字描述交给主模型。

现状问题：
1. **绑定单一工具与单一系统**：现有 `vision_server.py` 跑在 WSL，API key 只从 WSL 的 `~/.claude/settings.json` 读取；而 Windows 上的 Codex 已经配好 opencode-go（key 在 `~/.codex/auth.json`），却无法被自动复用。
2. **默认走付费线路**：现有实现固定走 Go 套餐线路（`https://opencode.ai/zen/go/v1` + `mimo-v2.5`，计费 $0.14/$0.28 per M）；已验证存在**免费** Zen 线路（`https://opencode.ai/zen/v1` + `mimo-v2.5-free`，200K context）可用。
3. **迁移成本高**：换工具（Codex ↔ Claude Code ↔ opencode）或换系统（Windows ↔ WSL ↔ macOS ↔ Linux）都需要改代码/改配置。

目标：
- 自动获取**当前工具**（DSH / opencode）已配置的 API key，零手工配置；
- **免费线路优先、付费兜底**，降低成本；
- 同一份代码跨工具、跨系统**无需修改**即可运行。

---

## 决策 (Decision)

### 1. 架构不变：保留 MCP server
- stdio + JSON-RPC 2.0，工具 `describe_image(path, question?)`（协议/工具名不变，现有 Codex `config.toml` 注册无需改动）。
- 运行时：**Python 3 标准库、零第三方依赖**（Windows / WSL / macOS / Linux 通用）。

### 2. API Key 自动发现（按优先级，第一个命中即用）
> 规则：只读指定文件、绝不打印/写盘/上传 key；解析失败（JSON 坏/文件不存在）静默跳过到下一来源。

1. **环境变量**（显式覆盖，最通用）：
   `OPENCODE_API_KEY` > `OPENCODE_GO_API_KEY`
2. **DSH**：`<home>/.dsh/.credentials.yaml`
   - 取值顺序：`OPENCODE_GO_API_KEY` → `OPENCODE_API_KEY`（DSH 命名优先，官方 env 名兜底）。
   - 解析：扁平 `KEY: value`（YAML 子集）逐行解析，容忍空白/注释/简单引号；文件缺失或不可读时静默跳过。
3. **opencode**：`<home>/.local/share/opencode/auth.json`
   - 取值：仅预期 provider 名 `opencode-go` → `opencode_go`（不取无关 provider 的 key）。
4. **全未命中**：返回明确错误提示（告知如何设置），不崩溃。

`<home>` 一律用平台无关解析（`os.path.expanduser`），Windows 即 `%USERPROFILE%`，Unix 即 `~`，**不硬编码 WSL/Windows 路径**。

### 3. 线路/模型优先级（可被环境变量覆盖）
| 优先级 | 线路 | Base URL | 模型 | context | 成本 |
|---|---|---|---|---|---|
| 1（默认） | Zen 免费 | `https://opencode.ai/zen/v1` | `mimo-v2.5-free` | 200K | 免费（已验证可用） |
| 2（回退） | Go 套餐 | `https://opencode.ai/zen/go/v1` | `mimo-v2.5` | 1M | 计费 $0.14/$0.28（已验证可用） |

- 回退触发：免费线路请求失败/超时/任意 HTTP 4xx/5xx（含 400 参数错、429 限流），每请求最多重试 1 次。
- 成本开关：`MIMO_VISION_ALLOW_PAID`（默认 true；设 false 时禁用付费线路、失败即报错）。
- 显式覆盖：环境变量 `MIMO_VISION_BASE_URL` / `MIMO_VISION_MODEL`（跳过自动线路选择）。

### 4. 图片预处理（保留现状）
- 可选 ImageMagick `convert`：长边 ≤2048px、JPEG q85、`-strip`；缺失时原图直发。
- 保持 Cloudflare 浏览器 UA 处理。

### 5. 可移植性约束
- 运行时文件与配置分离；路径全部平台无关解析；
- 不做任何平台专属调用（不依赖 wsl.exe、不依赖 Git bash）。

## 评审细化 (Review Refinements, 2026-08-11)

grill-with-docs 评审通过后，对上述决策的补充约定：

1. **key 源匹配策略**：只匹配预期 provider 名（opencode 源限 `opencode-go` / `opencode_go`，不取无关 provider 的 key）；DSH 源限 `OPENCODE_GO_API_KEY` / `OPENCODE_API_KEY` 且按此顺序；选定 key 在两条线路均返回 401 时直接返回可操作错误，不自动换源。
2. **线路回退语义**：每请求级回退，同一请求最多重试 1 次；回退触发含 400/429；成本开关 `MIMO_VISION_ALLOW_PAID` 默认 true。
3. **图片预处理探测**：优先 `magick`（IM v7）；`convert`（v6）仅在解析路径不是 `System32\convert.exe`（NTFS 工具误报）时采用；缺失时原图直发。本机已装 ImageMagick 7.1.2（`magick.exe`）。备选的 PowerShell+GDI+ 预处理因违背"不做平台专属调用"约束被否决。
4. **失败行为契约**：`describe_image` 任何失败统一返回工具级错误 `{isError: true, content:[{type:"text", text:"可操作提示"}]}`，进程不退出、stdio 连接不断。
5. **配置形态（混合）**：显式 env（`OPENCODE_API_KEY` 等 + `MIMO_VISION_BASE_URL`/`MIMO_VISION_MODEL`）为最高优先级，即约定俗成的客户端配置方式；自动发现仅作零配置兜底；README 同时给出两种模式。
6. **DSH 优先（修订）**：自动发现把 `<home>/.dsh/.credentials.yaml` 排在最前（env 仍最高优先级），优先取 `OPENCODE_GO_API_KEY`，其次 `OPENCODE_API_KEY`。两者都是可发往 Zen 线路的 key，不再读取 `DEEPSEEK_API_KEY` 等其他 key；解析用扁平 `KEY: value`（YAML 子集）阅读器，仅读该文件、路径统一 `expanduser`。路由/线路选择逻辑不变。
7. **env 白名单（修订）**：环境变量仅接受 `OPENCODE_API_KEY` / `OPENCODE_GO_API_KEY`（分别对应 opencode 官方约定与 DSH 凭据字段），不再读取 `MIMO_VISION_API_KEY` / `VISION_API_KEY` / `OPENAI_API_KEY` / `ANTHROPIC_API_KEY`，避免把其他工具的通用 key 误发给 opencode Zen 线路。
8. **自动发现源收窄（修订）**：自动发现仅保留 DSH 与 opencode 两个源，删除 Codex `~/.codex/auth.json` 与 Claude Code `~/.claude/settings.json` 及对应解析器；opencode 源只匹配 `opencode-go` / `opencode_go` provider，DSH 源只匹配 `OPENCODE_GO_API_KEY` / `OPENCODE_API_KEY`，其余 key 一律忽略。

---

## 后果 (Consequences)

正面：
- **零配置**：自动复用 DSH 凭据（opencode-go 优先）或 opencode 的 key，开箱即用；
- **省钱**：默认免费线路，付费仅作兜底；
- **泛用**：同一份代码在 DSH / opencode、Windows / WSL / macOS / Linux 免改；
- 工具协议不变，现有注册/调用方无感升级。

负面 / 风险：
- 多 key 来源的优先级需要文档化，避免不同工具并存时的歧义；
- 各工具 `auth.json` / `settings.json` 结构差异需容错解析（任何解析异常跳过该来源）；
- 免费线路有速率与上下文限制（200K），高负载场景可能触发回退到付费线路；
- 自动读取多个 key 文件需恪守最小权限：只读列出的指定文件，不扫描目录、不读取无关文件。

---

## 备选方案 (Alternatives)

- **A. 直接用 Neostry/vision-skill（node skill）**：放弃。非 MCP（Agent 读指令+跑脚本，不如工具调用稳）；无图片压缩；Windows 端 key 自动发现弱（实测找不到 key，需手工设环境变量）。
- **B. 固定付费 Go 线路**：放弃。存在已验证可用的免费线路，成本更高。
- **C. 手工把 key 写进配置/环境变量**：放弃。违背"迁移零配置"目标，换工具/换机仍要手工操作。
- **D. 只依赖 opencode 的 auth.json（不含 DSH）**：放弃。DSH 凭据是本机最常命中的来源，先读 DSH 可零配置复用 opencode-go key。

---

## 参考 (References)

- opencode Zen 免费线路：`https://opencode.ai/zen/v1`（mimo-v2.5-free，200K context，opencode-go key 已验证可直接访问）
- opencode Go 套餐：`https://opencode.ai/zen/go/v1`（mimo-v2.5，text+image，1M context，$0.14/$0.28 per M，pi.dev 模型页确认）
- Neostry/vision-skill（社区对照实现，MIT）：https://github.com/Neostry/vision-skill
- 现有自研服务器：WSL `~/.claude/mcp-vision/vision_server.py`
