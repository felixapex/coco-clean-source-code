import { renderComponentCss, renderLayoutCss } from './visual-css.mjs';

function escapeHtml(value) {
  return String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

function tagFor(role) {
  if (role === 'navigation') return 'nav';
  if (role === 'search-form') return 'form';
  if (role === 'product-card' || role === 'content-card') return 'article';
  if (role === 'modal') return 'section';
  if (role === 'filter-panel') return 'section';
  return 'section';
}

function renderContent(instance, family) {
  const c = instance.contentBindings ?? {};
  const out = [];
  if (c.media) out.push(`<img data-slot="media" src="${escapeHtml(c.media)}" alt="">`);
  if (c.title) out.push(`<h3 data-slot="title">${escapeHtml(c.title)}</h3>`);
  if (c.price) out.push(`<p data-slot="price">${escapeHtml(c.price)}</p>`);
  for (const label of c.actionLabels ?? []) out.push(`<button data-slot="action" type="button">${escapeHtml(label)}</button>`);
  if (family.semanticRole === 'navigation') {
    for (const item of c.items ?? []) out.push(`<span data-slot="item">${escapeHtml(item)}</span>`);
  }
  if (['dropdown','filter-panel'].includes(family.semanticRole)) {
    for (const option of c.options ?? []) out.push(`<span data-slot="option">${escapeHtml(option)}</span>`);
  }
  if (family.semanticRole === 'data-table' && Array.isArray(c.columns)) {
    out.push(`<table data-slot="table"><thead><tr>${c.columns.map((column) => `<th>${escapeHtml(column)}</th>`).join('')}</tr></thead><tbody></tbody></table>`);
  }
  return out.join('');
}

function renderInstance(instance, context) {
  const family = context.familyById.get(instance.familyId);
  if (!family) return '';
  const tag = tagFor(family.semanticRole);
  const children = (instance.childInstanceIds ?? [])
    .map((id) => context.instanceById.get(id))
    .filter(Boolean)
    .map((child) => renderInstance(child, context))
    .join('');
  return `<${tag} data-component="${escapeHtml(family.canonicalName)}" data-instance="${escapeHtml(instance.id)}" data-variant="${escapeHtml(instance.variant ?? 'default')}" data-state="${escapeHtml(instance.state ?? 'default')}">${renderContent(instance, family)}${children}</${tag}>`;
}

export function renderIrPreviewHtml(ir, routeId, options = {}) {
  const route = (ir.routes ?? []).find((item) => item.id === routeId) ?? ir.routes?.[0];
  if (!route) throw new Error(`Route not found: ${routeId}`);
  const familyById = new Map((ir.componentFamilies ?? []).map((family) => [family.id, family]));
  const instanceById = new Map((ir.componentInstances ?? []).map((instance) => [instance.id, instance]));
  const topLevel = (ir.componentInstances ?? [])
    .filter((instance) => instance.routeId === route.id)
    .filter((instance) => !instance.parentInstanceId || !instanceById.has(instance.parentInstanceId))
    .sort((a, b) => (a.bbox?.y ?? 0) - (b.bbox?.y ?? 0) || (a.bbox?.x ?? 0) - (b.bbox?.x ?? 0));
  const context = { familyById, instanceById };
  const componentCss = options.componentCss !== undefined
    ? options.componentCss
    : (options.includeVisualStyles === false ? '' : renderComponentCss(ir));
  const layoutCss = options.layoutCss !== undefined ? options.layoutCss : renderLayoutCss(ir);
  const css = `${componentCss}\n${layoutCss}`;
  return `<!doctype html><html><head><meta charset="utf-8"><style>html,body{padding:0;margin:0;}*{box-sizing:border-box;}button,input,select,textarea{font:inherit;}\n${css}</style></head><body><main data-route="${escapeHtml(route.path)}">${topLevel.map((instance) => renderInstance(instance, context)).join('')}</main></body></html>`;
}
