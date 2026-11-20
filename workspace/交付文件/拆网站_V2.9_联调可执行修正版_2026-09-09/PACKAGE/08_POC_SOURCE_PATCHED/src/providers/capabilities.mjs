import crypto from 'node:crypto';

function canonical(value) {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.keys(value).sort().map((key) => [key, canonical(value[key])]));
  }
  return value;
}

export function normalizeTools(tools = []) {
  return tools
    .map((tool) => ({
      name: tool.name,
      description: tool.description ?? '',
      inputSchema: canonical(tool.inputSchema ?? {}),
      outputSchema: canonical(tool.outputSchema ?? {}),
    }))
    .sort((a, b) => String(a.name).localeCompare(String(b.name)));
}

export function capabilityHash(tools = []) {
  return crypto.createHash('sha256').update(JSON.stringify(normalizeTools(tools))).digest('hex');
}

export function buildCapabilitySnapshot(provider, version, tools = []) {
  const normalized = normalizeTools(tools);
  return {
    provider,
    version,
    hash: capabilityHash(normalized),
    toolNames: normalized.map((tool) => tool.name),
    tools: normalized,
  };
}
