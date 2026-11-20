import fs from 'node:fs/promises';
import path from 'node:path';

import {
  loadComponentLibrary,
  registerImportFoundationCandidates,
  saveComponentLibrary,
} from '../packages/import-foundation/central-component-library.mjs';

function parseArguments(argv) {
  const values = {};
  for (let index = 0; index < argv.length; index += 1) {
    const key = argv[index];
    if (!key.startsWith('--')) throw new TypeError(`Unexpected argument: ${key}`);
    const value = argv[index + 1];
    if (!value || value.startsWith('--')) throw new TypeError(`${key} requires a value`);
    values[key.slice(2)] = value;
    index += 1;
  }
  for (const required of ['foundation', 'library', 'report', 'site-id']) {
    if (!values[required]) throw new TypeError(`--${required} is required`);
  }
  return values;
}

async function writeJsonAtomically(filePath, value) {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  const temporaryPath = `${filePath}.tmp-${process.pid}-${Date.now()}`;
  try {
    await fs.writeFile(temporaryPath, `${JSON.stringify(value, null, 2)}\n`, { encoding: 'utf8', flag: 'wx' });
    await fs.rename(temporaryPath, filePath);
  } catch (error) {
    await fs.rm(temporaryPath, { force: true }).catch(() => {});
    throw error;
  }
}

async function main() {
  const options = parseArguments(process.argv.slice(2));
  const foundation = JSON.parse(await fs.readFile(options.foundation, 'utf8'));
  const currentLibrary = await loadComponentLibrary(options.library);
  const registered = registerImportFoundationCandidates(foundation, currentLibrary, {
    siteId: options['site-id'],
    sourceArtifactRef: path.resolve(options.foundation),
  });
  await saveComponentLibrary(options.library, registered.library);
  const report = {
    schemaVersion: 1,
    siteId: options['site-id'],
    platform: foundation.platform ?? null,
    importRunId: foundation.importRunId ?? null,
    summary: registered.summary,
    assignments: registered.assignments,
  };
  await writeJsonAtomically(options.report, report);
  process.stdout.write(`${JSON.stringify({
    libraryPath: path.resolve(options.library),
    reportPath: path.resolve(options.report),
    summary: registered.summary,
  })}\n`);
}

main().catch((error) => {
  process.stderr.write(`${error.stack || error.message}\n`);
  process.exitCode = 1;
});

