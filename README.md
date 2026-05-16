# Bubble Town

Hermes Web 客户端骨架工程，采用 `Electron + React + Fastify companion + shared types` 的 monorepo 结构。

## 工作区

- `apps/web`: React + Vite 前端
- `apps/companion`: 本地 Fastify companion 服务
- `apps/desktop`: Electron 主进程与 preload
- `packages/shared`: 前后端共享类型

## 常用命令

```bash
npm install
npm run dev
npm run dev:web
npm run dev:backend
npm run dev:desktop
npm run dev:all
npm run check
npm run test
```

- `npm run dev`: 同时启动本地 `web + backend`
- `npm run dev:web`: 仅启动本地 Web 开发服务器
- `npm run dev:backend`: 仅启动本地 backend（Fastify companion）
- `npm run dev:desktop`: 仅启动 desktop 壳
- `npm run dev:all`: 同时启动 `web + backend + desktop` 联调环境
