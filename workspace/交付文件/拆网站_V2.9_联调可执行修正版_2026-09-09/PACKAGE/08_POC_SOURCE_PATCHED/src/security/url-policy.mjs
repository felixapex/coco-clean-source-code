import dns from 'node:dns/promises';
import net from 'node:net';

const ALLOWED_SCHEMES = new Set(['http:', 'https:']);

function ipv4Parts(ip) {
  return ip.split('.').map(Number);
}

function classifyIpv4(ip) {
  const [a,b] = ipv4Parts(ip);
  if (a === 127) return 'loopback';
  if (a === 10) return 'private';
  if (a === 172 && b >= 16 && b <= 31) return 'private';
  if (a === 192 && b === 168) return 'private';
  if (a === 169 && b === 254) return ip === '169.254.169.254' ? 'cloud-metadata' : 'link-local';
  if (a === 0) return 'unspecified/reserved';
  if (a >= 224) return 'multicast/reserved';
  if (a === 100 && b >= 64 && b <= 127) return 'carrier-grade-nat';
  if (a === 192 && b === 0) return 'reserved';
  if (a === 198 && (b === 18 || b === 19)) return 'benchmark';
  return null;
}

function normalizeIpv6(ip) {
  return ip.toLowerCase().split('%')[0];
}

function classifyIpv6(ip) {
  const v = normalizeIpv6(ip);
  if (v === '::1') return 'loopback';
  if (v === '::') return 'unspecified/reserved';
  if (v.startsWith('fe8') || v.startsWith('fe9') || v.startsWith('fea') || v.startsWith('feb')) return 'link-local';
  if (v.startsWith('fc') || v.startsWith('fd')) return 'private';
  if (v.startsWith('ff')) return 'multicast';
  if (v.startsWith('2001:db8:')) return 'documentation';
  if (v.startsWith('::ffff:')) {
    const mapped = v.slice('::ffff:'.length);
    if (net.isIP(mapped) === 4) return classifyIpv4(mapped);
  }
  return null;
}

export function classifyIp(ip) {
  const family = net.isIP(ip);
  if (!family) return { blocked: true, reason: 'invalid-ip' };
  const reason = family === 4 ? classifyIpv4(ip) : classifyIpv6(ip);
  return { blocked: Boolean(reason), reason };
}

export function validateUrlSyntax(rawUrl) {
  let url;
  try {
    url = new URL(rawUrl);
  } catch {
    throw new Error('Invalid URL');
  }
  if (!ALLOWED_SCHEMES.has(url.protocol)) {
    throw new Error(`Unsupported scheme: ${url.protocol}`);
  }
  if (!url.hostname) throw new Error('URL hostname is required');
  if (url.username || url.password) throw new Error('Credentials in URL are not allowed');
  return url;
}

export async function resolveAndValidateUrl(rawUrl, options = {}) {
  const url = validateUrlSyntax(rawUrl);
  const resolver = options.resolver ?? ((hostname) => dns.lookup(hostname, { all: true, verbatim: true }));
  const literalFamily = net.isIP(url.hostname);
  const records = literalFamily
    ? [{ address: url.hostname, family: literalFamily }]
    : await resolver(url.hostname);
  if (!Array.isArray(records) || records.length === 0) throw new Error('DNS returned no addresses');
  const addresses = [];
  for (const record of records) {
    const ip = typeof record === 'string' ? record : record.address;
    const verdict = classifyIp(ip);
    if (verdict.blocked) throw new Error(`Blocked address ${ip}: ${verdict.reason}`);
    addresses.push(ip);
  }
  return { url, addresses };
}
