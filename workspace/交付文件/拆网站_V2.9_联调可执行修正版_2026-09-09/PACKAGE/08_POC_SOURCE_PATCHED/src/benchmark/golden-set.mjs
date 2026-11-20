import { pairwiseClusteringMetrics } from './clustering-metrics.mjs';

const DEFAULT_GATES = {
  minCoverage: 0.98,
  minClusteringF1: 0.85,
  maxOverMergeRate: 0.05,
  maxUnderMergeRate: 0.12,
  minSemanticRoleAccuracy: 0.90,
  minVariantAccuracy: 0.80,
  minStateF1: 0.80,
  minSites: 0,
  minPerSiteCoverage: 0,
  minPerSiteClusteringF1: 0,
};

function safeDivide(a, b, fallback = 0) {
  return b === 0 ? fallback : a / b;
}

function candidateIdFor(instance) {
  const source = String(instance.sourceCandidateId ?? '');
  const prefix = `${instance.routeId}:`;
  return source.startsWith(prefix) ? source.slice(prefix.length) : source;
}

function setMetrics(goldValues, predictedValues) {
  const gold = new Set(goldValues ?? []);
  const predicted = new Set(predictedValues ?? []);
  let tp = 0;
  let fp = 0;
  let fn = 0;
  for (const value of predicted) {
    if (gold.has(value)) tp++;
    else fp++;
  }
  for (const value of gold) if (!predicted.has(value)) fn++;
  const precision = safeDivide(tp, tp + fp, 1);
  const recall = safeDivide(tp, tp + fn, 1);
  const f1 = safeDivide(2 * precision * recall, precision + recall, 0);
  return { tp, fp, fn, precision, recall, f1 };
}

function pairOpportunities(labels) {
  let same = 0;
  let different = 0;
  for (let i = 0; i < labels.length; i++) {
    for (let j = i + 1; j < labels.length; j++) {
      if (labels[i] === labels[j]) same++;
      else different++;
    }
  }
  return { same, different };
}

function buildPredictionIndex(ir) {
  const routePathById = new Map(ir.routes.map((route) => [route.id, route.path]));
  const familyById = new Map(ir.componentFamilies.map((family) => [family.id, family]));
  const byKey = new Map();
  for (const instance of ir.componentInstances) {
    const routePath = routePathById.get(instance.routeId);
    if (routePath == null) continue;
    const candidateId = candidateIdFor(instance);
    byKey.set(`${routePath}\u0000${candidateId}`, {
      instance,
      family: familyById.get(instance.familyId) ?? null,
      routePath,
      candidateId,
    });
  }
  return byKey;
}

export function createGoldenDraft(ir) {
  const routePathById = new Map(ir.routes.map((route) => [route.id, route.path]));
  const familyById = new Map(ir.componentFamilies.map((family) => [family.id, family]));
  const items = ir.componentInstances.map((instance) => {
    const family = familyById.get(instance.familyId) ?? {};
    return {
      routePath: routePathById.get(instance.routeId) ?? null,
      candidateId: candidateIdFor(instance),
      familyLabel: family.id ?? instance.familyId,
      familyName: family.canonicalName ?? null,
      semanticRole: family.semanticRole ?? null,
      variant: instance.variant ?? 'default',
      states: [...new Set(instance.availableStates ?? [instance.state ?? 'default'])],
      reviewStatus: 'unreviewed',
      notes: '',
    };
  }).sort((a, b) => `${a.routePath}\u0000${a.candidateId}`.localeCompare(`${b.routePath}\u0000${b.candidateId}`));

  return {
    version: '0.1',
    siteId: ir.site.id,
    sourceUrl: ir.site.sourceUrl,
    generatedAt: new Date().toISOString(),
    instructions: 'Review every item. Change familyLabel/semanticRole/variant/states to the human Gold answer and set reviewStatus=approved.',
    items,
  };
}


