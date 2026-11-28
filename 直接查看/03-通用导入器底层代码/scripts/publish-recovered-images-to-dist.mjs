import path from 'node:path';
import { publishRecoveredImages } from './lib/recovered-image-publisher.mjs';

const root = path.resolve(import.meta.dirname, '..');
const artifactRoot = path.join(root, 'artifacts', 'component-geometry-migration');
const distReplayRoot = path.join(root, 'dist', 'replay');
const reportPath = path.join(artifactRoot, 'publish-recovered-images-to-dist.json');
const report = await publishRecoveredImages({ artifactRoot, distReplayRoot, reportPath });
process.stdout.write(`${JSON.stringify({ ...report, changedFiles: undefined, remaining: report.remaining.slice(0, 10), reportPath }, null, 2)}\n`);
if (!report.pass) process.exitCode = 2;
