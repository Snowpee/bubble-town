# AGENT.md

本文件是 `bubble-town` 仓库的执行级规范入口。目标是让人类开发者与 AI agent 在进入仓库后，先快速理解不可违背的约束，再按详细文档继续实现。

详细设计、产品范围与完整代码规范见：

- `.trae/documents/hermes-web-client-prd.md`
- `.trae/documents/hermes-web-client-architecture.md`
- `.trae/documents/hermes-web-client-coding-standards.md`

## 1. 项目目标

- 本项目是 Hermes 的桌面优先客户端。
- 首版范围：`聊天 + profile 管理 + 会话浏览 + 连接/健康设置`
- 关键上下文边界：`profile`

## 2. 技术基线

- 桌面壳：`Electron`
- 前端：`React 18 + TypeScript + Vite + Tailwind CSS + shadcn/ui`
- 本地服务：`Fastify companion`
- 共享协议：`packages/shared`
- 不再使用 `Tauri`<mccoremem id="01KRKFRBD7G4TGFVJ3R7EH32V3" />

## 3. Monorepo 边界

- `apps/web`
  - 只负责 UI、路由、前端状态、API 调用封装
- `apps/companion`
  - 只负责 Hermes API 适配、本地状态读取、会话与 profile 编排
- `apps/desktop`
  - 只负责 Electron `main`、`preload`、窗口、菜单、生命周期
- `packages/shared`
  - 只负责 DTO、请求/响应类型、稳定常量

## 4. 强制规则

- `profile` 是聊天和会话的上下文边界
- 所有会话读取、聊天请求、profile 切换都必须显式考虑 `profileId`
- `web` 不得直接访问本地文件、SQLite、Hermes 配置目录
- `web` 不得直接 import `apps/companion` 或 `apps/desktop`
- `shared` 不得包含文件系统、网络请求、Electron API、React 组件、Fastify 实现
- `desktop` 不得承载 Hermes 业务逻辑
- `preload` 只暴露最小、安全、受控的桥接 API

## 5. 前端规则

- 服务端状态统一使用 `React Query`
- 客户端共享 UI 状态统一使用 `Zustand`
- 不要把服务端列表数据冗余放进 `Zustand`
- 组件禁止直接写裸 `fetch`
- API 调用统一放在 `apps/web/src/lib/api/*`
- 通用基础组件放在 `apps/web/src/components/ui`
- Hermes 业务组件放在 `apps/web/src/components/hermes`
- 路由放在 `apps/web/src/routes`
- 样式优先使用 Tailwind 和 `cn()`
- 不引入第二套冲突的 UI 体系

## 6. Companion 规则

- 路由统一挂在 `/api/*`
- `routes/` 只负责参数、状态码、调用 service
- `services/` 负责业务编排与多数据源聚合
- 底层读取逻辑放在 `store/repository` 风格文件
- 不在路由层直接读文件、查库、调远程 API
- Hermes 数据缺字段时，先在 service 层补齐 DTO 再返回前端

## 7. Electron 规则

- 默认开启 `contextIsolation`
- 默认关闭 `nodeIntegration`
- `main` 负责窗口、菜单、生命周期
- renderer 不得绕过 `preload` 获取系统能力

## 8. TypeScript 与导入规则

- 全仓使用 TypeScript
- 新增代码不允许用 `any` 逃避建模
- 跨端协议统一定义在 `packages/shared/src/*`
- 前后端共享字段先改 `shared`，再改消费方
- `web` 内跨模块优先使用 `@/`
- NodeNext 本地相对导入使用显式 `.js` 后缀

## 9. 测试与校验

提交前至少运行：

```bash
npm run check
npm run test
```

重要结构变更后追加运行：

```bash
npm run build
```

## 10. 默认实现顺序

新增功能按以下顺序推进：

1. 先改 `packages/shared`
2. 再改 `apps/companion`
3. 再改 `apps/web`
4. 最后改 `apps/desktop`

原因：先稳定协议和数据边界，再接 UI 和桌面壳，可以减少返工。<mccoremem id="01KRKFRBD7G4TGFVJ3R7EH32V3" />

## 11. 禁止事项

- 禁止提交 `dist/`、临时脚本、调试垃圾文件
- 禁止在前端直接访问 Hermes 本地目录
- 禁止在 `shared` 中写副作用逻辑
- 禁止为了未来可能需求过早抽象
- 禁止在多个子应用中发明不同风格的同类实现

## 12. 评审清单

每次提交前，至少自查：

- 是否违反了 `web / companion / desktop / shared` 分层边界
- 是否重复定义了共享类型
- 是否把业务逻辑写进展示组件或路由层
- 是否遗漏了 `profile` 上下文
- 是否补了必要测试
