import { isAxiosError } from 'axios';
let retryAt = 0;
export function recordRateLimit(value: unknown) {
  const seconds = Number(value);
  const until = typeof value === 'string' && !Number.isFinite(seconds) ? Date.parse(value) : Date.now() + (Number.isFinite(seconds) && seconds > 0 ? seconds : 60) * 1000;
  retryAt = Math.max(retryAt, Number.isFinite(until) ? until : Date.now() + 60000);
}
export const requestRetryAt = () => retryAt;
export const rateLimitDelay = () => Math.max(0, retryAt - Date.now());
export const auditPollingInterval = (running: boolean) => Math.max(running ? 10000 : 60000, rateLimitDelay() + 1000);
export const retryQuery = (failureCount: number, error: unknown) => failureCount < 1 && !(isAxiosError(error) && [401, 403, 429].includes(error.response?.status ?? 0));
export function authenticationFailure(error: unknown) {
  const invalid = isAxiosError(error) && error.response?.status === 401;
  const limited = isAxiosError(error) && error.response?.status === 429;
  return {
    invalid,
    message: limited ? 'Server request limit reached. Retrying session verification after the cooldown.' : 'Unable to verify your session right now. Retrying when the service is available.',
    retryAt: Math.max(Date.now() + 15000, requestRetryAt() + 1000),
  };
}
