export function createEmptyIr(site) {
  return {
    irVersion: '0.1',
    site: { ...site },
    designSystem: { tokenFormat: 'dtcg-2025.10', tokens: {} },
    routes: [],
    componentFamilies: [],
    componentInstances: [],
    interactions: [],
    assets: [],
    evidence: [],
    compileTargets: [],
  };
}

export function validateComponentIr(ir) {
  const errors = [];
  if (!ir || typeof ir !== 'object') return { ok: false, errors: ['IR must be an object'] };
  if (ir.irVersion !== '0.1') errors.push('irVersion must be 0.1');
  if (!ir.site?.id) errors.push('site.id is required');
  if (!ir.site?.sourceUrl) errors.push('site.sourceUrl is required');
  if (!ir.site?.capturedAt) errors.push('site.capturedAt is required');
  if (ir.designSystem?.tokenFormat !== 'dtcg-2025.10') errors.push('designSystem.tokenFormat must be dtcg-2025.10');

  for (const field of ['routes', 'componentFamilies', 'componentInstances', 'evidence']) {
    if (!Array.isArray(ir[field])) errors.push(`${field} must be an array`);
  }
  if (errors.length) return { ok: false, errors };

  const evidenceIds = new Set(ir.evidence.map((e) => e?.id).filter(Boolean));
  const familyIds = new Set(ir.componentFamilies.map((f) => f?.id).filter(Boolean));
  const routeIds = new Set(ir.routes.map((r) => r?.id).filter(Boolean));

  for (const family of ir.componentFamilies) {
    if (!family.id) errors.push('componentFamily.id is required');
    if (!family.canonicalName) errors.push(`family ${family.id ?? '?'} canonicalName is required`);
    if (!family.semanticRole) errors.push(`family ${family.id ?? '?'} semanticRole is required`);
    if (!(typeof family.confidence === 'number' && family.confidence >= 0 && family.confidence <= 1)) {
      errors.push(`family ${family.id ?? '?'} confidence must be between 0 and 1`);
    }
    for (const field of ['slots', 'variants', 'states', 'evidenceIds']) {
      if (!Array.isArray(family[field])) errors.push(`family ${family.id ?? '?'} ${field} must be an array`);
    }
    if (!family.propsSchema || typeof family.propsSchema !== 'object') errors.push(`family ${family.id ?? '?'} propsSchema is required`);
    if (!family.fingerprints || typeof family.fingerprints !== 'object') errors.push(`family ${family.id ?? '?'} fingerprints is required`);

    const variants = new Set(family.variants ?? []);
    for (const state of family.states ?? []) {
      if (variants.has(state) && state !== 'default') errors.push(`family ${family.id ?? '?'} value '${state}' appears as both variant and state`);
    }
    for (const evidenceId of family.evidenceIds ?? []) {
      if (!evidenceIds.has(evidenceId)) errors.push(`family ${family.id ?? '?'} references missing evidence ${evidenceId}`);
    }
  }

  const instanceIds = new Set(ir.componentInstances.map((instance) => instance?.id).filter(Boolean));
  for (const instance of ir.componentInstances) {
    if (!instance.id) errors.push('componentInstance.id is required');
    if (!familyIds.has(instance.familyId)) errors.push(`instance ${instance.id ?? '?'} references missing family ${instance.familyId}`);
    if (instance.routeId && !routeIds.has(instance.routeId)) errors.push(`instance ${instance.id ?? '?'} references missing route ${instance.routeId}`);
    if (instance.parentInstanceId && !instanceIds.has(instance.parentInstanceId)) {
      errors.push(`instance ${instance.id ?? '?'} references missing parent instance ${instance.parentInstanceId}`);
    }
    for (const childInstanceId of instance.childInstanceIds ?? []) {
      if (!instanceIds.has(childInstanceId)) errors.push(`instance ${instance.id ?? '?'} references missing child instance ${childInstanceId}`);
    }
    for (const evidenceId of instance.evidenceIds ?? []) {
      if (!evidenceIds.has(evidenceId)) errors.push(`instance ${instance.id ?? '?'} references missing evidence ${evidenceId}`);
    }
  }

  return { ok: errors.length === 0, errors };
}
