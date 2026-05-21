# Bubble Town

[English README](./README.md)

Bubble Town 是一个面向 Hermes 的本地优先桌面/Web 客户端，采用 npm workspaces Monorepo 组织。项目由 React Web 前端、本地 Fastify Companion 服务、Electron 桌面壳，以及一个共享类型包组成。

它不实现独立的大模型后端，而是在 Hermes 之上提供稳定的客户端层：管理本地 Hermes gateway，统一 profile 与 session 数据，向浏览器和桌面端暴露聊天、流式响应、设置、健康检查和 profile 管理 API。

## 架构总览

```text
┌──────────────────────────────────────────────────────────────────┐
│ apps/desktop                                                     │
│ Electron 主进程 + preload                                        │
│ - 加载 Vite dev server 或已打包的 web dist                       │
│ - 启动或复用本地 Companion 服务                                  │
│ - 通过 preload 暴露桌面环境信息与主题 IPC                         │
└───────────────────────────────┬──────────────────────────────────┘
                                │
                                │ http://127.0.0.1:3030
                                ▼
┌──────────────────────────────────────────────────────────────────┐
│ apps/web                                                         │
│ React + Vite 客户端                                              │
│ - 聊天、会话列表、Profile 管理、设置页                            │
│ - TanStack Query 管理服务端数据                                   │
│ - Zustand 管理本地持久化 UI 状态                                  │
└───────────────────────────────┬──────────────────────────────────┘
                                │
                                │ /api/*
                                ▼
┌──────────────────────────────────────────────────────────────────┐
│ apps/companion                                                   │
│ 本地 Fastify 服务                                                │
│ - 承载前端访问的本地 API                                         │
│ - 管理 Hermes profile 切换与 gateway 生命周期                    │
│ - 读取 Hermes state.db、response_store.db 与 session JSON         │
│ - 代理非流式与 SSE 流式聊天请求                                  │
└───────────────────────────────┬──────────────────────────────────┘
                                │
                                │ Hermes API Server / gateway
                                ▼
┌──────────────────────────────────────────────────────────────────┐
│ Hermes runtime: ~/.hermes 或 HERMES_HOME                         │
│ - profiles, config.yaml, sessions, state.db, response_store.db   │
└──────────────────────────────────────────────────────────────────┘
```

## 工作区说明

| Workspace | 职责 | 关键文件 |
| --- | --- | --- |
| `apps/web` | 浏览器端聊天、会话、Profile、设置界面 | `src/App.tsx`, `src/routes/*`, `src/lib/api/*`, `src/lib/state/workspace-store.ts` |
| `apps/companion` | 本地 API 服务与 Hermes 集成层 | `src/server.ts`, `src/routes/*`, `src/services/*` |
| `apps/desktop` | Electron 桌面壳与 macOS 打包目标 | `electron/main.ts`, `electron/preload.ts`, `package.json` 打包配置 |
| `packages/shared` | Web 与 Companion 共享的 TypeScript 协议类型 | `src/chat.ts`, `src/session.ts`, `src/profile.ts`, `src/health.ts` |

## 技术栈

- 运行环境与工作区：Node.js 22.12+，npm workspaces。
- 语言：TypeScript 5.8，基础严格配置来自 `tsconfig.base.json`。
- 前端：React 18、React Router 7、Vite 6、Tailwind CSS 4、Radix UI primitives、lucide-react、react-markdown。
- 前端数据与状态：TanStack Query 5 管理 Companion API 数据，Zustand 5 通过 `localStorage` 持久化工作区 UI 状态。
- Companion 服务：Fastify 5、`@fastify/cors`、Node 内置 `fetch`、`child_process`、`node:sqlite`、`yaml`。
- 桌面端：Electron 42、Electron Builder 26。
- 测试：Web 使用 Vitest，Companion 使用 Node 的 `tsx --test`。
- 构建：Web 使用 Vite，Companion 使用 `tsc` + esbuild，Desktop 使用 `tsc` + electron-builder。

