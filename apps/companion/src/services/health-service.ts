import type { HealthResponse } from '@bubble-town/shared';
import { getManagedHermesGatewaySnapshot, isManagedHermesGatewayReachable } from '../adapters/hermes/hermes-gateway.js';
import { getHermesRoot } from '../adapters/hermes/hermes-paths.js';

export async function getHealthResponse(): Promise<HealthResponse> {
  const gateway = getManagedHermesGatewaySnapshot();
  const reachable = await isManagedHermesGatewayReachable();

  return {
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
}
