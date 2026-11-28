import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import {
  loadRecoveredImageTargetFiles,
  loadVerifiedRecoveredImages,
  publishRecoveredImages,
} from '../scripts/lib/recovered-image-publisher.mjs';

test('recovered image publisher patches an arbitrary candidate replay root before component analysis', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'matbox-recovered-publish-'));
  const artifactRoot = path.join(root, 'artifacts');
  const replayRoot = path.join(root, 'candidate', 'replay');
  const cacheFile = path.join(root, 'image.cache');
  const source = 'https://source.example/image.png';
  await fs.mkdir(artifactRoot, { recursive: true });
  await fs.mkdir(replayRoot, { recursive: true });
  await fs.writeFile(cacheFile, `${source}\ndata:image/png;base64,iVBORw0KGgo=`, 'utf8');
  await fs.writeFile(path.join(artifactRoot, 'source-image-evidence-audit.json'), JSON.stringify({
    failures: [{ filename: 'page.html', source }],
  }), 'utf8');
  await fs.writeFile(path.join(artifactRoot, 'missing-image-cache-audit.json'), JSON.stringify({
    recovered: [{ targetSource: source, source, cacheFile, contentType: 'image/png', byteLength: 8 }],
  }), 'utf8');
  await fs.writeFile(path.join(replayRoot, 'page.html'), `<img src="${source}">`, 'utf8');

  const report = await publishRecoveredImages({ artifactRoot, distReplayRoot: replayRoot, writeReport: false });

  assert.equal(report.pass, true);
  assert.equal(report.replacements, 1);
  assert.match(await fs.readFile(path.join(replayRoot, 'page.html'), 'utf8'), /src="data:image\/png;base64,iVBORw0KGgo="/);
});

test('recovered image manifests remain portable after the project moves to another computer', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'matbox-recovered-portable-'));
  const artifactRoot = path.join(root, 'artifacts', 'component-geometry-migration');
  const cacheDir = path.join(root, 'artifacts', 'full-site-audit', 'persistent-resource-cache');
  const cacheFile = path.join(cacheDir, 'portable.resource');
  const source = 'https://source.example/portable.png';
  await fs.mkdir(artifactRoot, { recursive: true });
  await fs.mkdir(cacheDir, { recursive: true });
  await fs.writeFile(cacheFile, `${source}\ndata:image/png;base64,iVBORw0KGgo=`, 'utf8');
  await fs.writeFile(path.join(artifactRoot, 'missing-image-cache-audit.json'), JSON.stringify({
    recovered: [{
      targetSource: source,
      source,
      cacheFile: 'Z:\\old-machine\\artifacts\\full-site-audit\\persistent-resource-cache\\portable.resource',
      contentType: 'image/png',
      byteLength: 8,
    }],
  }), 'utf8');

  const recovered = await loadVerifiedRecoveredImages(artifactRoot);
  assert.equal(recovered.has(source), true);
});

test('recovered image target files include only pages backed by a verified recovery', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'matbox-recovered-targets-'));
  const artifactRoot = path.join(root, 'artifacts');
  const recoveredSource = 'https://source.example/recovered.png';
  const unresolvedSource = 'https://source.example/unresolved.png';
  await fs.mkdir(artifactRoot, { recursive: true });
  await fs.writeFile(path.join(artifactRoot, 'source-image-evidence-audit.json'), JSON.stringify({
    failures: [
      { filename: 'recovered-page.html', source: recoveredSource },
      { filename: 'unresolved-page.html', source: unresolvedSource },
    ],
  }), 'utf8');

  const targets = await loadRecoveredImageTargetFiles(artifactRoot, new Map([
    [recoveredSource, { dataUrl: 'data:image/png;base64,iVBORw0KGgo=' }],
  ]));

  assert.deepEqual([...targets], ['recovered-page.html']);
});
