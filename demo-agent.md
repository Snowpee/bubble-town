# Super Spatula - 前端架构指南

本文档定义了本项目的架构设计、目录结构和开发规范。旨在确保代码的可维护性、可扩展性和一致性。遵循现代 React 生态的最佳实践。

## 1. 技术栈概览

- **构建工具**: [Vite](https://vitejs.dev/) - 极速的开发服务器和构建工具。
- **框架**: [React](https://react.dev/) (v19+) - 使用函数式组件和 Hooks。
- **语言**: [TypeScript](https://www.typescriptlang.org/) - 强类型支持，提高代码健壮性。
- **样式**: [Tailwind CSS](https://tailwindcss.com/) - 实用优先的 CSS 框架，结合 CSS Modules 处理复杂组件样式。
- **状态管理**:
  - **服务端状态**: [TanStack Query (React Query)](https://tanstack.com/query/latest) - 处理异步数据获取、缓存和同步。
  - **客户端全局状态**: [Zustand](https://github.com/pmndrs/zustand) - 轻量级、易用的全局状态管理（仅在必要时使用）。
  - **局部状态**: React `useState`, `useReducer`, `Context`。
- **路由**: [React Router](https://reactrouter.com/) (v6+)。
- **测试**: [Vitest](https://vitest.dev/) (单元测试) + [React Testing Library](https://testing-library.com/docs/react-testing-library/intro/) (组件测试)。
- **代码规范**: ESLint + Prettier。

## 2. 目录结构

采用 **功能特性 (Feature-based)** 组织结构，将相关代码聚合在一起，而非按文件类型分离。

```
src/
├── assets/              # 静态资源 (图片, 字体等)
├── components/          # 全局共享的通用 UI 组件
│   └── ui/              # 以功能为导向的 UI 组件集合
├── config/              # 全局配置 (环境变量, 常量)
├── features/            # 业务功能模块 (核心)
│   ├── ai/              # AI 工具与代理能力
│   │   ├── api/         # 该模块的 API 函数
│   │   ├── hooks/       # 该模块特有的 Hooks
│   │   ├── prompts/     # 系统提示词
│   │   ├── tools/       # 工具实现与注册
│   │   ├── types.ts
│   │   └── index.ts
│   ├── canvas/          # 画布与绘图模块
│   │   ├── components/
│   │   ├── config/
│   │   ├── hooks/
│   │   ├── stores/
│   │   ├── utils/
│   │   └── index.ts
│   └── chat/            # 聊天模块
│       ├── api/
│       ├── components/
│       ├── hooks/
│       ├── stores/
│       ├── utils/
│       └── index.ts
├── lib/                 # 第三方库的配置和封装
├── pages/               # 页面组件
├── services/            # 跨 feature 的基础服务层
│   ├── ai/
│   ├── core/
│   ├── tools/
│   └── index.ts
├── App.tsx              # 应用入口组件
├── index.css
└── main.tsx             # 渲染入口
```

### 2.1 Feature 模块开发原则 (Feature Module Principles)

1.  **就近原则 (Co-location)**
    - 如果一个组件、Hook 或工具函数**只被当前 Feature 使用**，它**必须**放在该 Feature 目录下，严禁放入全局 `src/components` 或 `src/hooks`。
    - 只有当代码被 **2 个以上** 的 Feature 复用时，才考虑提升至全局目录。

2.  **高内聚 (High Cohesion)**
    - Feature 内部的相关配置（如 `config.json`）、静态数据、类型定义应紧挨着业务代码存放，不要散落在项目根目录。

3.  **公共屏障 (Public Interface)**
    - Feature 之间严禁直接引用内部文件（如 `import ... from '@/features/auth/components/LoginForm'` 是**禁止**的）。
    - 必须通过 `index.ts` 进行暴露，使用 `import { LoginForm } from '@/features/auth'`。


## 3. 开发规范

### 3.1 组件设计 (Component Design)

- **函数式组件**: 必须使用函数式组件和 Hooks。
- **单一职责**: 每个组件应只做一件事。如果组件变得过大，请将其拆分为更小的子组件。
- **Props 定义**: 必须为所有组件定义 TypeScript 接口。
  ```tsx
  interface ButtonProps {
    label: string;
    onClick: () => void;
    variant?: 'primary' | 'secondary';
  }
  
  export const Button = ({ label, onClick, variant = 'primary' }: ButtonProps) => {
    // ...
  };
  ```
- **导出方式**: 使用命名导出 (`export const Component = ...`) 而非默认导出 (`export default`)，以获得更好的自动补全和重构支持（页面级组件除外，便于 Lazy Loading）。

### 3.2 状态管理 (State Management)

- **优先使用局部状态**: 尽可能将状态保持在组件内部 (`useState`)。
- **服务端状态分离**: 不要将 API 数据存储在全局 Store (如 Redux/Zustand) 中，除非需要跨多个无关组件共享。优先使用 `React Query` 的缓存机制。
- **提升状态 (Lifting State)**: 当兄弟组件需要共享状态时，将状态提升到它们最近的共同父组件。
- **Zustand 使用**: 仅用于真正的全局客户端状态（如：侧边栏开关、用户偏好设置、当前主题）。

### 3.3 命名规范 (Naming Conventions)

- **文件/文件夹**:
  - 组件: `PascalCase` (e.g., `MyComponent.tsx`, `components/MyComponent/`)
  - Hooks: `camelCase` 以 `use` 开头 (e.g., `useAuth.ts`)
  - 工具函数: `camelCase` (e.g., `formatDate.ts`)
  - 常量: `UPPER_SNAKE_CASE` (e.g., `MAX_RETRY_COUNT`)
- **组件命名**: 应该具有描述性。避免使用通用的名称（如 `List`, `Item`），除非是在特定的 Feature 目录下。

### 3.4 路径别名

优先使用 `@/` 别名进行跨模块引用，禁止使用两层及以上的相对路径。

**跨模块引用，必须使用 `@/`：**
- ✅ `import { useAuth } from '@/hooks/useAuth'`
- ❌ `import { useAuth } from '../../hooks/useAuth'`

**同模块内相邻文件，允许使用 `./`：**
- ✅ `import { helper } from './utils'`
- ✅ `import { SubComponent } from './parts'`

**判断标准：** 若移动当前文件后 import 路径需要跟着改变，说明应该改用 `@/`。

### 3.4 样式 (Styling)

- **Tailwind CSS**: 优先使用 Tailwind 的 Utility Classes。
- **复杂样式**: 对于复杂的组件样式，可以使用 `clsx` 或 `tailwind-merge` 来条件化合并类名。
- **CSS Modules**: 仅在 Tailwind 无法满足需求的极端边缘情况或需要封装第三方库样式时使用。

## 4. 数据获取与 API (Data Fetching)

- **React Query**: 所有服务端数据获取必须通过 React Query 的 Hooks 进行。
- **API 层封装**: 不要直接在组件中调用 `axios` 或 `fetch`。
  - 在 `features/xxx/api/` 中定义 API 函数。
  - 示例：
    ```ts
    // features/auth/api/getUser.ts
    export const getUser = async (): Promise<User> => {
      const response = await axios.get('/user');
      return response.data;
    };

    // 组件中使用
    const { data, isLoading } = useQuery({ queryKey: ['user'], queryFn: getUser });
    ```

## 5. 错误处理 (Error Handling)

- **API 错误**: 在 `axios` 拦截器中统一处理通用错误（如 401 未授权跳转登录）。
- **错误边界 (Error Boundaries)**: 使用 `react-error-boundary` 包裹应用或主要路由模块，以捕获渲染错误并展示优雅的降级 UI。
- **表单验证**: 使用 `react-hook-form` 配合 `zod` 进行表单验证。

## 6. 性能优化 (Performance)

- **Code Splitting**: 使用 `React.lazy` 和 `Suspense` 对路由进行懒加载。
- **Memoization**: 不要过度优化。仅在性能分析表明需要时使用 `useMemo` 和 `useCallback`（通常用于引用相等性检查或昂贵的计算）。
- **列表渲染**: 渲染长列表时，确保提供唯一的 `key` 属性。对于超长列表，考虑使用虚拟滚动 (`react-window` 或 `react-virtuoso`)。

## 7. 测试策略 (Testing)

- **单元测试**: 测试纯函数、Hooks 和复杂的业务逻辑。
- **组件测试**: 使用 React Testing Library。关注用户的行为（点击、输入），而不是组件的内部实现细节（State）。
  - **好的测试**: "当用户点击保存按钮，应该调用 API 并显示成功消息。"
  - **坏的测试**: "点击按钮后，组件状态 `isSaved` 应该变为 true。"

---

*文档维护者: 核心开发团队*
*最后更新: 2026-03-01*
