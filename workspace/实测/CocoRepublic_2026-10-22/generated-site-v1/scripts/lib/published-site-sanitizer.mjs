function isExternal(value) {
  return /^(?:https?:)?\/\//i.test(String(value || '').trim());
}

function normalizedUrl(value) {
  return String(value || '').replaceAll('&amp;', '&').trim();
}

export function decodeCachedResourceText(value) {
  const text = String(value || '');
  const newlineIndex = text.indexOf('\n');
  if (newlineIndex < 0) throw new Error('cached resource is missing its source URL line');
  const sourceUrl = text.slice(0, newlineIndex).replace(/\r$/, '');
  const dataUrl = text.slice(newlineIndex + 1).trim();
  const match = dataUrl.match(/^data:([^;,]+)(?:;[^,]*)?;base64,([\s\S]+)$/i);
  if (!match) throw new Error(`cached resource is not a base64 data URL: ${sourceUrl}`);
  const buffer = Buffer.from(match[2], 'base64');
  if (!buffer.length) throw new Error(`cached resource is empty: ${sourceUrl}`);
  return { sourceUrl, contentType: match[1], buffer };
}

function hostnameOf(value) {
  try {
    const url = normalizedUrl(value);
    return new URL(url.startsWith('//') ? `https:${url}` : url).hostname.toLowerCase();
  } catch {
    return '';
  }
}

function sourceHostSet(sourceHosts) {
  const output = new Set();
  for (const value of sourceHosts || []) {
    const host = String(value).toLowerCase().replace(/^www\./, '');
    output.add(host);
    output.add(`www.${host}`);
  }
  return output;
}

function navigationFallbackMap(fallbacks) {
  const output = new Map();
  for (const [value, target] of Object.entries(fallbacks || {})) {
    const host = String(value).toLowerCase().replace(/^www\./, '');
    output.set(host, String(target));
    output.set(`www.${host}`, String(target));
  }
  return output;
}

function localNavigationTarget(value, hosts, fallbacks) {
  const raw = normalizedUrl(value);
  if (!isExternal(raw)) return null;
  try {
    const parsed = new URL(raw.startsWith('//') ? `https:${raw}` : raw);
    const fallback = fallbacks.get(parsed.hostname.toLowerCase());
    if (fallback) return fallback;
    if (!hosts.has(parsed.hostname.toLowerCase())) return null;
    if (/cocorepublichelp\.zendesk\.com$/i.test(parsed.hostname)) {
      if (/register|create/i.test(parsed.pathname)) return '/account.php';
      if (/signin|login|password/i.test(parsed.pathname)) return '/login.php';
      return '/faqs';
    }
    return `${parsed.pathname || '/'}${parsed.search}${parsed.hash}`;
  } catch {
    return '/';
  }
}

