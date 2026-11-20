import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeTools, capabilityHash, buildCapabilitySnapshot } from '../../src/providers/capabilities.mjs';

const toolsA = [
  { name: 'get_screen', inputSchema: { type: 'object', properties: { id: { type: 'string' } } }, outputSchema: { type: 'object' } },
  { name: 'generate_screen_from_text', inputSchema: { type: 'object', properties: { prompt: { type: 'string' } } }, outputSchema: { type: 'object' } },
];

test('capability hash is stable regardless of tool ordering and schema key ordering', () => {
  const toolsB = [
    { name: 'generate_screen_from_text', outputSchema: { type: 'object' }, inputSchema: { properties: { prompt: { type: 'string' } }, type: 'object' } },
    { name: 'get_screen', outputSchema: { type: 'object' }, inputSchema: { properties: { id: { type: 'string' } }, type: 'object' } },
  ];
  assert.equal(capabilityHash(toolsA), capabilityHash(toolsB));
});

test('capability hash changes when a tool schema changes', () => {
  const changed = structuredClone(toolsA);
  changed[0].inputSchema.properties.projectId = { type: 'string' };
  assert.notEqual(capabilityHash(toolsA), capabilityHash(changed));
});

test('buildCapabilitySnapshot records provider version names and hash', () => {
  const snapshot = buildCapabilitySnapshot('google-stitch', '0.1.1', toolsA);
  assert.equal(snapshot.provider, 'google-stitch');
  assert.equal(snapshot.version, '0.1.1');
  assert.deepEqual(snapshot.toolNames, ['generate_screen_from_text','get_screen']);
  assert.match(snapshot.hash, /^[a-f0-9]{64}$/);
});
