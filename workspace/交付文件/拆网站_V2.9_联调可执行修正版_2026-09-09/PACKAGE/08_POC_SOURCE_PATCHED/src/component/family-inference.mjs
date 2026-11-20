const CANONICAL_NAMES = {
  'product-card': 'ProductCard',
  'content-card': 'ContentCard',
  'search-form': 'SearchForm',
  'navigation': 'Navigation',
  'filter-panel': 'FilterPanel',
  'dropdown': 'Dropdown',
  'data-table': 'DataTable',
  'modal': 'Modal',
  'sidebar': 'Sidebar',
};

function unique(values) {
  return [...new Set(values.filter((value) => value !== undefined && value !== null && value !== ''))];
}

function present(value) {
  if (value === undefined || value === null || value === '') return false;
  if (Array.isArray(value)) return value.length > 0;
  return true;
}

function propType(key) {
  if (key === 'price') return 'money';
  if (key === 'media') return 'asset';
  if (['actionLabels','items','options','columns'].includes(key)) return 'string[]';
  if (key === 'rowCount') return 'number';
  return 'string';
}


function representativeValue(values) {
  const presentValues = values.filter((value) => value !== undefined && value !== null && value !== '');
  if (!presentValues.length) return undefined;
  const counts = new Map();
  for (const value of presentValues) {
    const key = JSON.stringify(value);
    const entry = counts.get(key) ?? { count: 0, value };
    entry.count++;
    counts.set(key, entry);
  }
  return [...counts.values()].sort((a, b) => b.count - a.count || JSON.stringify(a.value).localeCompare(JSON.stringify(b.value)))[0].value;
}

function representativeObject(objects) {
  const candidates = objects.filter((value) => value && typeof value === 'object');
  if (!candidates.length) return {};
  const keys = unique(candidates.flatMap((value) => Object.keys(value)));
  const out = {};
  for (const key of keys) {
    const value = representativeValue(candidates.map((item) => item[key]));
    if (value !== undefined) out[key] = value;
  }
  return out;
}

function inferStyleProfile(members) {
  const defaultMembers = members.filter((member) => (member.variant ?? 'default') === 'default');
  const baseMembers = defaultMembers.length ? defaultMembers : members;
  const slotNames = unique(baseMembers.flatMap((member) => Object.keys(member.slotStyles ?? {})));
  const slots = Object.fromEntries(slotNames.map((slot) => [
    slot,
    representativeObject(baseMembers.map((member) => member.slotStyles?.[slot]).filter(Boolean)),
  ]).filter(([, style]) => Object.keys(style).length));

  const variants = {};
  for (const variant of unique(members.map((member) => member.variant ?? 'default'))) {
    if (variant === 'default') continue;
    const variantMembers = members.filter((member) => (member.variant ?? 'default') === variant);
    const variantSlotNames = unique(variantMembers.flatMap((member) => Object.keys(member.slotStyles ?? {})));
    variants[variant] = {
      root: representativeObject(variantMembers.map((member) => member.style)),
      slots: Object.fromEntries(variantSlotNames.map((slot) => [
        slot,
        representativeObject(variantMembers.map((member) => member.slotStyles?.[slot]).filter(Boolean)),
      ]).filter(([, style]) => Object.keys(style).length)),
    };
  }
  return {
    root: representativeObject(baseMembers.map((member) => member.style)),
    slots,
    variants,
  };
}

function inferProps(members) {
  const fields = ['title', 'price', 'media', 'actionLabels', 'items', 'options', 'columns', 'rowCount'];
  const schema = {};
  for (const key of fields) {
    const values = members.map((member) => member.content?.[key]);
    const found = values.filter(present).length;
    if (!found) continue;
    schema[key] = {
      type: propType(key),
      required: found === members.length,
    };
  }
  return schema;
}

export function inferFamilyDefinition(members, cluster) {
  if (!members.length) throw new Error('Family inference requires at least one member');
  const semanticRole = cluster.semanticRole ?? members[0].semanticRole ?? 'unknown';
  return {
    id: `fam-${cluster.id}`,
    canonicalName: CANONICAL_NAMES[semanticRole] ?? members[0].componentName ?? semanticRole,
    semanticRole,
    confidence: Math.max(0, Math.min(1, cluster.confidence ?? 1)),
    occurrenceCount: members.length,
    routeIds: unique(members.map((member) => member.routeId)),
    propsSchema: inferProps(members),
    slots: unique(members.flatMap((member) => member.structure?.slots ?? [])),
    variants: unique(members.map((member) => member.variant ?? 'default')),
    states: unique(['default', ...members.flatMap((member) => member.stateNames ?? [])]),
    styleProfile: inferStyleProfile(members),
    fingerprints: { memberHashes: cluster.fingerprints ?? [] },
    evidenceIds: unique(members.flatMap((member) => member.evidenceIds ?? [])),
  };
}
