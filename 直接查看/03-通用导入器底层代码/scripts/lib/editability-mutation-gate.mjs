function editableSettingIds(schema = {}) {
  return (Array.isArray(schema.settings) ? schema.settings : [])
    .filter((setting) => setting && typeof setting.id === 'string' && setting.id)
    .map((setting) => setting.id);
}

function completeEvidence(evidence) {
  return Boolean(
    evidence?.before?.domHash
    && evidence?.before?.screenshot
    && evidence?.after?.domHash
    && evidence?.after?.screenshot
    && evidence?.diff?.path
    && Number.isFinite(Number(evidence?.diff?.changedPixels)),
  );
}

export function evaluateSettingMutations({ schema = {}, mutations = [], requiredViewports = [] } = {}) {
  const failures = [];
  const requiredIds = editableSettingIds(schema);
  const byId = new Map((Array.isArray(mutations) ? mutations : []).map((mutation) => [mutation?.settingId, mutation]));
  let checked = 0;
  let passed = 0;

  for (const settingId of requiredIds) {
    const mutation = byId.get(settingId);
    if (!mutation) {
      failures.push({ type: 'missing-setting-mutation', settingId });
      continue;
    }
    checked += 1;
    const failureCountBefore = failures.length;

    if (mutation.status === 'error') {
      failures.push({ type: 'setting-mutation-error', settingId, error: mutation.error || 'unknown error' });
    } else {
      if (Array.isArray(mutation.changedOutsideTargetIds) && mutation.changedOutsideTargetIds.length > 0) {
        failures.push({ type: 'setting-mutation-leaked', settingId, regions: mutation.changedOutsideTargetIds });
      }
      for (const viewport of requiredViewports) {
        const evidence = mutation.evidenceByViewport?.[viewport];
        if (!evidence) {
          failures.push({ type: 'missing-setting-mutation-viewport', settingId, viewport });
          continue;
        }
        if (!completeEvidence(evidence)) {
          failures.push({ type: 'incomplete-setting-mutation-evidence', settingId, viewport });
          continue;
        }
        const domChanged = evidence.before.domHash !== evidence.after.domHash;
        const pixelsChanged = Number(evidence.diff.changedPixels) > 0;
        if (!domChanged && !pixelsChanged) {
          failures.push({ type: 'setting-mutation-no-render-change', settingId, viewport });
        }
      }
    }

    if (failures.length === failureCountBefore) passed += 1;
  }

  return {
    pass: failures.length === 0,
    failures,
    coverage: { required: requiredIds.length, checked, passed },
  };
}