export function assertGoldenApproved(golden) {
  if (!golden || golden.version !== '0.1' || !Array.isArray(golden.items)) throw new Error('Invalid Golden annotation document');
  const pending = golden.items.filter((item) => item.reviewStatus !== 'approved');
  if (pending.length) {
    const preview = pending.slice(0, 5).map((item) => `${item.routePath ?? '?'}:${item.candidateId ?? '?'}`).join(', ');
    throw new Error(`Golden annotations must be human-approved before release scoring; ${pending.length} item(s) are not approved: ${preview}`);
  }
  return true;
}

export function evaluateGoldenSite({ ir, golden }) {
  if (!golden || golden.version !== '0.1' || !Array.isArray(golden.items)) throw new Error('Invalid Golden annotation document');
  const predicted = buildPredictionIndex(ir);
  const matched = [];
  const missingItems = [];

  for (const item of golden.items) {
    const prediction = predicted.get(`${item.routePath}\u0000${item.candidateId}`);
    if (!prediction) {
      missingItems.push({ routePath: item.routePath, candidateId: item.candidateId, familyLabel: item.familyLabel });
      continue;
    }
    matched.push({ item, ...prediction });
  }

  const goldLabels = matched.map(({ item }) => item.familyLabel);
  const predictedLabels = matched.map(({ instance }) => instance.familyId);
  const clustering = pairwiseClusteringMetrics(goldLabels, predictedLabels);
  const opportunities = pairOpportunities(goldLabels);

  let semanticCorrect = 0;
  let semanticTotal = 0;
  let variantCorrect = 0;
  let variantTotal = 0;
  let stateTp = 0;
  let stateFp = 0;
  let stateFn = 0;

  for (const match of matched) {
    if (match.item.semanticRole != null) {
      semanticTotal++;
      if (match.family?.semanticRole === match.item.semanticRole) semanticCorrect++;
    }
    if (match.item.variant != null) {
      variantTotal++;
      if ((match.instance.variant ?? 'default') === match.item.variant) variantCorrect++;
    }
    if (Array.isArray(match.item.states)) {
      const state = setMetrics(match.item.states, match.instance.availableStates ?? [match.instance.state ?? 'default']);
      stateTp += state.tp;
      stateFp += state.fp;
      stateFn += state.fn;
    }
  }

  const statePrecision = safeDivide(stateTp, stateTp + stateFp, 1);
  const stateRecall = safeDivide(stateTp, stateTp + stateFn, 1);
  const stateF1 = safeDivide(2 * statePrecision * stateRecall, statePrecision + stateRecall, 0);

  return {
    version: '0.1',
    siteId: golden.siteId ?? ir.site.id,
    sourceUrl: golden.sourceUrl ?? ir.site.sourceUrl,
    totalGoldenItems: golden.items.length,
    matchedItems: matched.length,
    coverage: safeDivide(matched.length, golden.items.length, 1),
    missingItems,
    clustering,
    semanticRoleAccuracy: safeDivide(semanticCorrect, semanticTotal, 1),
    variantAccuracy: safeDivide(variantCorrect, variantTotal, 1),
    state: {
      truePositiveStates: stateTp,
      falsePositiveStates: stateFp,
      falseNegativeStates: stateFn,
      precision: statePrecision,
      recall: stateRecall,
      f1: stateF1,
    },
    counts: {
      clustering: {
        tp: clustering.truePositivePairs,
        fp: clustering.falsePositivePairs,
        fn: clustering.falseNegativePairs,
        goldSamePairs: opportunities.same,
        goldDifferentPairs: opportunities.different,
      },
      semantic: { correct: semanticCorrect, total: semanticTotal },
      variant: { correct: variantCorrect, total: variantTotal },
      state: { tp: stateTp, fp: stateFp, fn: stateFn },
    },
  };
}

