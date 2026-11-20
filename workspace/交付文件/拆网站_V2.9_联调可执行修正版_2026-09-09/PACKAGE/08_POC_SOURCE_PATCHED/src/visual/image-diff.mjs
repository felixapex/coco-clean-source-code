import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { PNG } from 'pngjs';

function clamp01(value) {
  return Math.max(0, Math.min(1, value));
}

export async function comparePngBuffers(reference, candidate, options = {}) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'component-image-diff-'));
  const referencePath = path.join(dir, 'reference.png');
  const candidatePath = path.join(dir, 'candidate.png');
  try {
    await fs.writeFile(referencePath, reference);
    await fs.writeFile(candidatePath, candidate);
    const left = PNG.sync.read(reference);
    const right = PNG.sync.read(candidate);
    if (left.width !== right.width || left.height !== right.height) {
      throw new Error(`Image size mismatch: ${left.width}x${left.height} != ${right.width}x${right.height}`);
    }
    const diff = new PNG({ width: left.width, height: left.height });
    let squaredError = 0;
    const channelCount = left.width * left.height * 3;
    for (let index = 0; index < left.data.length; index += 4) {
      for (let channel = 0; channel < 3; channel += 1) {
        const delta = left.data[index + channel] - right.data[index + channel];
        squaredError += delta * delta;
        diff.data[index + channel] = Math.abs(delta);
      }
      diff.data[index + 3] = 255;
    }
    const normalizedRmse = Math.sqrt(squaredError / channelCount) / 255;
    const raw = `RMSE (${normalizedRmse})`;
    return {
      metric: 'rmse',
      normalizedRmse,
      similarity: clamp01(1 - normalizedRmse),
      raw,
      diffImage: options.includeDiffImage === true ? PNG.sync.write(diff) : undefined,
    };
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
}

export function buildVisualRepairTask({ routeId, similarity, threshold = 0.92, referenceEvidenceId, generatedArtifact }) {
  if (similarity >= threshold) return null;
  return {
    kind: 'visual-fidelity-repair',
    routeId,
    similarity,
    threshold,
    referenceEvidenceId,
    generatedArtifact,
    allowedScopes: ['generated-react', 'generated-css'],
    forbiddenScopes: ['component-ir', 'crawler', 'provider-adapters', 'deployment'],
    instructions: [
      'Use the reference screenshot and Component IR evidence to reduce visual differences.',
      'Prefer CSS/token/layout corrections before changing component markup.',
      'Do not change Component IR architecture, component family identity, props, variants, or states.',
      'Do not add network calls, secrets, deployment actions, or unrelated dependencies.',
      'Re-render the same route and re-run the visual regression gate after each repair.',
    ],
  };
}
