export function classifyCaptureFailure(error) {
  const message = String(error?.message ?? error ?? '');
  const lower = message.toLowerCase();
  let category = 'unknown';
  let retryable = false;

  if (/blocked address|unsupported scheme|credentials in url|blockedbyclient/.test(lower)) {
    category = 'security-policy';
  } else if (/err_blocked_by_administrator|administrator|policy blocked/.test(lower)) {
    category = 'environment-policy';
  } else if (/auth_wall|login required|sign in required|authentication required/.test(lower)) {
    category = 'auth-wall';
  } else if (/timeout|timed out|etimedout/.test(lower)) {
    category = 'timeout';
    retryable = true;
  } else if (/enotfound|eai_again|getaddrinfo|dns returned no addresses/.test(lower)) {
    category = 'dns';
    retryable = /eai_again/.test(lower);
  } else if (/err_connection|err_network|websocket|chromium|browser closed|target closed/.test(lower)) {
    category = 'browser-network';
    retryable = true;
  }

  return { category, retryable, message };
}
