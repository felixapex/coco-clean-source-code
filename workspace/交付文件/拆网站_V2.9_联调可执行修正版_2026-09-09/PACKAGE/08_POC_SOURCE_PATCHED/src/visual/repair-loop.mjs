import { comparePngBuffers, buildVisualRepairTask } from './image-diff.mjs';

export async function runVisualRepairLoop({
  routeId,
  referencePng,
  threshold = 0.98,
  maxIterations = 3,
  initialRevision,
  renderRevision,
  repairRevision,
  onRepairTask = null,
  restoreRevision = null,
  compareFn = comparePngBuffers,
  referenceEvidenceId = null,
}) {
  if (!referencePng) throw new Error('referencePng is required');
  if (!initialRevision) throw new Error('initialRevision is required');
  if (typeof renderRevision !== 'function') throw new Error('renderRevision is required');
  if (typeof repairRevision !== 'function') throw new Error('repairRevision is required');
  if (!(maxIterations >= 0)) throw new Error('maxIterations must be >= 0');

  const history = [];
  let currentRevision = initialRevision;
  let bestRevision = null;
  let bestSimilarity = -1;

  async function evaluate(revision, iteration) {
    const rendered = await renderRevision(revision);
    if (!rendered?.screenshot) throw new Error(`Revision ${revision?.id ?? '?'} did not produce a screenshot`);
    const diff = await compareFn(referencePng, rendered.screenshot);
    const entry = {
      iteration,
      revisionId: revision?.id ?? null,
      artifact: rendered.artifact ?? revision?.artifact ?? null,
      similarity: diff.similarity,
      normalizedRmse: diff.normalizedRmse,
    };
    history.push(entry);
    if (entry.similarity > bestSimilarity) {
      bestSimilarity = entry.similarity;
      bestRevision = revision;
    }
    return { rendered, diff, entry };
  }

  let evaluation = await evaluate(currentRevision, 0);
  if (evaluation.entry.similarity >= threshold) {
    return { status: 'passed', threshold, bestSimilarity, bestRevision, history };
  }

  for (let iteration = 1; iteration <= maxIterations; iteration++) {
    const task = buildVisualRepairTask({
      routeId,
      similarity: evaluation.entry.similarity,
      threshold,
      referenceEvidenceId,
      generatedArtifact: evaluation.entry.artifact,
    });
    const repairContext = {
      task,
      previousRevision: currentRevision,
      history: [...history],
      iteration,
    };
    if (typeof onRepairTask === 'function') {
      await onRepairTask(repairContext);
    }
    const nextRevision = await repairRevision(repairContext);
    if (!nextRevision) {
      return { status: 'stalled', threshold, bestSimilarity, bestRevision, history };
    }
    const previousSimilarity = evaluation.entry.similarity;
    currentRevision = nextRevision;
    evaluation = await evaluate(currentRevision, iteration);
    if (evaluation.entry.similarity >= threshold) {
      return { status: 'passed', threshold, bestSimilarity, bestRevision, history };
    }
    if (evaluation.entry.similarity <= previousSimilarity) {
      if (typeof restoreRevision === 'function' && bestRevision && bestRevision !== currentRevision) {
        await restoreRevision(bestRevision, { currentRevision, history: [...history] });
      }
      return { status: 'stalled', threshold, bestSimilarity, bestRevision, history };
    }
  }

  return { status: 'exhausted', threshold, bestSimilarity, bestRevision, history };
}
