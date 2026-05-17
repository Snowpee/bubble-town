import type { FastifyInstance } from 'fastify';
import type { HealthResponse } from '@bubble-town/shared';
import { getHermesRoot } from '../services/hermes-paths.js';
import { getManagedHermesGatewaySnapshot, isManagedHermesGatewayReachable } from '../services/hermes-gateway.js';

export async function registerHealthRoutes(app: FastifyInstance) {
  app.get('/api/health', async () => {
    const gateway = getManagedHermesGatewaySnapshot();
    const reachable = await isManagedHermesGatewayReachable();
    const response: HealthResponse = {
      overallStatus: reachable ? 'ok' : 'warning',
      items: [
        {
          key: 'apiServer',
          status: reachable ? 'ok' : 'warning',
          message: reachable ? 'Bubble Town 专用 Hermes API Server 正常运行。' : 'Bubble Town 专用 Hermes API Server 尚未就绪。',
          detail: gateway.apiBaseUrl,
        },
        { key: 'hermesRoot', status: 'ok', message: '已生成 Hermes 根路径推断。', detail: getHermesRoot() },
        { key: 'stateDb', status: 'warning', message: 'state.db 读取逻辑将在下一阶段接入。' },
        { key: 'sessionsDir', status: 'warning', message: 'sessions 目录扫描逻辑将在下一阶段接入。' },
        { key: 'auth', status: 'warning', message: 'auth.json 与 API key 读取逻辑将在下一阶段接入。' },
      ],
      detected: {
        hermesRoot: getHermesRoot(),
        apiBaseUrl: gateway.apiBaseUrl,
        apiServerReachable: reachable,
      },
    };

    return response;
  });
}