export function evaluateGoldenSuite(siteReports, gates = {}) {
  if (!Array.isArray(siteReports)) throw new Error('siteReports must be an array');
  const effectiveGates = { ...DEFAULT_GATES, ...gates };
  const totals = {
    golden: 0, matched: 0,
    clusterTp: 0, clusterFp: 0, clusterFn: 0, samePairs: 0, differentPairs: 0,
    semanticCorrect: 0, semanticTotal: 0,
    variantCorrect: 0, variantTotal: 0,
    stateTp: 0, stateFp: 0, stateFn: 0,
  };

  for (const report of siteReports) {
    totals.golden += report.totalGoldenItems ?? 0;
    totals.matched += report.matchedItems ?? 0;
    totals.clusterTp += report.counts?.clustering?.tp ?? 0;
    totals.clusterFp += report.counts?.clustering?.fp ?? 0;
    totals.clusterFn += report.counts?.clustering?.fn ?? 0;
    totals.samePairs += report.counts?.clustering?.goldSamePairs ?? 0;
    totals.differentPairs += report.counts?.clustering?.goldDifferentPairs ?? 0;
    totals.semanticCorrect += report.counts?.semantic?.correct ?? 0;
    totals.semanticTotal += report.counts?.semantic?.total ?? 0;
    totals.variantCorrect += report.counts?.variant?.correct ?? 0;
    totals.variantTotal += report.counts?.variant?.total ?? 0;
    totals.stateTp += report.counts?.state?.tp ?? 0;
    totals.stateFp += report.counts?.state?.fp ?? 0;
    totals.stateFn += report.counts?.state?.fn ?? 0;
  }

  const clusterPrecision = safeDivide(totals.clusterTp, totals.clusterTp + totals.clusterFp, 1);
  const clusterRecall = safeDivide(totals.clusterTp, totals.clusterTp + totals.clusterFn, 1);
  const clusterF1 = safeDivide(2 * clusterPrecision * clusterRecall, clusterPrecision + clusterRecall, 0);
  const statePrecision = safeDivide(totals.stateTp, totals.stateTp + totals.stateFp, 1);
  const stateRecall = safeDivide(totals.stateTp, totals.stateTp + totals.stateFn, 1);
  const stateF1 = safeDivide(2 * statePrecision * stateRecall, statePrecision + stateRecall, 0);

  const aggregate = {
    coverage: safeDivide(totals.matched, totals.golden, 1),
    clustering: {
      truePositivePairs: totals.clusterTp,
      falsePositivePairs: totals.clusterFp,
      falseNegativePairs: totals.clusterFn,
      precision: clusterPrecision,
      recall: clusterRecall,
      f1: clusterF1,
      overMergeRate: safeDivide(totals.clusterFp, totals.differentPairs, 0),
      underMergeRate: safeDivide(totals.clusterFn, totals.samePairs, 0),
    },
    semanticRoleAccuracy: safeDivide(totals.semanticCorrect, totals.semanticTotal, 1),
    variantAccuracy: safeDivide(totals.variantCorrect, totals.variantTotal, 1),
    state: { precision: statePrecision, recall: stateRecall, f1: stateF1 },
  };

  const failedGates = [];
  if (siteReports.length < effectiveGates.minSites) failedGates.push('siteCount');
  for (const site of siteReports) {
    if ((site.coverage ?? 0) < effectiveGates.minPerSiteCoverage) failedGates.push(`siteCoverage:${site.siteId ?? 'unknown'}`);
    if ((site.clustering?.f1 ?? 0) < effectiveGates.minPerSiteClusteringF1) failedGates.push(`siteClusteringF1:${site.siteId ?? 'unknown'}`);
  }
  if (aggregate.coverage < effectiveGates.minCoverage) failedGates.push('coverage');
  if (aggregate.clustering.f1 < effectiveGates.minClusteringF1) failedGates.push('clusteringF1');
  if (aggregate.clustering.overMergeRate > effectiveGates.maxOverMergeRate) failedGates.push('overMergeRate');
  if (aggregate.clustering.underMergeRate > effectiveGates.maxUnderMergeRate) failedGates.push('underMergeRate');
  if (aggregate.semanticRoleAccuracy < effectiveGates.minSemanticRoleAccuracy) failedGates.push('semanticRoleAccuracy');
  if (aggregate.variantAccuracy < effectiveGates.minVariantAccuracy) failedGates.push('variantAccuracy');
  if (aggregate.state.f1 < effectiveGates.minStateF1) failedGates.push('stateF1');

  return {
    version: '0.1',
    generatedAt: new Date().toISOString(),
    siteCount: siteReports.length,
    gates: effectiveGates,
    passed: failedGates.length === 0,
    failedGates,
    aggregate,
    sites: siteReports,
  };
}
