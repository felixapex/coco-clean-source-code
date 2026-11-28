import fs from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { reclassifyComponentDossiers } from '../src/import-foundation/index.mjs';

function parseArgs(argv) {
  const options = {};
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === '--input') options.input = argv[++index];
    else if (argument === '--report') options.report = argv[++index];
    else throw new Error(`Unknown argument: ${argument}`);
  }
  if (!options.input) throw new Error('--input is required');
  return options;
}

function sha256(buffer) {
  return createHash('sha256').update(buffer).digest('hex');
}

async function writeJsonObjectStreaming(filePath, value) {
  const handle = await fs.open(filePath, 'w');
  try {
    await handle.write('{\n');
    const entries = Object.entries(value);
    for (let index = 0; index < entries.length; index += 1) {
      const [key, child] = entries[index];
      await handle.write(`  ${JSON.stringify(key)}: `);
      if (Array.isArray(child)) {
        await handle.write('[\n');
        for (let itemIndex = 0; itemIndex < child.length; itemIndex += 1) {
          await handle.write(`    ${JSON.stringify(child[itemIndex])}${itemIndex + 1 < child.length ? ',' : ''}\n`);
        }
        await handle.write('  ]');
      } else {
        await handle.write(JSON.stringify(child, null, 2).replace(/\n/g, '\n  '));
      }
      await handle.write(index + 1 < entries.length ? ',\n' : '\n');
    }
    await handle.write('}\n');
  } finally {
    await handle.close();
  }
}

export async function reclassifyImportFoundationFile({ input, report }) {
  const inputPath = path.resolve(input);
  const reportPath = path.resolve(report ?? path.join(path.dirname(inputPath), 'component-reuse-report.json'));
  const temporaryPath = `${inputPath}.tmp-${process.pid}`;
  const backupPath = `${inputPath}.before-schema-fingerprint.json`;
  const originalBuffer = await fs.readFile(inputPath);
  const document = JSON.parse(originalBuffer.toString('utf8'));
  const result = reclassifyComponentDossiers(document.componentLibrary ?? []);
  document.componentLibrary = result.components;

  const relations = result.components
    .filter((component) => component.classification !== 'new')
    .map((component) => ({
      componentInstanceId: component.componentInstanceId,
      componentTypeId: component.componentTypeId,
      classification: component.classification,
      matchedComponentTypeId: component.matchedComponentTypeId,
      route: component.sourceEvidence?.[0]?.route ?? null,
      sourceSectionId: component.sourceEvidence?.[0]?.sourceSectionId ?? null,
      functionFingerprint: component.functionFingerprint,
      structureInteractionFingerprint: component.structureInteractionFingerprint,
      responsiveFingerprint: component.responsiveFingerprint,
      schemaFingerprint: component.schemaFingerprint,
    }));
  const reportDocument = {
    schemaVersion: 1,
    sourceFile: inputPath,
    sourceSha256: sha256(originalBuffer),
    ...result.report,
    relations,
  };

  try {
    await writeJsonObjectStreaming(temporaryPath, document);
    const verification = JSON.parse(await fs.readFile(temporaryPath, 'utf8'));
    if (verification.componentLibrary?.length !== result.components.length) {
      throw new Error('Reclassified component count changed during serialization');
    }
    await fs.rm(backupPath, { force: true });
    await fs.rename(inputPath, backupPath);
    try {
      await fs.rename(temporaryPath, inputPath);
    } catch (error) {
      await fs.rename(backupPath, inputPath);
      throw error;
    }
    await fs.mkdir(path.dirname(reportPath), { recursive: true });
    await fs.writeFile(reportPath, `${JSON.stringify(reportDocument, null, 2)}\n`, 'utf8');
    return { inputPath, backupPath, reportPath, ...result.report };
  } finally {
    await fs.rm(temporaryPath, { force: true });
  }
}

const isMain = process.argv[1]
  && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url;
if (isMain) {
  const options = parseArgs(process.argv.slice(2));
  const result = await reclassifyImportFoundationFile(options);
  console.log(JSON.stringify(result, null, 2));
}
