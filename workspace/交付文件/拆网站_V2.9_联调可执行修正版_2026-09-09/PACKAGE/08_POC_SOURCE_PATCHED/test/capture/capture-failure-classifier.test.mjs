import test from 'node:test';
import assert from 'node:assert/strict';
import { classifyCaptureFailure } from '../../src/capture/capture-failure-classifier.mjs';

test('capture failure classifier separates policy, timeout, DNS, auth wall, and browser failures', () => {
  assert.equal(classifyCaptureFailure(new Error('Blocked address 127.0.0.1: loopback')).category, 'security-policy');
  assert.equal(classifyCaptureFailure(new Error('Navigation timeout of 30000 ms exceeded')).category, 'timeout');
  assert.equal(classifyCaptureFailure(new Error('getaddrinfo ENOTFOUND example.invalid')).category, 'dns');
  assert.equal(classifyCaptureFailure(new Error('AUTH_WALL: login required')).category, 'auth-wall');
  assert.equal(classifyCaptureFailure(new Error('ERR_BLOCKED_BY_ADMINISTRATOR')).category, 'environment-policy');
});