## 运行模型

Bubble Town 支持三种主要运行形态：

1. Web + Companion 开发模式：
   - `npm run dev` 同时启动 `apps/web` 和 `apps/companion`。
   - 浏览器默认访问 `http://127.0.0.1:3030` 上的 Companion 服务。

2. 局域网开发模式：
   - `npm run dev:lan` 让 Web 和 Companion 都监听 `0.0.0.0`。
   - 用局域网地址打开 Web 页面时，前端会自动使用同一主机的 `3030` 端口作为 Companion 地址。

3. 桌面模式：
   - `npm run dev:all` 同时启动 Web、Companion 和 Electron。
   - 打包后的 Electron 应用加载 `apps/web/dist/index.html`，并通过 Electron 的 Node 运行能力启动随包附带的 Companion CJS 入口。

## 前端架构

`apps/web` 是 Vite SPA。`App.tsx` 会根据运行协议选择路由器：HTTP 环境使用 `BrowserRouter`，打包后的 `file:` 环境使用 `HashRouter`，因此同一套路由可以同时服务浏览器和 Electron 包。

主要路由：

| 路由 | 组件 | 职责 |
| --- | --- | --- |
| `/chat` | `ChatRoute` | 新聊天、流式响应、图片附件、聊天模式选择、会话缓存更新 |
| `/chat/:sessionId` | `ChatRoute` | 既有会话查看与续聊 |
| `/sessions` | `SessionsRoute` | 会话搜索、过滤、查看、批量选择与删除 |
| `/profiles` | `ProfilesRoute` | 创建、重命名、删除、切换 Hermes Profile |
| `/settings` | `SettingsRoute` | 健康检查、当前 Profile、聊天协议模式 |

前端 API 封装位于 `apps/web/src/lib/api`：

- `client.ts` 按以下优先级解析 `COMPANION_URL`：
  1. Electron preload 暴露的 `window.bubbleTownDesktop.companionUrl`。
  2. `VITE_COMPANION_URL`。
  3. 当前浏览器 hostname + `3030` 端口。
  4. `http://127.0.0.1:3030`。
- `hermes.ts` 封装健康检查、会话列表、会话详情、删除、非流式聊天与 SSE 流式聊天。
- `profiles.ts` 封装 profile CRUD 与 profile 切换。
- `profile-cache.ts` 在 profile 切换后同步 TanStack Query 缓存中的激活状态。

`workspace-store.ts` 负责本地持久化 UI 状态：

- 当前 active profile id
- 聊天协议模式：`responses` 或 `chat-completions`
- assistant 消息展示模式：`bubble` 或 `document`
- 侧边栏折叠状态和宽度

移动端侧边栏打开状态属于临时状态，不做持久化。

## Companion 架构

`apps/companion/src/server.ts` 创建 Fastify 应用、注册 CORS、挂载 API 路由、获取 Companion 单实例锁、为当前 active profile 启动 Hermes gateway，并在 Fastify 关闭时释放托管资源。

默认网络与环境配置：

| 变量 | 默认值 | 说明 |
| --- | --- | --- |
| `COMPANION_HOST` | `127.0.0.1` | Companion Fastify 服务监听地址 |
| `COMPANION_PORT` | `3030` | Companion Fastify 服务端口 |
| `HERMES_HOME` | `~/.hermes` | Hermes 根目录 |
| `HERMES_API_BASE_URL` | `http://127.0.0.1:8642/v1` | 非托管 gateway 场景的外部 Hermes API fallback |
| `BUBBLE_TOWN_HERMES_HOST` | `127.0.0.1` | 托管 Hermes gateway host |
| `BUBBLE_TOWN_HERMES_PORT` | `8643` | 托管 Hermes gateway 首选端口 |
| `BUBBLE_TOWN_HERMES_API_KEY` | 进程内生成 | 托管 gateway 请求使用的 Bearer key |
| `HERMES_BINARY` | 自动探测 `hermes` | 可选的 Hermes 二进制路径 |

### API 表面

