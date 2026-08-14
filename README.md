# mimo-vision · DSH 原生视觉插件

**mimo-vision** 是一个 **DeepSeek Harness（DSH）原生插件**，包名 `@deepseek-ai/dsh-tool-vision`。它注册一个 `describe_image` 工具：把图片发给 mimo-v2.5 系多模态模型，把返回的**文字描述**交给主模型——专为主模型（如 `deepseek-v4-flash`）没有视觉输入能力的场景做的"视觉桥"。

它不是独立进程，而是 DSH 里"一切皆插件"的一等公民：`apply` 只有一个动作——把能力注册成 dsh 的一等公民工具，依赖、文件、凭据、子进程全部走 dsh 已定义的能力接缝，卸载即干净回收。

### 实现范式：DSH 原生插件原语的直接落地

- **注册即可逆效果**：`apply(ctx)` 里只有一句 `ctx.tools.register(defineTool(...))`。`register()` 返回 disposer，插件纤程 dispose 即反注册工具、schema 自动撤出 system-prompt。没有任何残留清理代码——卸载干净是**结构保证**，而非靠开发者手写清理。
- **`inject` 声明依赖**：`export const inject = ['tools', 'fs', 'credentials']`，走纯 Cordis 余效果规范，等接缝就位才激活。`transcode.ts` 里的 `ctx.get('subprocess')` 是可选能力、带缺省降级，用在执行期而非激活期。整套是「声明依赖」，不是「探测依赖」。
- **能力全部走 dsh 接缝**：文件读走 `ctx.fs.resolve/stat/readBytes` + `ctx.emit('fs/observed')`，凭据走 `ctx.credentials.resolve(credentialRef(...))` 且不手写解析，子进程（转码）走 `ctx.subprocess`。唯一例外：转码的临时中间文件经 `node:fs` 写入系统临时目录（见下方 Known Limitations）。
- **可卸载 / 可组合**：卸载是纯粹的——disposer 一跑即干净回收，无落盘、无 timer、无长连接需要手动收尾。

## 工具

| 工具 | 参数 | 说明 |
|---|---|---|
| `describe_image` | `path`（必填）、`question`（可选） | 描述图片文件，返回文字 |

支持图片格式：

- **原生直发**：PNG / JPEG / GIF / WebP / BMP（均已实测可被视觉模型解码）
- **自动转码**：SVG / TIFF / HEIC / PSD / ICO / EXR / JP2 / JXL / AVIF——本机装有 ImageMagick 时自动转成 PNG 再发，并缩到长边 ≤2048px（省 token）
- 其它扩展名、或转码格式未装 ImageMagick 时，直接返回明确报错（不静默发送）

用法示例（对模型说）：`用 describe_image 描述 D:\photos\cat.png，重点看它是什么品种的猫`。

## 工作原理

1. **key 解析**：`ctx.credentials.resolve` 按 `OPENCODE_GO_API_KEY` → `OPENCODE_API_KEY` 取第一个非空（DSH 凭据分层：进程 env > `~/.dsh/.credentials.yaml` > `.env`）。
2. **读图**：`ctx.fs.resolve`（相对路径按会话 workspace cwd 解析）→ `ctx.fs.readBytes`（20 MiB 上限）；非原生格式（SVG/TIFF/HEIC…）经 ImageMagick（走 `ctx.subprocess` 接缝）转成 PNG 并缩到长边 2048px → base64。
3. **线路**：免费 Zen（`mimo-v2.5-free`）优先；失败（非 2xx / 超时）每请求回退付费 Go（`mimo-v2.5`）一次；`allowPaid: false` 禁用付费兜底。

设计决策见 [adr/0002-dsh-native-plugin.md](adr/0002-dsh-native-plugin.md)（取代了此前的 MCP 方案 ADR-0001）。

---

## 快速安装（npm 安装的 DSH，推荐）

> 适用于 `npx @deepseek-ai/dsh web` 或全局安装的 DSH。仓库已附**预构建产物**（`lib/index.js`），无需安装任何构建工具链。

**前置**：Node `^22.19 || >=24`，DSH 已能正常启动。

### 第 0 步 · 安装并激活（一条命令）

mimo-vision 声明了 `dsh.bundle`（见 `package.json` 的 `dsh` 字段），所以 `dsh plugin add` 会把它 reconcile 成 profile 的一个 bundle 层，**装包、挂层、激活工具一次完成**：

