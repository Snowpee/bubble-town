# Bubble Town

[English README](./README.md)

Bubble Town 是一个面向 Hermes 的桌面/Web 聊天客户端工程，采用 Monorepo 组织，当前技术基线为 `Electron + React + Vite + Fastify + TypeScript`。

它的目标不是重新发明一套聊天后端，而是在本地 Companion 服务和桌面壳之上，提供一套更易扩展的 Hermes 前端体验。

## 项目概览

- `apps/web`：React + Vite 前端界面
- `apps/companion`：本地 Fastify Companion 服务，负责衔接前端与 Hermes 能力
- `apps/desktop`：Electron 桌面壳，加载 Web 并在打包时集成本地资源
- `packages/shared`：前后端共享类型与协议定义

## 技术栈

- 前端：React 18、React Router、TanStack Query、Zustand、Tailwind CSS v4
- 后端：Fastify
- 桌面端：Electron、electron-builder
- 工程化：TypeScript、Vitest、ESLint、npm workspaces

## 目录结构

```text
bubble-town/
├─ apps/
│  ├─ web/          # 前端应用
│  ├─ companion/    # 本地 Companion 服务
│  └─ desktop/      # Electron 主进程与 preload
├─ packages/
│  └─ shared/       # 共享类型
├─ README.md
└─ README.zh-CN.md
```

## 快速开始

### 运行要求

- Node.js 20+
- npm 10+

### 安装依赖

```bash
npm install
```

### 启动开发环境

```bash
npm run dev
```

默认会同时启动：

- Web 前端
- 本地 Companion 服务

如果需要联调桌面端：

```bash
npm run dev:all
```

### 启动内网访问模式

如果需要让同一局域网内的其他设备访问 Web 应用：

```bash
npm run dev:lan
```

该命令会让 Web 前端监听 `0.0.0.0`，并让 Companion 服务监听 `0.0.0.0:3030`。
启动后打开终端里 Vite 输出的 Network 地址，例如：

```text
http://192.168.1.23:5173/
```

通过内网地址打开应用时，前端会自动请求同一台主机 `3030` 端口上的 Companion 服务。

## 常用命令

| 命令 | 说明 |
| --- | --- |
| `npm run dev` | 启动 `web + companion` 开发环境 |
| `npm run dev:lan` | 以内网可访问模式启动 `web + companion` |
| `npm run dev:web` | 仅启动 Web 前端 |
| `npm run dev:web:lan` | 以内网可访问模式仅启动 Web 前端 |
| `npm run dev:backend` | 仅启动本地 Companion 服务 |
| `npm run dev:backend:lan` | 以内网可访问模式仅启动 Companion 服务 |
| `npm run dev:companion` | `dev:backend` 的别名 |
| `npm run dev:desktop` | 仅启动 Electron 桌面壳 |
| `npm run dev:all` | 同时启动 `web + companion + desktop` |
| `npm run check` | 运行各工作区 TypeScript 检查 |
| `npm run test` | 运行工作区测试 |
| `npm run build` | 构建全部工作区 |
| `npm run package:desktop` | 构建并打包桌面应用 |
| `npm run release:desktop:dry-run` | 预览 macOS 桌面版 GitHub Release 发布命令 |
| `npm run release:desktop` | 构建 macOS 桌面版并通过 GitHub CLI 发布 Release |

## 开发说明

### Web

`apps/web` 基于 Vite，适合快速迭代聊天界面、会话列表、设置页与共享 UI 组件。

### Companion

`apps/companion` 是本地 Fastify 服务，负责聚合配置、会话与 Hermes 交互逻辑，便于前端通过稳定接口访问本地能力。

### Desktop

`apps/desktop` 提供 Electron 主进程与 `preload` 层。桌面打包会将以下内容一并纳入产物：

- `apps/web/dist`
- `apps/companion/dist`
- `apps/companion/package.json`

## 打包桌面应用

```bash
npm run package:desktop
```

打包产物默认输出到 `apps/desktop/release`。

## 发布 macOS 桌面版

本地发布依赖 GitHub CLI。首次使用前先登录：

```bash
gh auth login
```

发布前建议先预览：

```bash
npm run release:desktop:dry-run -- --version 1.0.3 --skip-build
```

正式发布前，应先提交版本变更并推送对应 tag：

```bash
git tag v1.0.3
git push origin main v1.0.3
```

正式发布：

```bash
npm run release:desktop -- --version 1.0.3
```

脚本会执行桌面端打包，读取 `apps/desktop/release` 中匹配版本号的 `.dmg`、`.zip` 与增量更新辅助文件，并发布到 `v1.0.3`。如果该 Release 已存在，会改为上传并覆盖同名附件。

## 当前状态

当前仓库已经具备：

- Web 前端基础骨架
- 本地 Companion 服务
- Electron 桌面壳
- 共享类型定义
- 基础测试与类型检查脚本

适合作为 Hermes 客户端的继续开发基础。

## License

如需开源发布，建议后续补充明确的许可证文件。
