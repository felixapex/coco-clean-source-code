import { buildFingerprint, compareFingerprints } from './fingerprint.mjs';

class UnionFind {
  constructor(n) { this.parent = Array.from({ length: n }, (_, i) => i); }
  find(x) { return this.parent[x] === x ? x : (this.parent[x] = this.find(this.parent[x])); }
  union(a, b) {
    const ra = this.find(a), rb = this.find(b);
    if (ra !== rb) this.parent[rb] = ra;
  }
}

export function clusterCandidates(candidates, options = {}) {
  const threshold = options.threshold ?? 0.80;
  const fingerprints = candidates.map(buildFingerprint);
  const uf = new UnionFind(candidates.length);
  const pairScores = new Map();

  for (let i = 0; i < candidates.length; i++) {
    for (let j = i + 1; j < candidates.length; j++) {
      const result = compareFingerprints(fingerprints[i], fingerprints[j], options.weights);
      pairScores.set(`${i}:${j}`, result);
      if (result.compatible && result.score >= threshold) uf.union(i, j);
    }
  }

  const groups = new Map();
  for (let i = 0; i < candidates.length; i++) {
    const root = uf.find(i);
    if (!groups.has(root)) groups.set(root, []);
    groups.get(root).push(i);
  }

  return [...groups.values()].map((indices, familyIndex) => {
    const scores = [];
    for (let a = 0; a < indices.length; a++) {
      for (let b = a + 1; b < indices.length; b++) {
        const i = Math.min(indices[a], indices[b]);
        const j = Math.max(indices[a], indices[b]);
        const r = pairScores.get(`${i}:${j}`);
        if (r) scores.push(r.score);
      }
    }
    return {
      id: `family-${familyIndex + 1}`,
      semanticRole: candidates[indices[0]]?.semanticRole ?? 'unknown',
      memberIds: indices.map((i) => candidates[i].id),
      confidence: scores.length ? scores.reduce((a, b) => a + b, 0) / scores.length : 1,
      fingerprints: indices.map((i) => fingerprints[i].hash),
    };
  });
}
