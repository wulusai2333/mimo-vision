# mimo-vision · DSH 原生视觉插件

**mimo-vision** 是一个 **DeepSeek Harness（DSH）原生插件**，包名 `@deepseek-ai/dsh-tool-vision`。它注册一个 `describe_image` 工具：把图片发给 mimo-v2.5 系多模态模型，把返回的**文字描述**交给主模型——专为主模型（如 `deepseek-v4-flash`）没有视觉输入能力的场景做的"视觉桥"。

它不是独立进程，而是 DSH 里"一切皆插件"的一等公民：

- **注册即效果**：`describe_image` 经 `ctx.tools.register(defineTool(...))` 挂载，插件卸载自动反注册（热重载安全）。
- **能力走接缝**：key 发现走 `ctx.credentials`，文件读取走 `ctx.fs`（随沙箱 / 远端文件系统走）。
- **inject 声明依赖**：`inject: ['tools', 'fs', 'credentials']`，服务就位才激活。

## 工具

| 工具 | 参数 | 说明 |
|---|---|---|
| `describe_image` | `path`（必填）、`question`（可选） | 描述图片文件，返回文字 |

用法示例（对模型说）：`用 describe_image 描述 D:\photos\cat.png，重点看它是什么品种的猫`。

## 工作原理

1. **key 解析**：`ctx.credentials.resolve` 按 `OPENCODE_GO_API_KEY` → `OPENCODE_API_KEY` 取第一个非空（DSH 凭据分层：进程 env > `~/.dsh/.credentials.yaml` > `.env`）。
2. **读图**：`ctx.fs.resolve`（相对路径按会话 workspace cwd 解析）→ `ctx.fs.readBytes`（20 MiB 上限）→ base64。
3. **线路**：免费 Zen（`mimo-v2.5-free`）优先；失败（非 2xx / 超时）每请求回退付费 Go（`mimo-v2.5`）一次；`allowPaid: false` 禁用付费兜底。

设计决策见 [adr/0002-dsh-native-plugin.md](adr/0002-dsh-native-plugin.md)（取代了此前的 MCP 方案 ADR-0001）。

---

## 快速安装（npm 安装的 DSH，推荐）

> 适用于 `npx @deepseek-ai/dsh web` 或全局安装的 DSH。仓库已附**预构建产物**（`lib/index.js`），无需安装任何构建工具链。

**前置**：Node `^22.19 || >=24`，DSH 已能正常启动。

### 第 1 步 · 放入插件

把本仓库的 `package.json` 和 `lib/` 复制到 profile 的 node_modules：

<details>
<summary>Windows PowerShell</summary>

```powershell
$dst = "$env:USERPROFILE\.dsh\profiles\node_modules\@deepseek-ai\dsh-tool-vision"
New-Item -ItemType Directory -Path $dst -Force | Out-Null
Copy-Item package.json -Destination $dst -Force
Copy-Item lib -Destination $dst -Recurse -Force
```

</details>

<details>
<summary>macOS / Linux (bash)</summary>

```bash
dst="$HOME/.dsh/profiles/node_modules/@deepseek-ai/dsh-tool-vision"
mkdir -p "$dst"
cp package.json "$dst/"
cp -r lib "$dst/"
```

</details>

> 上面的路径是 profile 的**插件解析根**（`~/.dsh/profiles/node_modules`），DSH 的 loader 就是从这里按包名 `@deepseek-ai/dsh-tool-vision` 解析插件。

### 第 2 步 · 注册进组合

编辑 `~/.dsh/profiles/web/cordis.patch.yml`（用哪个 profile 就改哪个目录），加入：

```yaml
- insert:
    - id: tool-vision
      name: '@deepseek-ai/dsh-tool-vision'
      config:
        allowPaid: true
```

### 第 3 步 · 配置 key

在 `~/.dsh/.credentials.yaml` 里给一个 opencode key（`OPENCODE_GO_API_KEY` 优先，`OPENCODE_API_KEY` 兜底）：

```yaml
OPENCODE_GO_API_KEY: sk-...
```

> 也可以放在启动 DSH 的进程环境变量里（`OPENCODE_GO_API_KEY=... dsh web`）。凭据接缝的分层优先级：进程 env > `.credentials.yaml` > `.env`。

### 第 4 步 · 重启并验证

**首次接入需重启一次 DSH**（让进程把新包 `import` 进来）。之后改这个插件的代码或 `allowPaid` 等配置，才是"免重启热更新"。

重启后验证：在 DSH 设置里应能看到 `@deepseek-ai/dsh-tool-vision`，可用工具里出现 `describe_image`；也可以直接对模型说"用 describe_image 描述某张图"实测。

---

## 配置项（均可选，有默认值）

| 字段 | 默认 | 说明 |
|---|---|---|
| `allowPaid` | `true` | 是否允许免费线路失败后回退付费线路 |
| `freeBaseUrl` | `https://opencode.ai/zen/v1` | 免费线路 base URL |
| `freeModel` | `mimo-v2.5-free` | 免费线路模型 |
| `paidBaseUrl` | `https://opencode.ai/zen/go/v1` | 付费线路 base URL |
| `paidModel` | `mimo-v2.5` | 付费线路模型 |

最小注册只写 `allowPaid` 即可，其余用默认值：

```yaml
- insert:
    - id: tool-vision
      name: '@deepseek-ai/dsh-tool-vision'
      config:
        allowPaid: false
```

---

## 从源码构建 / 开发（DSH monorepo）

要改插件源码，把它放进 DSH 源码树，走仓库门禁：

```bash
# 1. 复制本仓库为 packages/vision/tool-vision
cp -r /path/to/mimo-vision <dsh>/deepseek-harness/packages/vision/tool-vision

# 2. 安装并验证（tsc 类型检查 + vitest 单测 + oxlint）
cd <dsh>/deepseek-harness
pnpm install
npx tsc -b packages/vision/tool-vision   # 类型检查
npx vitest run packages/vision/tool-vision   # 单测
npx oxlint packages/vision/tool-vision       # lint

# 3. 产出 lib/index.js（预构建产物）
cd packages/vision/tool-vision
npx tsdown lib/types/index.js lib/types/invariant.js \
  --out-dir lib --format esm --platform node --target es2024 --fixed-extension false
```

> 说明：`@deepseek-ai/dsh-*` 内部包未发布 npm，因此插件不能 `npm install` 独立安装；要么用上面"快速安装"的预构建产物，要么放进 monorepo 从源码跑。

## 失败语义

任何失败（无 key、双线路失败、文件不存在 / 非普通文件、超限、非图片响应）都以**工具级错误**返回：`execute` throw，注册表物化为 `isError`，进程不退出、会话不断。

## 安全

- key 仅经 `ctx.credentials.resolve` 读取，不打印、不写盘、不扫描目录；
- key 仅用于请求头 `Authorization: Bearer ...`；
- 图片经 `ctx.fs` 读入内存后即 base64 直发，不落盘。

## License

MIT
