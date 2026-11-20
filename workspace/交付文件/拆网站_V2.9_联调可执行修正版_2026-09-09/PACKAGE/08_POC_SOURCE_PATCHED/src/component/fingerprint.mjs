import crypto from 'node:crypto';

function stable(value) {
  if (Array.isArray(value)) return value.map(stable);
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.keys(value).sort().map((k) => [k, stable(value[k])]));
  }
  return value;
}

function hash(value) {
  return crypto.createHash('sha256').update(JSON.stringify(stable(value))).digest('hex');
}

function jaccard(a = [], b = []) {
  const A = new Set(a);
  const B = new Set(b);
  if (A.size === 0 && B.size === 0) return 1;
  let intersection = 0;
  for (const item of A) if (B.has(item)) intersection++;
  return intersection / (A.size + B.size - intersection || 1);
}

function numericSimilarity(a, b) {
  if (a === b) return 1;
  if (typeof a !== 'number' || typeof b !== 'number') return 0;
  const max = Math.max(Math.abs(a), Math.abs(b), 1);
  return Math.max(0, 1 - Math.abs(a - b) / max);
}

function objectSimilarity(a = {}, b = {}) {
  const keys = [...new Set([...Object.keys(a), ...Object.keys(b)])];
  if (!keys.length) return 1;
  let total = 0;
  for (const key of keys) {
    const av = a[key];
    const bv = b[key];
    if (Array.isArray(av) || Array.isArray(bv)) total += jaccard(av ?? [], bv ?? []);
    else if (typeof av === 'number' || typeof bv === 'number') total += numericSimilarity(av, bv);
    else total += av === bv ? 1 : 0;
  }
  return total / keys.length;
}

function structureSimilarity(a = {}, b = {}) {
  const tag = a.tag === b.tag ? 1 : 0;
  const childRoles = jaccard(a.childRoles ?? [], b.childRoles ?? []);
  const slots = jaccard(a.slots ?? [], b.slots ?? []);
  return 0.3 * tag + 0.35 * childRoles + 0.35 * slots;
}

function behaviorSimilarity(a = {}, b = {}) {
  const role = a.role === b.role ? 1 : 0;
  const side = a.sideEffectClass === b.sideEffectClass ? 1 : 0;
  const actions = jaccard(a.actions ?? [], b.actions ?? []);
  return 0.4 * role + 0.4 * side + 0.2 * actions;
}

function semanticSimilarity(a, b) {
  if (a === b) return 1;
  if (!a || !b) return 0;
  const at = new Set(String(a).split(/[-_/]/));
  const bt = new Set(String(b).split(/[-_/]/));
  return jaccard([...at], [...bt]) * 0.5;
}

function incompatibleBehavior(a = {}, b = {}) {
  const sideA = a.sideEffectClass ?? 'unknown';
  const sideB = b.sideEffectClass ?? 'unknown';
  const harmless = new Set(['none', 'unknown']);
  if (sideA !== sideB && !(harmless.has(sideA) && harmless.has(sideB))) return true;
  const roleA = a.role ?? '';
  const roleB = b.role ?? '';
  if (new Set([roleA, roleB]).has('link') && new Set([roleA, roleB]).has('textbox')) return true;
  return false;
}

export function buildFingerprint(candidate) {
  const fingerprint = {
    semanticRole: candidate.semanticRole ?? 'unknown',
    structure: stable(candidate.structure ?? {}),
    style: stable(candidate.style ?? {}),
    visual: stable(candidate.visual ?? {}),
    behavior: stable(candidate.behavior ?? {}),
    recurrence: stable(candidate.recurrence ?? {}),
    frameworkHint: stable(candidate.frameworkHint ?? {}),
  };
  return { ...fingerprint, hash: hash(fingerprint) };
}

export function compareFingerprints(a, b, weights = {}) {
  const w = {
    semantic: weights.semantic ?? 0.30,
    structure: weights.structure ?? 0.30,
    style: weights.style ?? 0.15,
    visual: weights.visual ?? 0.10,
    behavior: weights.behavior ?? 0.15,
  };
  const dimensions = {
    semantic: semanticSimilarity(a.semanticRole, b.semanticRole),
    structure: structureSimilarity(a.structure, b.structure),
    style: objectSimilarity(a.style, b.style),
    visual: objectSimilarity(a.visual, b.visual),
    behavior: behaviorSimilarity(a.behavior, b.behavior),
  };
  const rawScore = Object.entries(dimensions).reduce((sum, [key, value]) => sum + value * w[key], 0);
  const compatible = !incompatibleBehavior(a.behavior, b.behavior);
  return {
    compatible,
    score: compatible ? rawScore : Math.min(rawScore, 0.49),
    dimensions,
  };
}
