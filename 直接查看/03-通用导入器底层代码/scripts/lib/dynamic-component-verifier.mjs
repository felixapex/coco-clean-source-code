const FAMILY_RULES = [
  ['header', /header|site-header|announcement/i],
  ['navigation', /navigation|nav-|menu|mega/i],
  ['hero', /hero|banner|carousel|slideshow/i],
  ['listing', /product|collection|category|grid|listing/i],
  ['content', /content|text|image-with|editorial|article/i],
  ['form', /form|newsletter|signup|search/i],
  ['overlay', /modal|popup|drawer|dialog/i],
  ['footer', /footer/i],
];

function familyOf(component) {
  const value = `${component?.sourceSectionType || ''} ${component?.schema?.name || ''}`;
  return FAMILY_RULES.find(([, pattern]) => pattern.test(value))?.[0] || 'other';
}

export function selectRepresentativeComponents(registry = {}, limit = 8) {
  const components = (Array.isArray(registry.components) ? registry.components : [])
    .filter((component) => component?.matboxComponentId && component?.variants?.[0]?.markupHref);
  const selected = [];
  const selectedIds = new Set();
  const selectedTypes = new Set();
  for (const [family] of FAMILY_RULES) {
    const component = components.find((candidate) => familyOf(candidate) === family && !selectedIds.has(candidate.matboxComponentId));
    if (!component) continue;
    selected.push({ family, component });
    selectedIds.add(component.matboxComponentId);
    selectedTypes.add(component.sourceSectionType || component.schema?.name || component.matboxComponentId);
    if (selected.length >= limit) return selected;
  }
  for (const component of components) {
    if (selectedIds.has(component.matboxComponentId)) continue;
    const type = component.sourceSectionType || component.schema?.name || component.matboxComponentId;
    if (selectedTypes.has(type)) continue;
    selected.push({ family: familyOf(component), component });
    selectedIds.add(component.matboxComponentId);
    selectedTypes.add(type);
    if (selected.length >= limit) break;
  }
  for (const component of components) {
    if (selectedIds.has(component.matboxComponentId)) continue;
    selected.push({ family: familyOf(component), component });
    selectedIds.add(component.matboxComponentId);
    if (selected.length >= limit) break;
  }
  return selected;
}

export function buildSettingMutationExpression({
  settingId,
  settingType = '',
  blockId = '',
  marker = 'MATBOX_DYNAMIC_VERIFY',
} = {}) {
  const input = JSON.stringify({ settingId, settingType, blockId, marker });
  return `(() => {
    const input = ${input};
    const attr = (name, value) => '[' + name + '="' + CSS.escape(String(value)) + '"]';
    const section = document.querySelector('[data-section-id]');
    const blockSelector = input.blockId ? attr('data-block-id', input.blockId) : '';
    const settingSelector = attr('data-setting', input.settingId);
    const target = (blockSelector && document.querySelector(blockSelector + settingSelector))
      || document.querySelector(settingSelector)
      || section;
    if (!target || !section) return { pass: false, error: 'annotated target missing' };
    if (input.settingId === 'padding_top') {
      section.style.paddingTop = (parseFloat(getComputedStyle(section).paddingTop || '0') + 24) + 'px';
    } else if (input.settingId === 'padding_bottom') {
      section.style.paddingBottom = (parseFloat(getComputedStyle(section).paddingBottom || '0') + 24) + 'px';
    } else if (input.settingId === 'color_scheme' || input.settingType === 'color' || input.settingType === 'color_background') {
      section.style.background = 'rgb(19, 91, 173)';
      section.style.color = 'rgb(255, 245, 0)';
    } else if (input.settingType === 'image_picker' || target.tagName === 'IMG') {
      target.style.opacity = '0.25';
      target.style.outline = '8px solid rgb(255, 0, 170)';
      target.setAttribute('data-matbox-mutation', input.marker);
    } else if (input.settingType === 'url' || target.tagName === 'A') {
      target.setAttribute('href', '#matbox-dynamic-verification');
      target.style.outline = '8px solid rgb(255, 0, 170)';
    } else if (/richtext|text/.test(input.settingType) || ['heading', 'text', 'label'].includes(input.settingId)) {
      target.textContent = (target.textContent || '') + ' ' + input.marker;
    } else if (input.settingId === 'alignment' || input.settingType === 'text_alignment') {
      target.style.textAlign = getComputedStyle(target).textAlign === 'right' ? 'left' : 'right';
    } else {
      target.style.outline = '8px solid rgb(255, 0, 170)';
      target.style.transform = 'translateX(7px)';
    }
    target.setAttribute('data-matbox-mutation', input.marker);
    return { pass: true, targetTag: target.tagName, targetBlockId: target.getAttribute('data-block-id') || '' };
  })()`;
}
