import test from 'node:test';
import assert from 'node:assert/strict';
import { classifyIp, validateUrlSyntax, resolveAndValidateUrl } from '../../src/security/url-policy.mjs';

test('validateUrlSyntax allows http and https only', () => {
  assert.equal(validateUrlSyntax('https://example.com/a').protocol, 'https:');
  assert.throws(() => validateUrlSyntax('file:///etc/passwd'), /unsupported scheme/i);
  assert.throws(() => validateUrlSyntax('gopher://example.com'), /unsupported scheme/i);
});

test('classifyIp blocks loopback private link-local and metadata targets', () => {
  for (const ip of ['127.0.0.1','10.0.0.1','172.16.2.3','192.168.1.2','169.254.169.254','::1','fc00::1','fe80::1']) {
    assert.equal(classifyIp(ip).blocked, true, ip);
  }
});

test('classifyIp allows representative public IPs', () => {
  assert.equal(classifyIp('8.8.8.8').blocked, false);
  assert.equal(classifyIp('2606:4700:4700::1111').blocked, false);
});

test('resolveAndValidateUrl rejects a hostname resolving to private address', async () => {
  const resolver = async () => [{ address: '10.1.2.3', family: 4 }];
  await assert.rejects(
    resolveAndValidateUrl('https://safe-looking.example/', { resolver }),
    /blocked address/i
  );
});

test('resolveAndValidateUrl accepts a hostname resolving only to public addresses', async () => {
  const resolver = async () => [{ address: '93.184.216.34', family: 4 }];
  const result = await resolveAndValidateUrl('https://example.com/', { resolver });
  assert.deepEqual(result.addresses, ['93.184.216.34']);
});
