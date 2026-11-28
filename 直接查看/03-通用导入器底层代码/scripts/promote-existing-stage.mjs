import fs from 'node:fs/promises';
import path from 'node:path';

import { promoteExistingStage } from './lib/existing-stage-promotion.mjs';

const root = process.cwd();
const stageArgument = process.argv.find((item) => item.startsWith('--stage='))?.slice('--stage='.length);
if (!stageArgument) {
  throw new Error('Usage: node scripts/promote-existing-stage.mjs --stage=<verified-stage-directory>');
}
const stageDir = path.resolve(root, stageArgument);
const readJson = async (filename) => JSON.parse(await fs.readFile(filename, 'utf8'));
const [
  stageStatus,
  checkpointIntegrity,
  editableContractAudit,
  routeLinkAudit,
  imageRecoveryBlockers,
  validationIssues,
  componentRegistry,
  pageCompositions,
] = await Promise.all([
  readJson(path.join(stageDir, 'UNVERIFIED-STAGING.json')),
  readJson(path.join(root, 'artifacts', 'full-site-audit', 'build-checkpoint-integrity-final.json')),
  readJson(path.join(root, 'artifacts', 'full-site-audit', 'editable-contract-audit.json')),
  readJson(path.join(root, 'artifacts', 'full-site-audit', 'route-link-audit.json')),
  readJson(path.join(root, 'artifacts', 'component-geometry-migration', 'image-recovery-blockers.json')),
  readJson(path.join(root, 'artifacts', 'full-site-audit', 'validation-issues.json')),
  readJson(path.join(stageDir, 'component-library', 'component-registry.json')),
  readJson(path.join(stageDir, 'component-library', 'page-compositions.json')),
]);

const result = await promoteExistingStage({
  stageDir,
  acceptedDir: path.join(root, 'dist'),
  evidence: {
    stageStatus,
    checkpointIntegrity,
    editableContractAudit,
    routeLinkAudit,
    imageRecoveryBlockers,
    validationIssues,
    componentRegistry,
    pageCompositions,
  },
});
console.log(JSON.stringify(result, null, 2));
if (!result.pass || !result.promoted) process.exitCode = 1;
