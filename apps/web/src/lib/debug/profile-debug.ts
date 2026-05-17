export function logProfileDebug(event: string, detail?: Record<string, unknown>) {
  if (!import.meta.env.DEV) {
    return;
  }

  console.debug('[profile-debug]', event, detail ?? {});
}
