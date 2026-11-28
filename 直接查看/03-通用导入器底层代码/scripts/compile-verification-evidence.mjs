import fs from 'node:fs/promises';
import path from 'node:path';
import { compileVerificationEvidence } from './lib/verification-evidence-compiler.mjs';

const root = path.resolve(import.meta.dirname, '..');

function argumentsByName(argv = process.argv.slice(2)) {
  const values = new Map();
  for (const argument of argv) {
    if (!argument.startsWith('--') || !argument.includes('=')) continue;
    const [name, ...rest] = argument.slice(2).split('=');
    const entries = values.get(name) || [];
    entries.push(rest.join('='));
    values.set(name, entries);
  }
  return values;
}

function requiredArgument(values, name) {
  const value = values.get(name)?.at(-1);
  if (!value) throw new Error(`Missing --${name}=...`);
  return path.resolve(root, value);
}

async function readJson(filePath) {
  return JSON.parse(await fs.readFile(filePath, 'utf8'));
}

async function writeJson(filePath, value) {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
}

const args = argumentsByName();
const stage = requiredArgument(args, 'stage');
const auditRoot = path.join(root, 'artifacts', 'full-site-audit');
const responsivePatchPaths = (args.get('responsive-patch') || []).map((value) => path.resolve(root, value));
const interactionPatchPaths = (args.get('interaction-patch') || []).map((value) => path.resolve(root, value));

const [
  stageMarker,
  componentReport,
  editableAudit,
  routeClosure,
  responsiveBase,
  interactionBase,
  mutationReport,
  componentRegistry,
  pageCompositions,
  responsivePatches,
  interactionPatches,
] = await Promise.all([
  readJson(path.join(stage, 'UNVERIFIED-STAGING.json')),
  readJson(path.join(stage, 'component-library', 'component-report.json')),
  readJson(path.join(stage, 'component-library', 'editable-contract-audit.json')),
  readJson(requiredArgument(args, 'route-closure')),
  readJson(path.resolve(root, args.get('responsive-base')?.at(-1) || path.join(auditRoot, 'responsive-layout.json'))),
  readJson(path.resolve(root, args.get('interaction-base')?.at(-1) || path.join(auditRoot, 'interaction-click-audit.json'))),
  readJson(path.resolve(root, args.get('mutations')?.at(-1) || path.join(root, 'artifacts', 'dynamic-component-verification', 'report.json'))),
  readJson(path.join(stage, 'component-library', 'component-registry.json')),
  readJson(path.join(stage, 'component-library', 'page-compositions.json')),
  Promise.all(responsivePatchPaths.map(readJson)),
  Promise.all(interactionPatchPaths.map(readJson)),
]);

const compiled = compileVerificationEvidence({
  stageMarker,
  componentReport,
  editableAudit,
  routeClosure,
  responsiveBase,
  responsivePatches,
  interactionBase,
  interactionPatches,
  mutationReport,
  componentRegistry,
  pageCompositions,
});

const reportPath = path.join(auditRoot, 'compiled-verification-evidence.json');
await writeJson(reportPath, {
  generatedAt: new Date().toISOString(),
  pass: compiled.pass,
  failures: compiled.failures,
  summary: compiled.summary,
  inputs: {
    stage,
    responsivePatches: responsivePatchPaths,
    interactionPatches: interactionPatchPaths,
  },
});

if (!compiled.pass) {
  console.error(JSON.stringify({ pass: false, failures: compiled.failures.slice(0, 100), reportPath }, null, 2));
  process.exitCode = 1;
} else {
  const unitRoot = path.join(root, 'artifacts', 'unit-verification');
  const pageRoot = path.join(root, 'artifacts', 'page-verification');
  await fs.rm(unitRoot, { recursive: true, force: true });
  await fs.rm(pageRoot, { recursive: true, force: true });
  await fs.mkdir(unitRoot, { recursive: true });
  await fs.mkdir(pageRoot, { recursive: true });
  await Promise.all(Object.entries(compiled.unitEvidenceById).map(([componentId, evidence]) => (
    writeJson(path.join(unitRoot, `${encodeURIComponent(componentId)}.json`), evidence)
  )));
  await Promise.all(Object.entries(compiled.pageEvidenceByRoute).map(([route, evidence]) => (
    writeJson(path.join(pageRoot, `${encodeURIComponent(route)}.json`), evidence)
  )));
  console.log(JSON.stringify({ pass: true, ...compiled.summary, reportPath }, null, 2));
}
