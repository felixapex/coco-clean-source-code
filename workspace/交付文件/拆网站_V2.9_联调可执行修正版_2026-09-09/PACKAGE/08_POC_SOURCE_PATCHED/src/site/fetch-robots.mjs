import crypto from 'node:crypto';
import http from 'node:http';
import https from 'node:https';
import net from 'node:net';
import { resolveAndValidateUrl } from '../security/url-policy.mjs';
import { parseRobotsTxt, isRobotsAllowed } from './robots-policy.mjs';

function sha256(text) {
  return crypto.createHash('sha256').update(text).digest('hex');
}

export function createPinnedLookup(address) {
  const family = net.isIP(address);
  if (!family) throw new Error(`Invalid pinned IP address: ${address}`);
  return (_hostname, options, callback) => {
    if (options?.all) {
      callback(null, [{ address, family }]);
      return;
    }
    callback(null, address, family);
  };
}

export function robotsFetchDecision(result = {}) {
  if (result.error) return { access: 'deny', reason: 'robots-unreachable' };
  const status = Number(result.status ?? 0);
  if (status >= 200 && status < 300) return { access: 'rules', reason: 'robots-rules' };
  if (status >= 400 && status < 500) return { access: 'allow', reason: 'robots-unavailable' };
  return { access: 'deny', reason: 'robots-unreachable' };
}

export function createRobotsVisitPolicy(result, { mode = 'respect', userAgent = 'MatboxComponentEngine' } = {}) {
  const decision = robotsFetchDecision(result);
  const parsed = decision.access === 'rules' ? parseRobotsTxt(result.text ?? '') : null;
  return async (url) => {
    if (decision.access === 'deny') {
      return mode === 'record-only'
        ? { allowed: true, reason: 'robots-record-only-unreachable' }
        : { allowed: false, reason: decision.reason };
    }
    if (decision.access === 'allow') return { allowed: true, reason: decision.reason };
    const allowed = isRobotsAllowed(parsed, url, userAgent);
    if (mode === 'record-only') {
      return { allowed: true, reason: allowed ? 'robots-record-only-allow' : 'robots-record-only-disallow' };
    }
    return { allowed, reason: allowed ? 'robots-allow' : 'robots-disallow' };
  };
}

function requestPinned(url, address, { timeoutMs, maxBytes, userAgent }) {
  return new Promise((resolve, reject) => {
    const client = url.protocol === 'https:' ? https : http;
    const req = client.request({
      protocol: url.protocol,
      hostname: url.hostname,
      port: url.port || undefined,
      path: `${url.pathname}${url.search}`,
      method: 'GET',
      servername: url.hostname,
      headers: {
        'User-Agent': userAgent,
        'Accept': 'text/plain,*/*;q=0.1',
        'Host': url.host,
      },
      lookup: createPinnedLookup(address),
    }, (res) => {
      const chunks = [];
      let bytes = 0;
      res.on('data', (chunk) => {
        bytes += chunk.length;
        if (bytes > maxBytes) {
          req.destroy(new Error(`robots.txt exceeds ${maxBytes} bytes`));
          return;
        }
        chunks.push(chunk);
      });
      res.on('end', () => resolve({
        status: res.statusCode ?? 0,
        headers: res.headers,
        text: Buffer.concat(chunks).toString('utf8'),
      }));
    });
    req.setTimeout(timeoutMs, () => req.destroy(new Error(`robots.txt timeout after ${timeoutMs}ms`)));
    req.on('error', reject);
    req.end();
  });
}

export async function fetchRobotsTxt(startUrl, options = {}) {
  const maxRedirects = options.maxRedirects ?? 3;
  const timeoutMs = options.timeoutMs ?? 10000;
  const maxBytes = options.maxBytes ?? 1024 * 1024;
  const userAgent = options.userAgent ?? 'MatboxComponentEngine/1.0';
  const resolver = options.resolver;

  let current = new URL('/robots.txt', startUrl);
  const redirects = [];
  for (let hop = 0; hop <= maxRedirects; hop++) {
    let validated;
    try {
      validated = await resolveAndValidateUrl(current.href, { resolver });
    } catch (error) {
      return { url: current.href, status: 0, fetched: false, text: '', sha256: null, redirects, error };
    }
    const address = validated.addresses[0];
    let response;
    try {
      response = await requestPinned(validated.url, address, { timeoutMs, maxBytes, userAgent });
    } catch (error) {
      return { url: current.href, status: 0, fetched: false, text: '', sha256: null, redirects, error };
    }
    if (response.status >= 300 && response.status < 400 && response.headers.location) {
      if (hop >= maxRedirects) {
        return { url: current.href, status: response.status, fetched: false, text: '', sha256: null, redirects, error: new Error('robots.txt redirect limit exceeded') };
      }
      const next = new URL(response.headers.location, current);
      redirects.push({ from: current.href, to: next.href, status: response.status });
      current = next;
      continue;
    }
    const text = response.text ?? '';
    return {
      url: current.href,
      status: response.status,
      fetched: response.status >= 200 && response.status < 300,
      text,
      sha256: text ? sha256(text) : null,
      redirects,
      error: null,
    };
  }
  throw new Error('Unreachable robots redirect state');
}
