import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const sourceRoots = ['scripts', 'src', 'tests'];

async function collectModuleFiles(directory) {
  const entries = await fs.readdir(directory, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    if (entry.name === 'replay' && path.basename(directory) === 'src') continue;
    const absolute = path.join(directory, entry.name);
    if (entry.isDirectory()) files.push(...await collectModuleFiles(absolute));
    else if (/\.(?:mjs|cjs|js)$/.test(entry.name)) files.push(absolute);
  }
  return files;
}

function relativeModuleSpecifiers(source) {
  const matches = [];
  const patterns = [
    /\b(?:from|import)\s*\(?\s*['"](\.{1,2}\/[^'"]+)['"]\s*\)?/g,
    /\bnew\s+URL\(\s*['"](\.{1,2}\/[^'"]+)['"]\s*,\s*import\.meta\.url\s*\)/g,
  ];
  for (const pattern of patterns) {
    for (const match of source.matchAll(pattern)) matches.push(match[1]);
  }
  return matches;
}

function bareModuleSpecifiers(source) {
  const matches = [];
  const patterns = [
    /^\s*import\s+(?:[^'"\n]+\s+from\s+)?['"](?!node:|\.{0,2}\/)([^'"/]+)(?:\/[^'"]*)?['"]/gm,
    /^\s*export\s+[^'"\n]+\s+from\s+['"](?!node:|\.{0,2}\/)([^'"/]+)(?:\/[^'"]*)?['"]/gm,
    /\bimport\(\s*['"](?!node:|\.{0,2}\/)([^'"/]+)(?:\/[^'"]*)?['"]\s*\)/g,
  ];
  for (const pattern of patterns) {
    for (const match of source.matchAll(pattern)) matches.push(match[1]);
  }
  return matches;
}

test('all source and test file dependencies stay inside the Coco project', async () => {
  const files = (await Promise.all(
    sourceRoots.map((directory) => collectModuleFiles(path.join(projectRoot, directory))),
  )).flat();
  const escapes = [];

  for (const file of files) {
    const source = await fs.readFile(file, 'utf8');
    for (const specifier of relativeModuleSpecifiers(source)) {
      const resolved = path.resolve(path.dirname(file), specifier);
      const relative = path.relative(projectRoot, resolved);
      if (relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) {
        escapes.push({ file: path.relative(projectRoot, file), specifier, resolved });
      }
    }
  }

  assert.deepEqual(escapes, []);
});

test('all third-party module imports are declared in package.json', async () => {
  const manifest = JSON.parse(await fs.readFile(path.join(projectRoot, 'package.json'), 'utf8'));
  const declared = new Set([
    ...Object.keys(manifest.dependencies ?? {}),
    ...Object.keys(manifest.devDependencies ?? {}),
  ]);
  const files = (await Promise.all(
    sourceRoots.map((directory) => collectModuleFiles(path.join(projectRoot, directory))),
  )).flat();
  const missing = new Set();

  for (const file of files) {
    const source = await fs.readFile(file, 'utf8');
    for (const specifier of bareModuleSpecifiers(source)) {
      if (!declared.has(specifier)) missing.add(specifier);
    }
  }

  assert.deepEqual([...missing].sort(), []);
});
