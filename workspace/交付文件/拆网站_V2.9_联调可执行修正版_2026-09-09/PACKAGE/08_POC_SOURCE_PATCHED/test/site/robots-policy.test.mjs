import test from 'node:test';
import assert from 'node:assert/strict';
import { parseRobotsTxt, isRobotsAllowed } from '../../src/site/robots-policy.mjs';

const robots = `
User-agent: *
Disallow: /private/
Disallow: /search?*
Allow: /private/public$

User-agent: MatboxComponentEngine
Disallow: /engine-blocked
Allow: /
`;

test('robots parser uses named user-agent group and longest matching rule', () => {
  const parsed = parseRobotsTxt(robots);
  assert.equal(isRobotsAllowed(parsed, 'https://example.com/home', 'MatboxComponentEngine'), true);
  assert.equal(isRobotsAllowed(parsed, 'https://example.com/engine-blocked', 'MatboxComponentEngine'), false);
  assert.equal(isRobotsAllowed(parsed, 'https://example.com/private/secret', 'OtherBot'), false);
  assert.equal(isRobotsAllowed(parsed, 'https://example.com/private/public', 'OtherBot'), true);
});

test('robots wildcards can block matching query paths', () => {
  const parsed = parseRobotsTxt(robots);
  assert.equal(isRobotsAllowed(parsed, 'https://example.com/search?q=sofa', 'OtherBot'), false);
});