```bash
dsh plugin --profile web add github:wulusai2333/mimo-vision
```

> 若仓库不在默认分支，用 `github:wulusai2333/mimo-vision#<branch-or-tag>`。
> 该路径依赖 DSH 在 `~/.dsh/profiles/node_modules` 维护的**依赖闭包**（把全部 `@deepseek-ai/*` 接缝 symlink 到 dsh 安装树），所以插件的运行时 `import "@deepseek-ai/dsh-tools"` 等会解析到**与 DSH 同一份实例**——单例安全、`register()`/`inject` 语义不变。
> GitHub 源安装的前提是本仓库**提交了预构建 `lib/`**（与 `src/` 同步）：pnpm 装的是带 `lib/` 的源码，不触发构建、也无需 `allowBuilds`。

<details>
<summary>离线 / 从源码手动挂载（没有 pnpm 时的备用路径）</summary>

手动把产物放进 profile 的插件解析根，再在 profile 的 `cordis.patch.yml` 里挂 patch（等价于 bundle 自动挂载，但需手动两步）：

```powershell
# Windows PowerShell
$dst = "$env:USERPROFILE\.dsh\profiles\node_modules\@deepseek-ai\dsh-tool-vision"
New-Item -ItemType Directory -Path $dst -Force | Out-Null
Copy-Item package.json -Destination $dst -Force
Copy-Item cordis.patch.yml -Destination $dst -Force
Copy-Item lib -Destination $dst -Recurse -Force
```

```bash
# macOS / Linux
dst="$HOME/.dsh/profiles/node_modules/@deepseek-ai/dsh-tool-vision"
mkdir -p "$dst"
cp package.json "$dst/"
cp cordis.patch.yml "$dst/"
cp -r lib "$dst/"
```

再编辑 `~/.dsh/profiles/web/cordis.patch.yml`，加入：

```yaml
- insert:
    - id: tool-vision
      name: '@deepseek-ai/dsh-tool-vision'
      config:
        allowPaid: true
```

</details>

### 第 1 步 · 配置 key

在 `~/.dsh/.credentials.yaml` 里给一个 opencode key（`OPENCODE_GO_API_KEY` 优先，`OPENCODE_API_KEY` 兜底）：

```yaml
OPENCODE_GO_API_KEY: sk-...
```

> 也可以放在启动 DSH 的进程环境变量里（`OPENCODE_GO_API_KEY=... dsh web`）。凭据接缝的分层优先级：进程 env > `.credentials.yaml` > `.env`。

### 第 2 步 · 重启并验证

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

> 上述 2/3 步也可在包内用 `pnpm run test` / `pnpm run typecheck` / `pnpm run build` 执行（脚本已写入 `package.json`）。

> 说明：`@deepseek-ai/dsh-*` 内部包未发布 npm，因此插件不能 `npm install` 独立安装；要么用上面"快速安装"的预构建产物，要么放进 monorepo 从源码跑。

## 失败语义

任何失败（无 key、非支持格式、双线路失败、文件不存在 / 非普通文件、超限、非图片响应）都以**工具级错误**返回：`execute` throw，注册表物化为 `isError`，进程不退出、会话不断。

## Known Limitations

- **转码临时文件越过 `ctx.fs` 沙箱**：SVG/TIFF/HEIC 等非原生格式经 ImageMagick 转码时，源字节与产物 PNG 通过 `node:fs` 写入系统临时目录（`os.tmpdir()`），因为 `ctx.subprocess` 需要真实 OS 路径喂给本机 `magick`，而 `ctx.fs` 的 `FsTarget` 可能是抽象/远端/沙箱路径。这绕过了 `dsh-fs-sandbox` 的文件沙箱策略；临时目录在转换后立即删除。仅当本机装有 ImageMagick 且请求了转码格式时触发，原生格式（PNG/JPEG/GIF/WebP/BMP）不经过此路径。
- **预构建 `lib/` 需与 `src/` 同步**：GitHub 源安装直接加载仓库里提交的 `lib/index.js`，不会在安装时构建。改 `src/` 后必须重建并提交 `lib/`，否则线上加载到旧产物。

## 安全

- key 仅经 `ctx.credentials.resolve` 读取，不打印、不写盘、不扫描目录；
- key 仅用于请求头 `Authorization: Bearer ...`；
- 图片经 `ctx.fs` 读入内存后即 base64 直发，不落盘（非原生格式转码时经系统临时目录中转，转换后即删）。

## License

MIT
