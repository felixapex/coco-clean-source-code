import fs from 'node:fs/promises';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { CdpClient } from '../../src/import-core/capture/cdp-client.mjs';

export function assertSafeBrowserPath(browserPath) {
  const normalized = String(browserPath || '').replace(/\\/g, '/').toLowerCase();
  if (!normalized || /(?:^|\/)msedge(?:\.exe)?$/.test(normalized)) {
    throw new Error('Microsoft Edge automation is disabled; provide an isolated Google Chrome path');
  }
}

export function assertBinaryPrefix(buffer, expectedPrefix) {
  const prefix = String(expectedPrefix || '');
  if (!prefix) return;
  const actual = Buffer.from(buffer || []).subarray(0, Buffer.byteLength(prefix)).toString('latin1');
  if (actual !== prefix) throw new Error(`Unexpected binary prefix: expected ${JSON.stringify(prefix)}, received ${JSON.stringify(actual)}`);
}

export function assertExpectedContent(buffer, actualContentType, expectedContentType) {
  const expected = String(expectedContentType || '').split(';')[0].trim().toLowerCase();
  if (!expected) return;
  const actual = String(actualContentType || '').split(';')[0].trim().toLowerCase();
  if (actual !== expected) throw new Error(`Expected content type ${expected}, received ${actual || 'unknown'}`);
  const prefix = Buffer.from(buffer || []).subarray(0, 4096).toString('utf8').trimStart().toLowerCase();
  if (expected === 'text/css' && (/^(?:<!doctype\s+html|<html\b)/i.test(prefix) || /just a moment|checking your browser|verify (?:that )?you are human/i.test(prefix))) {
    throw new Error('Stylesheet response is an HTML verification challenge or HTML instead of CSS');
  }
}

export function assertSuccessfulResponse(status, url = '') {
  if (status === null || status === undefined || status === '') throw new Error(`Binary fetch has missing HTTP status${url ? ` for ${url}` : ''}`);
  const code = Number(status);
  if (!Number.isFinite(code)) throw new Error(`Binary fetch has missing HTTP status${url ? ` for ${url}` : ''}`);
  if (code < 200 || code >= 300) throw new Error(`Binary fetch failed with HTTP ${code}${url ? ` for ${url}` : ''}`);
}

export function decodeCdpBody(result) {
  return result?.base64Encoded ? Buffer.from(result.body || '', 'base64') : Buffer.from(result?.body || '', 'latin1');
}

export function decodeRuntimeFetchPayload(payload) {
  if (!payload?.ok) throw new Error(`Browser fetch failed: ${payload?.status ?? 'unknown'} ${payload?.url || ''}`.trim());
  return {
    buffer: Buffer.from(payload.bodyBase64 || '', 'base64'),
    responseUrl: payload.url || null,
    mimeType: payload.contentType || null,
    status: payload.status ?? null,
  };
}

export function selectBinaryResponseCandidate(candidates, requestedUrl) {
  return [...(candidates || [])]
    .sort((left, right) => {
      const score = (candidate) =>
        (String(candidate?.mimeType || '').toLowerCase() === 'application/pdf' ? 100 : 0)
        + (candidate?.url === requestedUrl ? 20 : 0)
        + (Number(candidate?.status) >= 200 && Number(candidate?.status) < 300 ? 10 : 0)
        + (candidate?.type !== 'Document' ? 1 : 0);
      return score(right) - score(left);
    })[0] || null;
}

export function resolveBinaryResponseCandidate(candidates, requestedUrl, interceptError = null) {
  const candidate = selectBinaryResponseCandidate(candidates, requestedUrl);
  if (candidate) return candidate;
  if (interceptError) throw interceptError;
  return null;
}

async function waitForDevToolsPort(profileDir, browserProcess, timeoutMs) {
  const target = path.join(profileDir, 'DevToolsActivePort');
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (browserProcess.exitCode !== null) throw new Error(`Chrome exited before DevTools was ready: ${browserProcess.exitCode}`);
    try {
      const [port] = String(await fs.readFile(target, 'utf8')).trim().split(/\r?\n/);
      if (port) return Number(port);
    } catch {}
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  throw new Error('Timed out waiting for Chrome DevTools port');
}

async function pageTarget(port, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(`http://127.0.0.1:${port}/json/list`);
      const targets = await response.json();
      const page = targets.find((target) => target.type === 'page');
      if (page?.webSocketDebuggerUrl) return page;
    } catch {}
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  throw new Error('Timed out finding Chrome page target');
}

