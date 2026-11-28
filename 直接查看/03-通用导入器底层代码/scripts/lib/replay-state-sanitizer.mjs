const EMPTY_COMMERCE_STYLE = '<style data-matbox-empty-commerce-skeleton>#searchspring-category[data-matbox-empty-commerce-skeleton]{display:none!important}</style>';
const RESPONSIVE_PAGE_CONTAINER_STYLE = '<style data-matbox-responsive-page-containers>@media (min-width:1440px){main>.container:not(.top_level_container),main .container:not(.top_level_container),main .container-plp-landing,main .page-layout-hero-wrap{width:100%!important;max-width:none!important}}</style>';
const RESPONSIVE_AUTO_SIZED_CARD_GRID_STYLE = '<style data-matbox-responsive-auto-sized-card-grid-items>[data-matbox-frozen-card-grid-box="true"]>.cat-cards>.category-block{width:100%!important}[data-matbox-frozen-card-grid-box="true"]>.cat-cards>.category-block img{width:100%!important;height:auto!important}</style>';
const RESPONSIVE_CONTAINED_COMPONENT_STYLE = '<style data-matbox-responsive-contained-style>[data-matbox-responsive-contained="true"]{box-sizing:border-box!important;width:100%!important;max-width:100%!important;overflow-x:clip!important}</style>';

const REMOTE_MEDIA_ATTRIBUTES = [
  ['src', 'data-matbox-source-src'],
  ['srcset', 'data-matbox-source-srcset'],
  ['data-src', 'data-matbox-source-data-src'],
  ['data-srcset', 'data-matbox-source-data-srcset'],
];

function deactivateRemoteAttribute(attributes, attributeName, evidenceName) {
  const attributePattern = new RegExp(`(^|\\s)${attributeName}\\s*=\\s*(["'])(https?:\\/\\/[^"']*)\\2`, 'i');
  const match = attributes.match(attributePattern);
  if (!match) return attributes;
  const replacement = new RegExp(`(?:^|\\s)${evidenceName}\\s*=`, 'i').test(attributes)
    ? match[1]
    : `${match[1]}${evidenceName}=${match[2]}${match[3]}${match[2]}`;
  return attributes.replace(match[0], replacement);
}

function deactivateRemoteCandidates(attributes, candidates = REMOTE_MEDIA_ATTRIBUTES) {
  return candidates.reduce(
    (result, [attributeName, evidenceName]) => deactivateRemoteAttribute(result, attributeName, evidenceName),
    attributes,
  );
}