| 方法 | 路径 | 说明 |
| --- | --- | --- |
| `GET` | `/api/ping` | Companion 轻量 readiness probe |
| `GET` | `/api/health` | 返回 gateway、Hermes root 与本地状态检查项 |
| `GET` | `/api/config` | 返回运行配置、lock snapshot 与 managed gateway snapshot |
| `GET` | `/api/profiles` | 列出 Hermes profiles 与当前 active profile |
| `POST` | `/api/profiles` | 通过 `hermes profile create --clone --no-alias` 创建 profile |
| `PATCH` | `/api/profiles/:id` | 通过 `hermes profile rename` 重命名 profile |
| `DELETE` | `/api/profiles/:id` | 通过 `hermes profile delete --yes` 删除 profile |
| `POST` | `/api/profiles/switch` | 确保目标 gateway 就绪，切换 active profile，并返回目标会话 |
| `GET` | `/api/sessions?profileId=...` | 获取指定 profile 的会话摘要列表 |
| `GET` | `/api/sessions/:id/summary?profileId=...` | 获取单个会话摘要 |
| `GET` | `/api/sessions/:id?profileId=...` | 获取标准化后的会话详情 |
| `DELETE` | `/api/sessions/:id?profileId=...` | 删除支持删除的会话 |
| `POST` | `/api/chat/respond` | 非流式聊天代理 |
| `POST` | `/api/chat/respond-stream` | SSE 聊天代理，输出 `message-start`、`message-delta`、`tool-progress`、`message-complete`、`message-error` |

### Hermes Gateway 管理

`services/hermes-gateway.ts` 负责托管 Hermes gateway 生命周期：

- 从 `HERMES_BINARY`、`~/.local/bin/hermes`、Homebrew 路径或 `PATH` 中解析 Hermes 二进制。
- 通过 `hermes gateway run --replace --accept-hooks` 启动 gateway。
- 注入 `HERMES_HOME`、`API_SERVER_ENABLED=true`、`API_SERVER_HOST`、`API_SERVER_PORT`、`API_SERVER_KEY`。
- 优先保留配置端口，冲突时回退到系统分配端口。
- 等待 `/health` 就绪后才返回 gateway snapshot。
- 串行化 gateway transition，避免快速 profile 切换产生竞态。
- 在内存中保留有限行数的 stdout/stderr 日志用于诊断。
- Companion 关闭时停止全部托管 gateway 进程。

`services/companion-lock.ts` 在 Hermes 根目录写入 `bubble-town-companion.lock.json`，用于避免多个 Companion 进程同时扮演同一个本地客户端角色。

### Hermes 数据访问

Hermes 路径集中在 `services/hermes-paths.ts`。

默认 profile 的 home 即 `HERMES_HOME`。命名 profile 位于 `HERMES_HOME/profiles/<profileId>`。

关键文件：

- `active_profile`：当前 active Hermes profile id。
- `config.yaml`：运行模型与可选的 `agent.system_prompt`。
- `sessions/session_<sessionId>.json`：Bubble Town 与 Hermes 兼容流程使用的 transcript JSON。
- `state.db`：SQLite 状态数据库，用于读取 sessions 和 messages。
- `response_store.db`：SQLite response store，用于恢复 `responseId` 与 session identity。

`services/session-store.ts` 会把 SQLite rows、response store rows 和 session JSON 文件归一化为共享的 `SessionSummary` 与 `SessionDetail`。兼容字段 `conversation` 与 `id` 会保留，但 `sessionId` 是标准身份字段。

### 聊天协议处理

`services/hermes-api.ts` 支持两种 Hermes 协议模式：

- `responses`：请求 `/responses`，可携带 `previous_response_id`，开启 `store: true`，图片附件转换为 `input_image`。
- `chat-completions`：请求 `/chat/completions`，从 transcript 或 detail 构造历史消息，续聊时使用 `X-Hermes-Session-Id`，图片附件转换为 `image_url`。

