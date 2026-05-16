import type { FastifyInstance } from 'fastify';
import type { HealthResponse } from '@bubble-town/shared';
import { getHermesRoot } from '../services/hermes-paths.js';

export async function registerHealthRoutes(app: FastifyInstance) {
  app.get('/api/health', async () => {
    const response: HealthResponse = {
      overallStatus: 'warning',
      items: [
        { key: 'apiServer', status: 'warning', message: 'Hermes API Server 尚未接入真实探测逻辑。' },
        { key: 'hermesRoot', status: 'ok', message: '已生成 Hermes 根路径推断。', detail: getHermesRoot() },
        { key: 'stateDb', status: 'warning', message: 'state.db 读取逻辑将在下一阶段接入。' },
        { key: 'sessionsDir', status: 'warning', message: 'sessions 目录扫描逻辑将在下一阶段接入。' },
        { key: 'auth', status: 'warning', message: 'auth.json 与 API key 读取逻辑将在下一阶段接入。' },
      ],
      detected: {
        hermesRoot: getHermesRoot(),
        apiBaseUrl: 'http://127.0.0.1:8642/v1',
        apiServerReachable: false,
      },
    };

    return response;
  });
}
