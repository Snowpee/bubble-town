export type HealthStatus = 'ok' | 'warning' | 'error';

export interface HealthCheckItem {
  key: 'apiServer' | 'hermesRoot' | 'stateDb' | 'sessionsDir' | 'auth';
  status: HealthStatus;
  message: string;
  detail?: string;
}

export interface HealthResponse {
  overallStatus: HealthStatus;
  items: HealthCheckItem[];
  detected: {
    hermesRoot?: string;
    apiBaseUrl?: string;
    apiServerReachable: boolean;
  };
}
