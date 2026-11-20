import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createIsolatedProjectWorkspace } from '../../src/pipeline/project-workspace.mjs';

test('each URL run creates a new isolated project without overwriting the previous run', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'matbox-projects-'));
  try {
    const now = new Date('2026-10-14T12:34:56.789Z');
    const first = await createIsolatedProjectWorkspace({ projectsRoot: root, sourceUrl: 'https://Example.com/shop', now });
    await fs.writeFile(path.join(first.projectRoot, 'keep.txt'), 'first');
    const second = await createIsolatedProjectWorkspace({ projectsRoot: root, sourceUrl: 'https://Example.com/shop', now });

    assert.notEqual(first.projectRoot, second.projectRoot);
    assert.equal(await fs.readFile(path.join(first.projectRoot, 'keep.txt'), 'utf8'), 'first');
    assert.match(path.basename(first.projectRoot), /^example-com-20261014-123456-789$/);
    assert.match(path.basename(second.projectRoot), /^example-com-20261014-123456-789-02$/);
    const metadata = JSON.parse(await fs.readFile(path.join(second.projectRoot, 'project.json'), 'utf8'));
    assert.equal(metadata.sourceUrl, 'https://example.com/shop');
    assert.equal(metadata.projectId, path.basename(second.projectRoot));
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});

test('project root must be explicit and source URL must be http or https', async () => {
  await assert.rejects(() => createIsolatedProjectWorkspace({ sourceUrl: 'https://example.com' }), /projectsRoot is required/);
  await assert.rejects(() => createIsolatedProjectWorkspace({ projectsRoot: 'x', sourceUrl: 'file:\/\/\/tmp\/x' }), /http or https/);
});
