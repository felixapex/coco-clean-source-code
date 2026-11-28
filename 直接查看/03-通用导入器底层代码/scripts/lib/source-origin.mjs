function originOf(value) {
  if (!value) return null;
  try { return new URL(value).origin; } catch { throw new Error(`Invalid source URL: ${value}`); }
}

export function resolveSourceOrigin({ envValue, inventorySource } = {}) {
  const explicitOrigin = originOf(envValue);
  const inventoryOrigin = originOf(inventorySource);
  if (explicitOrigin && inventoryOrigin && explicitOrigin !== inventoryOrigin) {
    throw new Error(`Source origin mismatch: explicit=${explicitOrigin} inventory=${inventoryOrigin}`);
  }
  const resolved = explicitOrigin || inventoryOrigin;
  if (!resolved) throw new Error('Source origin is required: set MATBOX_SOURCE_URL or create a verified route inventory first');
  return resolved;
}

export function resolveCaptureSourceUrl({ sourceOrigin, route, explicitUrl, selectedRouteCount = 0 } = {}) {
  if (!sourceOrigin) throw new Error('Capture source origin is required');
  if (typeof route !== 'string' || !route.startsWith('/')) throw new Error(`Invalid local capture route: ${route}`);
  if (!explicitUrl) return new URL(route, sourceOrigin).href;
  if (selectedRouteCount !== 1) {
    throw new Error('A source URL override requires exactly one --route so it cannot leak into other captures');
  }
  let parsed;
  try { parsed = new URL(explicitUrl); } catch { throw new Error(`Invalid capture source URL: ${explicitUrl}`); }
  if (!['http:', 'https:'].includes(parsed.protocol)) {
    throw new Error(`Capture source URL must use http or https: ${explicitUrl}`);
  }
  return parsed.href;
}

export function injectSourceBaseHref(html, sourceUrl) {
  if (typeof html !== 'string' || !html.trim()) throw new Error('Source HTML is required');
  const parsed = new URL(sourceUrl);
  if (!['http:', 'https:'].includes(parsed.protocol)) throw new Error(`Source base URL must use http or https: ${sourceUrl}`);
  const withoutExistingBase = html.replace(/<base\b[^>]*>/gi, '');
  const base = `<base href="${parsed.href.replace(/"/g, '&quot;')}">`;
  if (/<head\b[^>]*>/i.test(withoutExistingBase)) {
    return withoutExistingBase.replace(/<head\b[^>]*>/i, (head) => `${head}${base}`);
  }
  return `${base}${withoutExistingBase}`;
}

function freezeStylesheetDependencies(assetDataByUrl) {
  const frozen = { ...assetDataByUrl };
  for (const [stylesheetUrl, dataUri] of Object.entries(assetDataByUrl)) {
    const match = String(dataUri || '').match(/^data:text\/css(?:;charset=[^;,]+)?;base64,(.*)$/i);
    if (!match) continue;
    const css = Buffer.from(match[1], 'base64').toString('utf8');
    const rewritten = css.replace(/url\(\s*(['"]?)(.*?)\1\s*\)/gi, (full, quote, rawValue) => {
      const value = String(rawValue || '').trim();
      if (!value || /^(?:data:|blob:|about:|#)/i.test(value)) return full;
      let absolute;
      try { absolute = new URL(value, stylesheetUrl).href; } catch { return full; }
      const dependency = assetDataByUrl[absolute];
      if (!/^data:/i.test(String(dependency || ''))) return full;
      const wrapper = quote || '';
      return `url(${wrapper}${dependency}${wrapper})`;
    });
    frozen[stylesheetUrl] = `data:text/css;base64,${Buffer.from(rewritten).toString('base64')}`;
  }
  return frozen;
}

export function prepareSourceHtmlForStaticCapture(html, sourceUrl, assetDataByUrl = {}) {
  const frozenAssets = freezeStylesheetDependencies(assetDataByUrl);
  const withoutScripts = String(html || '').replace(/<script\b[^>]*>[\s\S]*?<\/script\s*>/gi, '');
  const repairedEmptyImages = withoutScripts.replace(/<img\b[^>]*>/gi, (tag) => {
    if (!/\bsrc\s*=\s*["']\s*["']/i.test(tag)) return tag;
    const fallback = tag.match(/\bonerror\s*=\s*"[^"]*this\.src\s*=\s*'([^']+)'[^"]*"/i)?.[1];
    return fallback ? tag.replace(/\bsrc\s*=\s*(["'])\s*\1/i, `src="${fallback}"`) : tag;
  });
  const inlinedImages = repairedEmptyImages.replace(/<img\b[^>]*>/gi, (tag) => {
    const match = tag.match(/\bsrc\s*=\s*(["'])(.*?)\1/i);
    if (!match || !match[2] || /^data:/i.test(match[2])) return tag;
    let absolute;
    try { absolute = new URL(match[2], sourceUrl).href; } catch { return tag; }
    const dataUri = frozenAssets[absolute];
    if (!/^data:image\//i.test(String(dataUri || ''))) return tag;
    return tag.replace(match[0], `src="${dataUri}"`);
  });
  const inlinedStylesheets = inlinedImages.replace(/<link\b[^>]*>/gi, (tag) => {
    if (!/\brel\s*=\s*["'][^"']*\bstylesheet\b/i.test(tag)) return tag;
    const match = tag.match(/\bhref\s*=\s*(["'])(.*?)\1/i);
    if (!match || !match[2] || /^data:/i.test(match[2])) return tag;
    let absolute;
    try { absolute = new URL(match[2], sourceUrl).href; } catch { return tag; }
    const dataUri = frozenAssets[absolute];
    if (!/^data:text\/css[;,]/i.test(String(dataUri || ''))) return tag;
    return tag.replace(match[0], `href="${dataUri}"`);
  });
  return injectSourceBaseHref(inlinedStylesheets, sourceUrl);
}
