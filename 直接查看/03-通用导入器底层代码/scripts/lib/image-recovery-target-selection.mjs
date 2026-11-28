export function selectPendingImageRecoveryTargets({ missingSources = [], cacheRecovered = [], manifests = [] } = {}) {
  const recovered = new Set(
    cacheRecovered.map((entry) => entry?.targetSource).filter(Boolean),
  );
  for (const manifest of manifests) {
    for (const [source, entry] of Object.entries(manifest?.entries || {})) {
      if (entry?.status === 'recovered') recovered.add(source);
    }
  }
  return [...new Set(missingSources)]
    .filter((source) => !recovered.has(source))
    .sort();
}

export function summarizeTargetRecoveryEntries({ targets = [], entries = {} } = {}) {
  const selected = targets.map((source) => entries[source]).filter(Boolean);
  return {
    recovered: selected.filter((entry) => entry.status === 'recovered').length,
    networkDeferred: selected.filter((entry) => entry.status === 'network-deferred').length,
    failed: selected.filter((entry) => entry.status === 'failed').length,
  };
}
