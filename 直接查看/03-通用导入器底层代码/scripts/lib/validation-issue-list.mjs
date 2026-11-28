export function buildImageRecoveryIssues(report = {}) {
  return (report.files || []).map((file) => ({
    id: `image-source:${file.filename}`,
    category: 'assets',
    type: 'unresolved-source-images',
    severity: 'blocking',
    status: 'open',
    filename: file.filename,
    routes: [...(file.routes || [])].sort(),
    sourceCount: new Set(file.sources || []).size,
    occurrenceCount: Number(file.occurrences || 0),
    sources: [...new Set(file.sources || [])].sort(),
    replaySha256: file.sha256,
  }));
}