async function responseBody(client, requestId, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  let lastError;
  while (Date.now() < deadline) {
    try {
      const result = await client.send('Network.getResponseBody', { requestId });
      return decodeCdpBody(result);
    } catch (error) {
      lastError = error;
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
  }
  throw lastError || new Error('Timed out reading network response body');
}

export async function fetchBinaryWithChrome(url, {
  browserPath,
  profileDir,
  timeoutMs = 90000,
  expectedPrefix = '',
  expectedContentType = '',
  contextUrl = '',
} = {}) {
  assertSafeBrowserPath(browserPath);
  if (!profileDir) throw new Error('profileDir is required');
  await fs.rm(profileDir, { recursive: true, force: true });
  await fs.mkdir(profileDir, { recursive: true });
  const browserProcess = spawn(browserPath, [
    '--headless=new',
    '--disable-gpu',
    '--disable-background-networking',
    '--disable-component-update',
    '--disable-pdf-extension',
    '--no-first-run',
    '--no-default-browser-check',
    '--remote-debugging-port=0',
    `--user-data-dir=${profileDir}`,
    'about:blank',
  ], { stdio: 'ignore', windowsHide: true });
  let client;
  try {
    const port = await waitForDevToolsPort(profileDir, browserProcess, timeoutMs);
    const target = await pageTarget(port, timeoutMs);
    client = new CdpClient(target.webSocketDebuggerUrl, { timeoutMs });
    await client.connect();
    await client.send('Network.enable');
    await client.send('Page.enable');
    if (contextUrl) {
      await client.send('Page.navigate', { url: contextUrl });
      await new Promise((resolve) => setTimeout(resolve, 1500));
      const evaluated = await client.send('Runtime.evaluate', {
        expression: `(async () => {
          const response = await fetch(${JSON.stringify(url)}, { credentials: 'include', cache: 'no-store' });
          const bytes = new Uint8Array(await response.arrayBuffer());
          let binary = '';
          for (let offset = 0; offset < bytes.length; offset += 32768) {
            binary += String.fromCharCode(...bytes.subarray(offset, offset + 32768));
          }
          return {
            ok: response.ok,
            status: response.status,
            url: response.url,
            contentType: response.headers.get('content-type'),
            bodyBase64: btoa(binary),
          };
        })()`,
        awaitPromise: true,
        returnByValue: true,
      });
      if (evaluated?.exceptionDetails) throw new Error(`Browser context fetch failed: ${evaluated.exceptionDetails.text || 'runtime exception'}`);
      const result = decodeRuntimeFetchPayload(evaluated?.result?.value);
      assertSuccessfulResponse(result.status, result.responseUrl || url);
      assertBinaryPrefix(result.buffer, expectedPrefix);
      assertExpectedContent(result.buffer, result.mimeType, expectedContentType);
      return result;
    }
    let intercepted = null;
    let interceptError = null;
    const stopFetch = client.onEvent('Fetch.requestPaused', async (event) => {
      try {
        if (event?.request?.url === url && event?.responseStatusCode) {
          const result = await client.send('Fetch.getResponseBody', { requestId: event.requestId });
          intercepted = {
            buffer: decodeCdpBody(result),
            responseUrl: event.request.url,
            status: event.responseStatusCode,
            mimeType: event.responseHeaders?.find((header) => String(header.name).toLowerCase() === 'content-type')?.value || null,
          };
        }
      } catch (error) {
        interceptError = error;
      } finally {
        try { await client.send('Fetch.continueResponse', { requestId: event.requestId }); }
        catch { try { await client.send('Fetch.continueRequest', { requestId: event.requestId }); } catch {} }
      }
    });
    await client.send('Fetch.enable', { patterns: [{ urlPattern: url, requestStage: 'Response' }] });
    const candidates = [];
    const stop = client.onEvent('Network.responseReceived', ({ requestId, response, type }) => {
      const mimeType = String(response?.mimeType || '').toLowerCase();
      if (response?.url === url || mimeType === 'application/pdf' || type === 'Document') candidates.push({
        requestId,
        url: response?.url || null,
        mimeType,
        status: response?.status ?? null,
        type,
      });
    });
    await client.send('Page.navigate', { url });
    const deadline = Date.now() + timeoutMs;
    while (!intercepted && !interceptError && !candidates.length && Date.now() < deadline) await new Promise((resolve) => setTimeout(resolve, 100));
    if (candidates.length && !intercepted && !interceptError) {
      const graceDeadline = Math.min(deadline, Date.now() + 3000);
      while (!intercepted && !interceptError && Date.now() < graceDeadline) await new Promise((resolve) => setTimeout(resolve, 100));
    }
    if (candidates.length) await new Promise((resolve) => setTimeout(resolve, 2000));
    stop();
    stopFetch();
    try { await client.send('Fetch.disable'); } catch {}
    if (intercepted) {
      assertSuccessfulResponse(intercepted.status, intercepted.responseUrl || url);
      assertBinaryPrefix(intercepted.buffer, expectedPrefix);
      assertExpectedContent(intercepted.buffer, intercepted.mimeType, expectedContentType);
      return { buffer: intercepted.buffer, responseUrl: intercepted.responseUrl, mimeType: intercepted.mimeType, status: intercepted.status };
    }
    const candidate = resolveBinaryResponseCandidate(candidates, url, interceptError);
    if (!candidate) throw new Error(`No document response received for ${url}`);
    const buffer = await responseBody(client, candidate.requestId, Math.max(1000, deadline - Date.now()));
    assertSuccessfulResponse(candidate.status, candidate.url || url);
    try {
      assertBinaryPrefix(buffer, expectedPrefix);
    } catch (error) {
      throw new Error(`${error.message}; response=${JSON.stringify({ url: candidate.url, mimeType: candidate.mimeType, status: candidate.status, type: candidate.type })}`);
    }
    assertExpectedContent(buffer, candidate.mimeType, expectedContentType);
    return { buffer, responseUrl: candidate.url, mimeType: candidate.mimeType, status: candidate.status };
  } finally {
    try { await client?.close(); } catch {}
    if (browserProcess.exitCode === null) browserProcess.kill();
    await fs.rm(profileDir, { recursive: true, force: true }).catch(() => {});
  }
}
