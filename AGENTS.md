# Repository Guidelines

## Project Overview

mimo-vision 是一个 DSH 原生工具插件（`mimo-vision`），注册唯一工具 `describe_image(path, question?)`：把图片经 `ctx.fs` 读入、key 经 `ctx.credentials` 发现、发往 mimo-v2.5 视觉模型（免费线路优先、付费兜底）、返回文字描述。它体现 DSH 的核心范式：**一切皆插件、注册即效果、`inject` 声明依赖、能力走接缝**。

## Project Structure & Module Organization

```
mimo-vision/
├── src/
│   ├── index.ts     # 插件入口：name/inject/Config/apply + describe_image
│   ├── invariant.ts # 空 invariant 伴生（仓库测试门禁约定）
│   ├── key.ts       # 纯逻辑：OPENCODE_GO_API_KEY → OPENCODE_API_KEY 解析
│   ├── routes.ts    # 纯逻辑：免费→付费线路解析
│   ├── transcode.ts # 非原生格式经 ctx.subprocess→ImageMagick 转 PNG
│   ├── vision.ts    # HTTP 调用 + payload/提取（纯 helper 可单测）
│   └── types.ts     # 类型 only
├── lib/             # 提交的预构建产物（tsdown 输出），GitHub 源安装直接加载
├── tests/           # vitest（纯逻辑 + 真 Context 集成）
├── adr/             # ADR-0002 记录本改造决策
├── cordis.patch.yml # bundle patch（package.json 的 dsh.bundle 声明它，自动挂载）
├── package.json / tsconfig.json
└── CONTEXT.md / README.md / AGENTS.md
```

- 纯逻辑（`key.ts`/`routes.ts`/`vision.ts` 的 helper）**零 `@deepseek-ai/*` 运行时依赖**，可独立单测。
- 只有 `index.ts` 直接触碰接缝（`ctx.tools`/`ctx.fs`/`ctx.credentials`）；`transcode.ts` 经 `ctx.subprocess` 调 ImageMagick，但转码中间文件用 `node:fs` 写系统临时目录（见 README「Known Limitations」）。
- `lib/` 是**提交的预构建产物**（`lib/index.js` 即 loader 的 `main` 入口），供 GitHub 源安装直接加载；改 `src/` 后需按下方命令重建并同步 `lib/`。
- `package.json` 的 `peerDependencies` 用 `"*"`（**不用 `workspace:^`**）：全部 `@deepseek-ai/*` 接缝（含 `@deepseek-ai/schemastery`）由 DSH 的依赖闭包（`~/.dsh/profiles/node_modules` symlink 到 dsh 安装树）在运行时统一提供并保证单例。同时每个 peer 在 `peerDependenciesMeta` 里标记为 `optional`，避免 pnpm/npm 在 DSH 闭包之外独立安装时去 registry 解析未发布的内部包链而失败；**绝不要把 `@deepseek-ai/*` 挪进 `dependencies`**（`workspace:^` 在 profile 的独立 workspace 里无法解析、会导致安装失败，且会 pnpm 独立复制破坏单例接缝）。monorepo 内的 `devDependencies` 仍用 `workspace:^` 无妨。
- `cordis.patch.yml` 用 `- insert:` + `id: tool-vision`（对齐插件导出的 `name`），并由 `package.json` 的 `dsh.bundle` 字段声明。mimo-vision 是 **bundle**：`dsh plugin add github:...` 会自动 reconcile 成 profile 层并激活工具，无需手改 patch。

## Build, Test, and Development Commands

本包在 DSH monorepo 内开发；仓库根（`deepseek-harness`）未 `pnpm install` 前无法 typecheck/build。

- `pnpm run test` — vitest 跑 `tests/`。
- `pnpm run typecheck` — `tsc --build`（tsconfig 引用 vendor + dsh 包）。
- `pnpm run build` — 先 `tsc --build` 生成中间产物，再 tsdown 输出 `lib/`。

## Coding Style & Naming Conventions

- TypeScript，遵循 DSH 仓库纪律：函数插件 named-export `name`/`inject`/`Config`/`apply`，**无 default export**（否则 Loader 丢 `inject`）。
- 相对导入带显式 `.ts` 后缀（monorepo 约定）。
- `Config` 用 Schemastery 声明（`z.object`），tunable 一律走 config，不硬编码进 `execute`。
- 纯函数优先、`execute` 只返回 `output.schema` 声明的规范 JSON 值；失败 throw，不返回 `isError` 结构。

## Testing Guidelines

- 框架 vitest；`tests/*.spec.ts`。
- 覆盖：key 解析顺序、线路回退、payload/提取、注册 schema、HMR 卸载（`fiber.dispose()`）、`fs/observed`、无 key/文件缺失/目录/非图片等错误路径。
- 接缝用 `ctx.provide('credentials', fake as never)` 注入假服务；真 `LocalFileSystem` 配临时目录；`vi.stubGlobal('fetch', ...)` mock 网络。

## Commit & Pull Request Guidelines

- Conventional Commits：`feat:`/`fix:`/`docs:`/`refactor:`/`test:`。
- 一个逻辑改动一次提交；PR 说明改了什么、为什么，关联 ADR-0002。
- 绝不提交 key 或凭据文件内容。

## Security & Configuration Tips

- key 只经 `ctx.credentials.resolve(credentialRef('OPENCODE_GO_API_KEY' | 'OPENCODE_API_KEY'))` 读取，不打印/写盘/扫描目录。
- 文件读取只走 `ctx.fs`，读后即 base64 直发，不落盘（非原生格式转码时经系统临时目录中转，转换后即删；见 `transcode.ts`）。
- 新增能力应先走接缝（Service Definition/Provider/Consumer），不要在 `apply` 里手写进程/文件/网络边界之外的东西。