Companion 默认使用 `responses`。当继续旧的 CLI 来源会话且缺少 response chain 时，会自动转为 `chat-completions`。

流式聊天时，Companion 消费上游 SSE，归一化不同上游事件，向前端转发统一事件，累计 delta，跟踪 tool progress，并在可持久化场景下写入完整 turn。

## 桌面端架构

`apps/desktop/electron/main.ts` 负责：

- 将诊断日志写入 Electron logs 目录，失败时回退到 Hermes root 下的日志路径；
- 如果本地 Companion 已可达则直接复用；
- 清理指向当前 host/port 的失效 Companion lock；
- 打包模式下用 Electron Node 能力启动随包附带的 Companion 入口；
- 等待 `/api/ping` 就绪后再创建窗口；
- 开发模式加载 Vite dev server，生产模式加载 `web-dist/index.html`；
- 创建 macOS 透明/vibrancy、隐藏标题栏的窗口；
- 设置最小应用菜单；
- 退出前停止子 Companion 进程。

`electron/preload.ts` 只暴露受控的 `window.bubbleTownDesktop`：

- 平台与 Electron/Chromium/Node 版本信息
- Companion URL
- 标题栏布局预留尺寸
- `setNativeThemeSource(theme)` IPC 桥

渲染进程不启用 Node。Electron 窗口配置为 `contextIsolation: true`、`nodeIntegration: false`。

## 共享协议包

`packages/shared` 导出所有跨工作区 TypeScript 协议：

- `ChatRequest`、`ChatResponse`、流式事件、图片附件类型。
- `SessionSummary`、`SessionDetail`、`ChatMessage`、tool progress 事件。
- `ProfileSummary`、`ProfilesResponse`、profile mutation request 类型。
- `HealthResponse` 与 health item 状态类型。

Web 与 Companion 都通过 workspace dependency `@bubble-town/shared` 直接使用这些类型。

## 目录结构

```text
bubble-town/
├─ apps/
│  ├─ web/
│  │  ├─ src/routes/          # SPA 路由页面
│  │  ├─ src/components/      # layout、Hermes、loading、UI 组件
│  │  ├─ src/lib/api/         # Companion API 客户端封装
│  │  ├─ src/lib/state/       # 本地持久化工作区状态
│  │  └─ vite.config.ts
│  ├─ companion/
│  │  ├─ src/routes/          # Fastify route modules
│  │  ├─ src/services/        # Hermes 集成、sessions、profiles、locking
│  │  ├─ src/server.ts
│  │  └─ src/standalone.ts
│  └─ desktop/
│     ├─ electron/main.ts
│     ├─ electron/preload.ts
│     └─ package.json         # electron-builder 配置
├─ packages/
│  └─ shared/src/             # 共享 TypeScript API contracts
├─ scripts/
│  └─ release-desktop.mjs
├─ package.json
├─ tsconfig.base.json
└─ pnpm-workspace.yaml
```

## 开发

### 运行要求

- Node.js 22.12+
- npm 10+
- Hermes CLI 可在 `PATH` 中找到，或设置 `HERMES_BINARY`。
- 可用的 Hermes home 目录，默认 `~/.hermes`，也可设置 `HERMES_HOME`。

### 安装依赖

```bash
npm install
```

### 启动 Web + Companion

```bash
npm run dev
```

该命令会启动：

- Vite Web 应用，默认端口 `5173`
- Companion 服务，默认 `127.0.0.1:3030`

### 启动 Web + Companion + Desktop

```bash
npm run dev:all
```

### 启动局域网模式

```bash
npm run dev:lan
```

该命令会让 Web 与 Companion 都监听 `0.0.0.0`。打开终端中 Vite 输出的 Network 地址，例如：

```text
http://192.168.1.23:5173/
```

前端会自动请求 `http://192.168.1.23:3030`。

## 常用命令

