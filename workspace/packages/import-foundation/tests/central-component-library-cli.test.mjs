import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

const executeFile = promisify(execFile);
const testDirectory = path.dirname(fileURLToPath(import.meta.url));
const cliPath = path.resolve(testDirectory, '../../../scripts/register-central-component-library.mjs');

function candidate() {
  return {
    componentTypeId: 'hero-banner',
    componentInstanceId: 'home-hero',
    platformComponentId: null,
    platformPageId: '1111111111111111',
    sourceComponentName: 'hero-banner',
    actualFunctionName: '首屏横幅',
    nameMatchStatus: 'matched',
    schema: { name: '首屏横幅', settings: [], blocks: [{ type: '@theme' }], presets: [{ name: '首屏横幅' }] },
    functionFingerprint: 'fn:hero',
    structureInteractionFingerprint: 'si:hero',
    responsiveFingerprint: 'rsp:wide',
    classification: 'new',
    sourceEvidence: [{ id: 'source:home', route: '/' }],
    version: '1.0.0',
    settings: {},
  };
}

test('CLI refuses to allocate legacy permanent component IDs before Coco V1 is confirmed', async (t) => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'matbox-component-cli-'));
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  const foundationPath = path.join(directory, 'foundation.json');
  const libraryPath = path.join(directory, 'library.json');
  const reportPath = path.join(directory, 'report.json');
  await fs.writeFile(foundationPath, JSON.stringify({
    platform: 'web',
    importRunId: 'run-1',
    pages: [{
      route: '/',
      pageIdentity: { platformPageId: '1111111111111111', sourceUrl: 'https://example.test/' },
      components: [candidate()],
    }],
  }), 'utf8');

  await assert.rejects(
    executeFile(process.execPath, [
      cliPath,
      '--foundation', foundationPath,
      '--library', libraryPath,
      '--report', reportPath,
      '--site-id', 'site-example',
    ]),
    /COMPONENT_LIBRARY_ALLOCATION_BLOCKED: coco-v1-pending/,
  );
  await assert.rejects(fs.access(libraryPath));
  await assert.rejects(fs.access(reportPath));
});
