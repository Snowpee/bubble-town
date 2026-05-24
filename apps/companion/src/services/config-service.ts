import { getManagedHermesGatewaySnapshot } from '../adapters/hermes/hermes-gateway.js';
import { getHermesRoot } from '../adapters/hermes/hermes-paths.js';
import { getCompanionLockSnapshot } from '../runtime/companion-lock.js';

const fallbackApiBaseUrl = 'http://127.0.0.1:8643/v1';
const fallbackCompanionPort = 3030;

export function getConfigResponse() {
  const gateway = getManagedHermesGatewaySnapshot();

  return {
    apiBaseUrl: gateway.apiBaseUrl ?? process.env.HERMES_API_BASE_URL ?? fallbackApiBaseUrl,
    companionPort: fallbackCompanionPort,
    companionPid: process.pid,
    companionLock: getCompanionLockSnapshot(),
    hermesRoot: getHermesRoot(),
    managedHermes: gateway,
  };
}