| 命令 | 说明 |
| --- | --- |
| `npm run dev` | 启动 `web + companion` |
| `npm run dev:lan` | 以局域网可访问模式启动 `web + companion` |
| `npm run dev:web` | 仅启动 Web |
| `npm run dev:web:lan` | 以局域网可访问模式仅启动 Web |
| `npm run dev:backend` | 仅启动 Companion |
| `npm run dev:backend:lan` | 以局域网可访问模式仅启动 Companion |
| `npm run dev:companion` | `dev:backend` 的别名 |
| `npm run dev:desktop` | 仅启动 Electron 壳 |
| `npm run dev:all` | 同时启动 `web + companion + desktop` |
| `npm run check` | 运行全部 workspace TypeScript 检查 |
| `npm run test` | 运行 workspace 测试 |
| `npm run build` | 构建全部 workspace |
| `npm run package:desktop` | 构建并打包桌面应用 |
| `npm run package:dir -w @bubble-town/desktop` | 使用 ad-hoc 签名生成本地 macOS `.app` 目录 |
| `npm run package:zip -w @bubble-town/desktop` | 使用 ad-hoc 签名生成 macOS arm64 `.zip` |
| `npm run package:dmg -w @bubble-town/desktop` | 使用 ad-hoc 签名生成 macOS arm64 `.dmg` |
| `npm run release:desktop:dry-run` | 预览桌面版 release 命令 |
| `npm run release:desktop` | 构建 macOS arm64 + x64 并通过 GitHub CLI 发布 |

## 构建与打包

```bash
npm run build
npm run package:desktop
```

构建行为：

- `@bubble-town/web`：`tsc --noEmit && vite build`
- `@bubble-town/companion`：`tsc` 后通过 esbuild 输出 `dist/server.cjs`
- `@bubble-town/desktop`：对 Electron 源码执行 `tsc`，再由 electron-builder 打包
- `@bubble-town/shared`：执行 TypeScript build/check

Electron Builder 会包含：

- `apps/web/dist` 到 `web-dist`
- `apps/companion/dist` 到 `companion/dist`
- `apps/companion/package.json` 到 `companion/package.json`
- Electron `dist/**/*`、`electron/*.cjs`、desktop `package.json`

打包产物默认输出到 `apps/desktop/release`。

## 发布流程

发布依赖 GitHub CLI：

```bash
gh auth login
```

预览：

```bash
npm run release:desktop:dry-run -- --version 1.0.5 --skip-build
```

打 tag 并推送：

```bash
git tag v1.0.5
git push origin main v1.0.5
```

正式发布：

```bash
npm run release:desktop -- --version 1.0.5
```

发布脚本会清理 `apps/desktop/release`，分别构建 macOS `arm64` 与 `x64` 包，选择匹配版本的 `.dmg`、`.zip` 和更新辅助文件，并上传到 GitHub Release。如果 Release 已存在，则覆盖同名附件。

常用变体：

```bash
npm run release:desktop -- --version 1.0.5 --arch arm64
npm run release:desktop -- --version 1.0.5 --arch x64
npm run release:desktop -- --version 1.0.5 --skip-build
```

## 测试策略

当前测试集中覆盖风险较高的集成边界：

- Companion Hermes API 请求与流式处理。
- Companion gateway 生命周期。
- Companion profile 操作。
- Companion session-store 归一化。
- Web API helpers。
- Web profile cache 更新。
- Web chat cache 行为。

运行全部测试：

```bash
npm run test
```

运行类型检查：

```bash
npm run check
```

## 当前状态

Bubble Town 当前已经具备：

- 可工作的 React/Vite 客户端壳；
- 会话、Profile、设置、流式聊天界面；
- 本地 Fastify Companion API；
- Hermes gateway 托管启动与按 profile 切换；
- 基于 JSON 与 SQLite store 的 Hermes 会话归一化；
- Electron 桌面集成与 macOS 打包；
- 共享 TypeScript 协议与聚焦测试。

已知未完成项体现在健康检查中：`/api/health` 里更深入的 `state.db`、sessions 目录和 auth 诊断仍标记为后续接入。

## License

如需开源发布，建议后续补充明确的许可证文件。
