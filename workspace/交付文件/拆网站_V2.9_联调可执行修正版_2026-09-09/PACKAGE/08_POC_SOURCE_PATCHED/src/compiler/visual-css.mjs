const ROOT_STYLE_KEYS = new Set([
  'display','boxSizing','paddingTop','paddingRight','paddingBottom','paddingLeft','gap',
  'flexDirection','justifyContent','alignItems','gridTemplateColumns','fontFamily','fontSize',
  'fontWeight','lineHeight','color','backgroundColor','borderTopWidth','borderRightWidth',
  'borderBottomWidth','borderLeftWidth','borderTopColor','borderRightColor','borderBottomColor',
  'borderLeftColor','borderTopStyle','borderRightStyle','borderBottomStyle','borderLeftStyle',
  'borderRadius','boxShadow','opacity','transform','textAlign','overflow',
]);

const SLOT_STYLE_KEYS = new Set([
  ...ROOT_STYLE_KEYS,
  'width','height','marginTop','marginRight','marginBottom','marginLeft','position',
]);

function cssName(key) {
  return key.replace(/[A-Z]/g, (match) => `-${match.toLowerCase()}`);
}

function escapeCssString(value) {
  return String(value).replaceAll('\\', '\\\\').replaceAll('"', '\\"');
}

function styleDeclarations(style = {}, allowed = ROOT_STYLE_KEYS) {
  const entries = Object.entries(style)
    .filter(([key, value]) => allowed.has(key) && value !== undefined && value !== null && value !== '')
    .sort(([a], [b]) => a.localeCompare(b));
  return entries.map(([key, value]) => `  ${cssName(key)}: ${value};`).join('\n');
}

function rule(selector, style, allowed) {
  const declarations = styleDeclarations(style, allowed);
  return declarations ? `${selector} {\n${declarations}\n}` : '';
}

const SLOT_SELECTORS = {
  title: '[data-slot="title"]',
  price: '[data-slot="price"]',
  action: '[data-slot="action"]',
  media: '[data-slot="media"]',
};

export function renderComponentCss(ir) {
  const rules = [];
  for (const family of [...(ir.componentFamilies ?? [])].sort((a, b) => a.canonicalName.localeCompare(b.canonicalName))) {
    const profile = family.styleProfile ?? {};
    const base = `[data-component="${escapeCssString(family.canonicalName)}"]`;
    const baseRule = rule(base, profile.root ?? {}, ROOT_STYLE_KEYS);
    if (baseRule) rules.push(baseRule);

    for (const [slot, style] of Object.entries(profile.slots ?? {}).sort(([a], [b]) => a.localeCompare(b))) {
      const slotSelector = SLOT_SELECTORS[slot] ?? `[data-slot="${escapeCssString(slot)}"]`;
      const slotRule = rule(`${base} ${slotSelector}`, style, SLOT_STYLE_KEYS);
      if (slotRule) rules.push(slotRule);
    }

    for (const [variant, variantProfile] of Object.entries(profile.variants ?? {}).sort(([a], [b]) => a.localeCompare(b))) {
      const variantBase = `${base}[data-variant="${escapeCssString(variant)}"]`;
      const variantRule = rule(variantBase, variantProfile.root ?? {}, ROOT_STYLE_KEYS);
      if (variantRule) rules.push(variantRule);
      for (const [slot, style] of Object.entries(variantProfile.slots ?? {}).sort(([a], [b]) => a.localeCompare(b))) {
        const slotSelector = SLOT_SELECTORS[slot] ?? `[data-slot="${escapeCssString(slot)}"]`;
        const slotRule = rule(`${variantBase} ${slotSelector}`, style, SLOT_STYLE_KEYS);
        if (slotRule) rules.push(slotRule);
      }
    }
  }
  return `${rules.join('\n\n')}\n`;
}

function px(value) {
  const n = Number(value);
  return Number.isFinite(n) ? `${n}px` : '0px';
}

function routeHeight(route, instances) {
  const viewportHeight = Number(route.viewport?.height) || 0;
  const contentHeight = instances.reduce((max, instance) => Math.max(max, Number(instance.bbox?.y ?? 0) + Number(instance.bbox?.height ?? 0)), 0);
  return Math.max(viewportHeight, Math.ceil(contentHeight));
}

export function renderLayoutCss(ir) {
  const rules = [];
  const instanceById = new Map((ir.componentInstances ?? []).map((instance) => [instance.id, instance]));
  for (const route of ir.routes ?? []) {
    const routeInstances = (ir.componentInstances ?? []).filter((instance) => instance.routeId === route.id);
    const ds = route.documentStyle ?? {};
    const routeStyle = {
      position: 'relative',
      minHeight: `${routeHeight(route, routeInstances)}px`,
      width: route.viewport?.width ? `${route.viewport.width}px` : undefined,
      backgroundColor: ds.backgroundColor,
      color: ds.color,
      fontFamily: ds.fontFamily,
      fontSize: ds.fontSize,
      lineHeight: ds.lineHeight,
      marginTop: ds.marginTop,
      marginRight: ds.marginRight,
      marginBottom: ds.marginBottom,
      marginLeft: ds.marginLeft,
    };
    const routeRule = rule(`[data-route="${escapeCssString(route.path)}"]`, routeStyle, new Set([
      'position','minHeight','width','backgroundColor','color','fontFamily','fontSize','lineHeight',
      'marginTop','marginRight','marginBottom','marginLeft',
    ]));
    if (routeRule) rules.push(routeRule);

    for (const instance of routeInstances) {
      const parent = instance.parentInstanceId ? instanceById.get(instance.parentInstanceId) : null;
      const left = Number(instance.bbox?.x ?? 0) - Number(parent?.bbox?.x ?? 0);
      const top = Number(instance.bbox?.y ?? 0) - Number(parent?.bbox?.y ?? 0);
      const instanceStyle = {
        position: 'absolute',
        left: px(left),
        top: px(top),
        width: px(instance.bbox?.width ?? 0),
        height: px(instance.bbox?.height ?? 0),
      };
      const instanceRule = rule(`[data-route="${escapeCssString(route.path)}"] [data-instance="${escapeCssString(instance.id)}"]`, instanceStyle, new Set(['position','left','top','width','height']));
      if (instanceRule) rules.push(instanceRule);
    }
  }
  return `${rules.join('\n\n')}\n`;
}
