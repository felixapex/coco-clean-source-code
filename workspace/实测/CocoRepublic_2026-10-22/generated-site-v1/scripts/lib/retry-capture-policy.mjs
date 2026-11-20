export function withPersistentBrowserRetry(options) {
  return {
    ...options,
    attempts: 2,
    retryDelayMs: 10000,
  };
}