function frozenVideoAttributes(attributes) {
  return /(?:^|\s)data-matbox-frozen-video(?:\s*=|\s|$)/i.test(attributes)
    || /(?:^|\s)style\s*=\s*(["'])[^"']*background-image\s*:\s*url\(\s*(?:&quot;|&#0*34;|&#x0*22;)?data:image\/[\s\S]*?\1/i.test(attributes);
}

export function deactivateInactiveRemoteMedia(html) {
  if (typeof html !== 'string' || !/https?:\/\//i.test(html)) return html;

  const withoutInactiveImages = html.replace(/<img\b([^>]*)>/gi, (opening, attributes) => {
    if (!/(?:^|\s)data-matbox-image-visible\s*=\s*(["'])false\1/i.test(attributes)) return opening;
    return `<img${deactivateRemoteCandidates(attributes)}>`;
  });

  return withoutInactiveImages.replace(/<video\b([^>]*)>([\s\S]*?)<\/video>/gi, (video, attributes, body) => {
    if (!frozenVideoAttributes(attributes)) return video;
    const openingAttributes = deactivateRemoteCandidates(attributes, [['src', 'data-matbox-source-src']]);
    const nextBody = body.replace(/<source\b([^>]*)>/gi, (source, sourceAttributes) => (
      `<source${deactivateRemoteCandidates(sourceAttributes, [
        ['src', 'data-matbox-source-src'],
        ['srcset', 'data-matbox-source-srcset'],
      ])}>`
    ));
    return `<video${openingAttributes}>${nextBody}</video>`;
  });
}

function isZeroCounter(attributes, name) {
  return new RegExp(`\\b${name}=["']0["']`, 'i').test(attributes);
}

export function hideEmptyCommerceSkeletons(html) {
  if (typeof html !== 'string' || !html.includes('searchspring-category') || !/\bskeleton\b/i.test(html)) return html;
  let changed = false;
  const sanitized = html.replace(/<([a-z][\w:-]*)\b([^>]*\bid=["']searchspring-category["'][^>]*)>/gi, (opening, tagName, attributes, offset) => {
    if (!isZeroCounter(attributes, 'data-matbox-initial-product-count') || !isZeroCounter(attributes, 'data-matbox-final-product-count')) return opening;
    const widgetTail = html.slice(offset + opening.length, offset + opening.length + 200_000);
    const nextBoundary = widgetTail.search(/\bcategory-description-bottom\b|<footer\b/i);
    const widgetMarkup = nextBoundary >= 0 ? widgetTail.slice(0, nextBoundary) : widgetTail;
    if (!/class=["'][^"']*\bproduct-card-image\b[^"']*\bskeleton\b/i.test(widgetMarkup)) return opening;
    changed = true;
    return `<${tagName}${attributes} data-matbox-empty-commerce-skeleton>`;
  });
  if (!changed || sanitized.includes('data-matbox-empty-commerce-skeleton>#searchspring-category')) return sanitized;
  return sanitized.includes('</head>')
    ? sanitized.replace('</head>', `${EMPTY_COMMERCE_STYLE}</head>`)
    : `${EMPTY_COMMERCE_STYLE}${sanitized}`;
}

export function restoreResponsiveFullWidthLayoutBoxes(html, { captureWidth = 1440 } = {}) {
  if (typeof html !== 'string' || !html.includes('data-matbox-frozen-')) return html;
  // Full-width source sections are often captured inside page padding, so
  // their painted width is smaller than the raw viewport (for example 1401
  // or 1377 at a 1440 capture). Treat the outer 90% as fluid; the source
  // stylesheet's max-width still constrains genuinely limited containers.
  const minimumFullWidth = captureWidth * 0.9;
  return html.replace(/<([a-z][\w:-]*)\b([^>]*data-matbox-frozen-(?:layout|card-grid)-box=["']true["'][^>]*)>/gi, (opening, tagName, attributes) => {
    const styleMatch = attributes.match(/\bstyle=(["'])([\s\S]*?)\1/i);
    if (!styleMatch) return opening;
    const widthMatch = styleMatch[2].match(/\bwidth:\s*([\d.]+)px\s*!important/i);
    if (!widthMatch) return opening;
    const responsiveMode = attributes.match(/\bdata-matbox-responsive-width=(["'])(fluid|constrained)\1/i)?.[2]?.toLowerCase();
    const legacyCardGrid = responsiveMode == null && /\bdata-matbox-frozen-card-grid-box=["']true["']/i.test(attributes);
    if (responsiveMode === 'constrained') return opening;
    if (responsiveMode !== 'fluid' && !legacyCardGrid && Number(widthMatch[1]) < minimumFullWidth) return opening;
    const capturedWidth = Number(widthMatch[1]);
    const nextStyle = styleMatch[2].replace(/\bwidth:\s*[\d.]+px\s*!important/i, 'width:100% !important');
    let nextAttributes = attributes.replace(styleMatch[0], `style=${styleMatch[1]}${nextStyle}${styleMatch[1]}`);
    const inferred = [
      ['data-matbox-responsive-width', 'fluid'],
      ['data-matbox-captured-width', String(capturedWidth)],
      ['data-matbox-captured-parent-width', String(captureWidth)],
      ['data-matbox-width-ratio', String(Number((capturedWidth / captureWidth).toFixed(6)))],
    ];
    for (const [name, value] of inferred) {
      if (!new RegExp(`\\b${name}=`, 'i').test(nextAttributes)) nextAttributes += ` ${name}="${value}"`;
    }
    return `<${tagName}${nextAttributes} data-matbox-responsive-full-width="true">`;
  });
}

export function restoreResponsivePageContainers(html) {
  if (typeof html !== 'string' || html.includes('data-matbox-responsive-page-containers')) return html;
  return html.includes('</head>')
    ? html.replace('</head>', `${RESPONSIVE_PAGE_CONTAINER_STYLE}</head>`)
    : `${RESPONSIVE_PAGE_CONTAINER_STYLE}${html}`;
}

export function restoreResponsiveAutoSizedCardGridItems(html) {
  if (typeof html !== 'string'
    || html.includes('data-matbox-responsive-auto-sized-card-grid-items')
    || !html.includes('data-matbox-frozen-card-grid-box')
    || !html.includes('category-block')) return html;
  return html.includes('</head>')
    ? html.replace('</head>', `${RESPONSIVE_AUTO_SIZED_CARD_GRID_STYLE}</head>`)
    : `${RESPONSIVE_AUTO_SIZED_CARD_GRID_STYLE}${html}`;
}

function numericAttribute(attributes, name) {
  const value = attributes.match(new RegExp(`\\b${name}=["']([\\d.-]+)["']`, 'i'))?.[1];
  return value == null ? Number.NaN : Number(value);
}

export function restoreResponsiveContainedComponentBoxes(html) {
  if (typeof html !== 'string' || html.includes('data-matbox-responsive-contained-style')) return html;
  let changed = false;
  const restored = html.replace(/<([a-z][\w:-]*)\b([^>]*data-matbox-component-width=["'][\d.-]+["'][^>]*)>/gi, (opening, tagName, attributes) => {
    if (/\bdata-matbox-responsive-contained=/i.test(attributes)) return opening;
    const x = numericAttribute(attributes, 'data-matbox-component-x');
    const width = numericAttribute(attributes, 'data-matbox-component-width');
    const parentWidth = numericAttribute(attributes, 'data-matbox-component-parent-width');
    const viewportWidth = numericAttribute(attributes, 'data-matbox-component-viewport-width');
    const fullPageParent = Number.isFinite(parentWidth) && Number.isFinite(viewportWidth) && parentWidth >= viewportWidth * 0.9;
    const modestOverflow = Number.isFinite(width) && width <= viewportWidth * 1.05;
    if (!Number.isFinite(x) || x > 2 || !fullPageParent || !modestOverflow || width <= parentWidth + 2) return opening;
    changed = true;
    return `<${tagName}${attributes} data-matbox-responsive-contained="true">`;
  });
  if (!changed) return html;
  return restored.includes('</head>')
    ? restored.replace('</head>', `${RESPONSIVE_CONTAINED_COMPONENT_STYLE}</head>`)
    : `${RESPONSIVE_CONTAINED_COMPONENT_STYLE}${restored}`;
}

export function releaseResponsiveFrozenHeights(html) {
  if (typeof html !== 'string' || !/data-matbox-frozen-(?:main-region|card-grid-box)/i.test(html)) return html;
  return html.replace(/<([a-z][\w:-]*)\b([^>]*data-matbox-frozen-(?:main-region|card-grid-box)=["']true["'][^>]*)>/gi, (opening, tagName, attributes) => {
    const styleMatch = attributes.match(/\bstyle=(["'])([\s\S]*?)\1/i);
    if (!styleMatch || !/(?:^|;)\s*height:\s*[\d.]+px\s*!important/i.test(styleMatch[2])) return opening;
    const nextStyle = styleMatch[2].replace(/(^|;)\s*height:\s*([\d.]+px\s*!important)/i, '$1 min-height:$2');
    return `<${tagName}${attributes.replace(styleMatch[0], `style=${styleMatch[1]}${nextStyle}${styleMatch[1]}`)}>`;
  });
}

export function restoreInteractiveScrollbars(html) {
  if (typeof html !== 'string') return html;
  return html
    .replace(/<style\b[^>]*data-matbox-(?:live-)?hidden-scrollbar[^>]*>[\s\S]*?<\/style>/gi, '')
    .replace(/(<html\b[^>]*\bstyle=(['"])[\s\S]*?)scrollbar-width:\s*none\s*!important\s*;?/i, '$1')
    .replace(/\sstyle=(['"])\s*\1/i, '');
}

export function stripCaptureRevealStyles(html) {
  if (typeof html !== 'string' || !/visibility:\s*visible\s*!important/i.test(html)) return html;
  return html.replace(/<([a-z][\w:-]*)\b([^>]*)>/gi, (opening, tagName, attributes) => {
    const styleMatch = attributes.match(/\sstyle=(['"])([\s\S]*?)\1/i);
    if (!styleMatch) return opening;
    const captureReveal = /\bdisplay:\s*[^;]+!important/i.test(styleMatch[2])
      && /\bvisibility:\s*visible\s*!important/i.test(styleMatch[2])
      && /\bopacity:\s*1\s*!important/i.test(styleMatch[2]);
    if (!captureReveal) return opening;
    let style = styleMatch[2]
      .replace(/(?:^|\s*)display:\s*[^;]+!important\s*;?/gi, '')
      .replace(/(?:^|\s*)visibility:\s*visible\s*!important\s*;?/gi, '')
      .replace(/(?:^|\s*)opacity:\s*1\s*!important\s*;?/gi, '')
      .trim();
    const replacement = style ? ` style=${styleMatch[1]}${style}${styleMatch[1]}` : '';
    return `<${tagName}${attributes.replace(styleMatch[0], replacement)}>`;
  });
}
