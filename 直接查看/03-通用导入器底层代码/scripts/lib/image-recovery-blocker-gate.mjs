export function evaluateImageRecoveryBlockers({ report, selectedReplayFiles, currentHashes }) {
  if (!report || report.pass) return { pass: true, code: null };

  const selected = new Set(selectedReplayFiles || []);
  const blocked = (report.files || []).filter((file) => selected.has(file.filename));
  if (blocked.length === 0) return { pass: true, code: null };

  const staleFiles = blocked
    .filter((file) => currentHashes.get(file.filename) !== file.sha256)
    .map((file) => file.filename)
    .sort();
  if (staleFiles.length > 0) {
    return {
      pass: false,
      code: 'stale-image-recovery-blocker-report',
      staleFiles,
    };
  }

  const sources = new Set(blocked.flatMap((file) => file.sources || []));
  return {
    pass: false,
    code: 'unresolved-source-images',
    blockedFiles: blocked.map((file) => file.filename).sort(),
    blockedUniqueSourceCount: sources.size,
    blockedOccurrenceCount: blocked.reduce((total, file) => total + (file.occurrences || 1), 0),
  };
}
