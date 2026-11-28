const TRACKING_PARAMETERS = /^(?:utm_.+|gclid|fbclid|msclkid|srsltid|_ga|ref|source)$/i;

function normalizedText(value) {
  return String(value || '').replace(/\s+/g, ' ').trim().toLowerCase();
}

function normalizedTarget(value) {
  if (!value) return '';
  try {
    const url = new URL(String(value), 'https://interaction.invalid');
    const parameters = [...url.searchParams.entries()]
      .filter(([name]) => !TRACKING_PARAMETERS.test(name))
      .sort(([leftName, leftValue], [rightName, rightValue]) => (
        leftName.localeCompare(rightName) || leftValue.localeCompare(rightValue)
      ));
    const search = new URLSearchParams(parameters).toString();
    return `${url.pathname}${search ? `?${search}` : ''}${url.hash}`;
  } catch {
    return normalizedText(value);
  }
}

export function isRenderedInteraction(interaction) {
  if (typeof interaction?.renderVisible === 'boolean') return interaction.renderVisible;
  const box = interaction?.bbox || {};
  return Number(box.width || 0) > 0
    && Number(box.height || 0) > 0
    && interaction?.display !== 'none'
    && interaction?.visibility !== 'hidden'
    && Number(interaction?.opacity ?? 1) > 0;
}

export function createInteractionIdentity(interaction = {}) {
  const id = normalizedText(interaction.id);
  const target = normalizedTarget(interaction.href);
  // The interaction inventory proves that the same actionable control exists.
  // Live labels (cart counts, accessibility labels, translated text) are
  // verified by the content/visual gates and must not create a second control.
  const text = id || target ? '' : normalizedText(interaction.text || interaction.ariaLabel);
  return JSON.stringify({
    tag: normalizedText(interaction.tag),
    id,
    role: normalizedText(interaction.role),
    ownerId: normalizedText(interaction.ownerId),
    text,
    target,
    ariaControls: normalizedText(interaction.ariaControls),
    inputType: normalizedText(interaction.inputType),
  });
}

export function summarizeInteractionInventory(interactions = []) {
  const visible = (interactions || []).filter(isRenderedInteraction);
  const counts = new Map();
  for (const interaction of visible) {
    const identity = createInteractionIdentity(interaction);
    counts.set(identity, (counts.get(identity) || 0) + 1);
  }
  return {
    totalCount: interactions.length,
    visibleCount: visible.length,
    latentCount: interactions.length - visible.length,
    identities: [...counts.entries()]
      .map(([identity, count]) => ({ identity, count }))
      .sort((left, right) => left.identity.localeCompare(right.identity)),
  };
}

function identityCounts(summary) {
  return new Map((summary?.identities || []).map((entry) => [entry.identity, Number(entry.count || 0)]));
}

export function compareInteractionInventories(baseline, current) {
  const expected = identityCounts(baseline);
  const actual = identityCounts(current);
  const identities = new Set([...expected.keys(), ...actual.keys()]);
  const missing = [];
  const added = [];
  for (const identity of identities) {
    const delta = (actual.get(identity) || 0) - (expected.get(identity) || 0);
    if (delta < 0) missing.push({ identity, count: -delta });
    if (delta > 0) added.push({ identity, count: delta });
  }
  const missingCount = missing.reduce((total, entry) => total + entry.count, 0);
  const addedCount = added.reduce((total, entry) => total + entry.count, 0);
  return {
    pass: missingCount === 0 && addedCount === 0,
    baselineVisibleCount: Number(baseline?.visibleCount || 0),
    currentVisibleCount: Number(current?.visibleCount || 0),
    missingCount,
    addedCount,
    missing,
    added,
  };
}

export function evaluateInteractionStabilityRounds(rounds = [], { minimumRounds = 3 } = {}) {
  if (rounds.length < minimumRounds) {
    return { pass: false, code: 'insufficient-rounds', roundCount: rounds.length, minimumRounds, comparisons: [] };
  }
  const baseline = rounds[0];
  const comparisons = rounds.slice(1).map((current, index) => ({
    round: index + 2,
    ...compareInteractionInventories(baseline, current),
  }));
  return {
    pass: comparisons.every((comparison) => comparison.pass),
    code: comparisons.every((comparison) => comparison.pass) ? null : 'visible-interaction-instability',
    roundCount: rounds.length,
    minimumRounds,
    comparisons,
  };
}

export function evaluateInteractionConsensusRounds(rounds = [], { minimumRounds = 3 } = {}) {
  if (rounds.length < minimumRounds) {
    return {
      pass: false,
      code: 'insufficient-rounds',
      roundCount: rounds.length,
      minimumRounds,
      consensusVisibleCount: 0,
      matchingRoundCount: 0,
      coveringRoundCount: 0,
      representativeRound: null,
      transientCount: 0,
      comparisons: [],
    };
  }

  const threshold = Math.floor(rounds.length / 2) + 1;
  const countsByRound = rounds.map(identityCounts);
  const identities = new Set(countsByRound.flatMap((counts) => [...counts.keys()]));
  const consensusIdentities = [];
  const transient = [];
  for (const identity of identities) {
    const counts = countsByRound.map((round) => round.get(identity) || 0).sort((left, right) => left - right);
    const consensusCount = counts[Math.floor(counts.length / 2)] || 0;
    if (consensusCount > 0) consensusIdentities.push({ identity, count: consensusCount });
    else transient.push({ identity, count: Math.max(...counts) });
  }
  consensusIdentities.sort((left, right) => left.identity.localeCompare(right.identity));
  transient.sort((left, right) => left.identity.localeCompare(right.identity));
  const consensusVisibleCount = consensusIdentities.reduce((total, entry) => total + entry.count, 0);
  const consensus = {
    visibleCount: consensusVisibleCount,
    identities: consensusIdentities,
  };
  const comparisons = rounds.map((round, index) => ({
    round: index + 1,
    ...compareInteractionInventories(consensus, round),
  }));
  const matchingRounds = comparisons.filter((comparison) => comparison.pass);
  const matchingRoundCount = matchingRounds.length;
  const coveringRounds = comparisons.filter((comparison) => comparison.missingCount === 0);
  const coveringRoundCount = coveringRounds.length;
  const representative = [...coveringRounds].sort((left, right) => left.addedCount - right.addedCount)[0]
    || [...comparisons].sort((left, right) => (
    (left.missingCount + left.addedCount) - (right.missingCount + right.addedCount)
  ))[0];
  // Every consensus identity has already been observed in a majority of
  // rounds. Require at least one real capture containing that complete core;
  // additional one-off controls remain explicit transient evidence.
  const pass = consensusVisibleCount > 0 && coveringRoundCount > 0;
  return {
    pass,
    code: pass ? null : 'no-stable-interaction-consensus',
    roundCount: rounds.length,
    minimumRounds,
    consensusThreshold: threshold,
    consensusVisibleCount,
    matchingRoundCount,
    coveringRoundCount,
    representativeRound: representative?.round || null,
    transientCount: transient.reduce((total, entry) => total + entry.count, 0),
    transient,
    comparisons,
  };
}
