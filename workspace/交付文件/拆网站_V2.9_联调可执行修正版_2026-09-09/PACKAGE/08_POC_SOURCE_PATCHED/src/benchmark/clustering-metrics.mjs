function safeDivide(a, b, defaultValue = 0) {
  return b === 0 ? defaultValue : a / b;
}

export function pairwiseClusteringMetrics(goldLabels, predictedLabels) {
  if (!Array.isArray(goldLabels) || !Array.isArray(predictedLabels) || goldLabels.length !== predictedLabels.length) {
    throw new Error('goldLabels and predictedLabels must be arrays of equal length');
  }

  let tp = 0;
  let fp = 0;
  let fn = 0;
  let trueDifferentPairs = 0;
  let goldSamePairs = 0;

  for (let i = 0; i < goldLabels.length; i++) {
    for (let j = i + 1; j < goldLabels.length; j++) {
      const goldSame = goldLabels[i] === goldLabels[j];
      const predSame = predictedLabels[i] === predictedLabels[j];
      if (goldSame) goldSamePairs++;
      else trueDifferentPairs++;

      if (goldSame && predSame) tp++;
      else if (!goldSame && predSame) fp++;
      else if (goldSame && !predSame) fn++;
    }
  }

  const precision = safeDivide(tp, tp + fp, 1);
  const recall = safeDivide(tp, tp + fn, 1);
  const f1 = safeDivide(2 * precision * recall, precision + recall, 0);

  return {
    truePositivePairs: tp,
    falsePositivePairs: fp,
    falseNegativePairs: fn,
    precision,
    recall,
    f1,
    overMergeRate: safeDivide(fp, trueDifferentPairs, 0),
    underMergeRate: safeDivide(fn, goldSamePairs, 0),
  };
}