export function collectExternalMediaReferences(value) {
  const html = String(value || '');
  const references = new Map();
  const frozenVideoFallback = [...html.matchAll(/<img\b[^>]*\bdata-matbox-frozen-video\s*=\s*["']true["'][^>]*>/gi)]
    .map((match) => match[0].match(/\ssrc\s*=\s*["']([^"']+)["']/i)?.[1])
    .find((url) => url && !isExternal(url));
  for (const tagMatch of html.matchAll(/<(img|video|source)\b[^>]*>/gi)) {
    const tag = tagMatch[0];
    const tagName = tagMatch[1].toLowerCase();
    for (const attributeMatch of tag.matchAll(/\s(?:src|poster)\s*=\s*(["'])(.*?)\1/gis)) {
      const url = normalizedUrl(attributeMatch[2]);
      if (isExternal(url)) references.set(url, tagName === 'img' || !frozenVideoFallback);
    }
  }
  for (const match of html.matchAll(/url\(\s*(['"]?)(https?:\/\/[^'")]+)\1\s*\)/gi)) {
    const url = normalizedUrl(match[2]);
    if (/\.(?:avif|gif|jpe?g|mp4|png|svg|webm|webp)(?:[?#]|$)/i.test(url) && !references.has(url)) references.set(url, false);
  }
  return [...references].sort(([left], [right]) => left.localeCompare(right)).map(([url, required]) => ({ url, required }));
}

export function collectExternalMediaUrls(value) {
  return collectExternalMediaReferences(value).map(({ url }) => url);
}

export function sanitizePublishedHtml(value, options = {}) {
  let html = String(value || '');
  const resourceMap = options.resourceMap instanceof Map ? options.resourceMap : new Map(Object.entries(options.resourceMap || {}));
  const hosts = sourceHostSet(options.sourceHosts || []);
  const navigationFallbacks = navigationFallbackMap(options.navigationFallbacks);
  const report = {
    removedIframes: 0,
    removedScripts: 0,
    removedLinks: 0,
    removedLazyAttributes: 0,
    localizedResources: 0,
    localizedNavigation: 0,
    removedCssUrls: 0,
    staticVideoFallbacks: 0,
  };

  const frozenVideoFallback = [...html.matchAll(/<img\b[^>]*\bdata-matbox-frozen-video\s*=\s*["']true["'][^>]*>/gi)]
    .map((match) => match[0].match(/\ssrc\s*=\s*["']([^"']+)["']/i)?.[1])
    .find((url) => url && !isExternal(url));

  html = html.replace(/<base\b[^>]*>/gi, '<base href="/">');

  html = html.replace(/<iframe\b(?=[^>]*\bsrc\s*=\s*["'](?:https?:)?\/\/)[^>]*>[\s\S]*?<\/iframe\s*>/gi, () => {
    report.removedIframes += 1;
    return '';
  });
  html = html.replace(/<iframe\b(?=[^>]*\bsrc\s*=\s*["'](?:https?:)?\/\/)[^>]*\/?\s*>/gi, () => {
    report.removedIframes += 1;
    return '';
  });
  html = html.replace(/<script\b(?=[^>]*\bsrc\s*=\s*["'](?:https?:)?\/\/)[^>]*>[\s\S]*?<\/script\s*>/gi, () => {
    report.removedScripts += 1;
    return '';
  });
  html = html.replace(/<link\b(?=[^>]*\bhref\s*=\s*["'](?:https?:)?\/\/)[^>]*>/gi, () => {
    report.removedLinks += 1;
    return '';
  });

  html = html.replace(/\s(data-src|data-lazy-src|data-original|data-srcset|data-lazy-srcset)\s*=\s*(["'])(.*?)\2/gis, (match, attribute, quote, attributeValue) => {
    const candidates = attribute.toLowerCase().includes('srcset')
      ? attributeValue.split(',').map((part) => part.trim().split(/\s+/)[0])
      : [attributeValue.trim()];
    if (!candidates.some(isExternal)) return match;
    report.removedLazyAttributes += 1;
    return '';
  });

  html = html.replace(/\s(src|poster|srcset)\s*=\s*(["'])(.*?)\2/gis, (match, attribute, quote, attributeValue) => {
    const parts = attribute.toLowerCase() === 'srcset'
      ? attributeValue.split(',').map((part) => part.trim())
      : [attributeValue.trim()];
    let changed = false;
    const rewritten = parts.map((part) => {
      const [url, ...descriptor] = part.split(/\s+/);
      if (!isExternal(url)) return part;
      const local = resourceMap.get(normalizedUrl(url));
      if (!local) return part;
      changed = true;
      report.localizedResources += 1;
      return [local, ...descriptor].join(' ');
    });
    return changed ? ` ${attribute}=${quote}${rewritten.join(', ')}${quote}` : match;
  });

  if (frozenVideoFallback) {
    html = html.replace(/<video\b[^>]*>[\s\S]*?<\/video\s*>/gi, (video) => {
      if (!/<source\b[^>]*\bsrc\s*=\s*["'](?:https?:)?\/\//i.test(video)) return video;
      report.staticVideoFallbacks += 1;
      return `<img data-matbox-static-video-fallback="true" src="${frozenVideoFallback}" alt="">`;
    });
  }

  html = html.replace(/url\(\s*(['"]?)(https?:\/\/[^'")]+)\1\s*\)/gi, (match, quote, url) => {
    const local = resourceMap.get(normalizedUrl(url));
    if (local) {
      report.localizedResources += 1;
      return `url("${local}")`;
    }
    report.removedCssUrls += 1;
    return 'none';
  });

  html = html.replace(/<(a|form)\b[^>]*>/gi, (tag, tagName) => {
    const attribute = tagName.toLowerCase() === 'a' ? 'href' : 'action';
    const pattern = new RegExp(`(\\s${attribute}\\s*=\\s*)(["'])(.*?)\\2`, 'i');
    return tag.replace(pattern, (match, prefix, quote, target) => {
      const local = localNavigationTarget(target, hosts, navigationFallbacks);
      if (local === null) return match;
      report.localizedNavigation += 1;
      return `${prefix}${quote}${local}${quote}`;
    });
  });

  return { html, report };
}

