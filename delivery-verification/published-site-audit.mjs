function isExternal(value) {
  return /^(?:https?:)?\/\//i.test(String(value || '').trim());
}

function hostnameOf(value) {
  try {
    const url = String(value || '').trim();
    return new URL(url.startsWith('//') ? `https:${url}` : url).hostname.toLowerCase();
  } catch {
    return '';
  }
}

function matchesSourceHost(value, sourceHosts) {
  const hostname = hostnameOf(value);
  return hostname && sourceHosts.some((sourceHost) => hostname === sourceHost || hostname.endsWith(`.${sourceHost}`));
}

export function auditPublishedSiteHtml(value, options = {}) {
  const html = String(value || '');
  const sourceHosts = [...new Set((options.sourceHosts || []).map((host) => String(host).toLowerCase().replace(/^www\./, '')))]
    .flatMap((host) => [host, `www.${host}`]);
  const failures = new Set();
  const resourceReferences = [];
  const sourceNavigation = [];
  const resourceAttributes = new Set([
    'src', 'poster', 'data-src', 'data-lazy-src', 'data-original',
    'srcset', 'data-srcset', 'data-lazy-srcset',
  ]);

  for (const tagMatch of html.matchAll(/<([a-z][\w:-]*)\b[^>]*>/gi)) {
    const tag = tagMatch[0];
    const tagName = tagMatch[1].toLowerCase();
    for (const attributeMatch of tag.matchAll(/\s([\w:-]+)\s*=\s*(["'])(.*?)\2/gis)) {
      const attribute = attributeMatch[1].toLowerCase();
      const rawValue = attributeMatch[3];
      const candidates = attribute.includes('srcset')
        ? rawValue.split(',').map((part) => part.trim().split(/\s+/)[0])
        : [rawValue.trim()];
      if (resourceAttributes.has(attribute) || (tagName === 'link' && attribute === 'href')) {
        for (const candidate of candidates) {
          if (!isExternal(candidate)) continue;
          resourceReferences.push({ tag: tagName, attribute, url: candidate });
          failures.add(`external-resource:${tagName}:${attribute}`);
        }
      }
      if ((tagName === 'a' && attribute === 'href') || (tagName === 'form' && attribute === 'action')) {
        if (!matchesSourceHost(rawValue, sourceHosts)) continue;
        sourceNavigation.push({ tag: tagName, attribute, url: rawValue });
        failures.add(`source-navigation:${tagName}:${attribute}`);
      }
    }
  }

  for (const match of html.matchAll(/url\(\s*(["']?)([^'")]+)\1\s*\)/gi)) {
    if (!isExternal(match[2])) continue;
    resourceReferences.push({ tag: 'style', attribute: 'css-url', url: match[2] });
    failures.add('external-resource:style:css-url');
  }

  return {
    pass: failures.size === 0,
    failures: [...failures],
    resourceReferences,
    sourceNavigation,
  };
}
