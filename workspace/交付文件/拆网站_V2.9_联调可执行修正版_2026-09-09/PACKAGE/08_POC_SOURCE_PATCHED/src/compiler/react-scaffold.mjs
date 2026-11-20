import fs from 'node:fs/promises';
import path from 'node:path';
import { validateComponentIr } from '../ir/component-ir.mjs';
import { renderComponentCss, renderLayoutCss } from './visual-css.mjs';

function tsType(type) {
  if (type === 'number') return 'number';
  if (type === 'string[]') return 'readonly string[]';
  return 'string';
}

function union(values = []) {
  const items = [...new Set(values.filter(Boolean))];
  return items.length ? items.map((value) => JSON.stringify(value).replaceAll('"', "'")).join(' | ') : "'default'";
}

function symbolSuffix(value) {
  const stripped = String(value).replace(/^fam-/, '');
  const words = stripped.split(/[^a-zA-Z0-9]+/).filter(Boolean);
  const suffix = words.map((word) => word[0].toUpperCase() + word.slice(1)).join('');
  return suffix || 'Family';
}

function withUniqueFamilyNames(ir) {
  const counts = new Map();
  for (const family of ir.componentFamilies) {
    counts.set(family.canonicalName, (counts.get(family.canonicalName) ?? 0) + 1);
  }
  return {
    ...ir,
    componentFamilies: ir.componentFamilies.map((family) => ({
      ...family,
      canonicalName: counts.get(family.canonicalName) > 1
        ? `${family.canonicalName}_${symbolSuffix(family.id)}`
        : family.canonicalName,
    })),
  };
}

function componentTag(role) {
  if (role === 'navigation') return 'nav';
  if (role === 'search-form') return 'form';
  if (role === 'product-card' || role === 'content-card') return 'article';
  if (role === 'modal') return 'dialog';
  if (role === 'filter-panel') return 'section';
  return 'section';
}

function fieldRender(key) {
  if (key === 'media') return `{props.media ? <img data-slot="media" src={props.media} alt="" /> : null}`;
  if (key === 'title') return `{props.title ? <h3 data-slot="title">{props.title}</h3> : null}`;
  if (key === 'price') return `{props.price ? <p data-slot="price">{props.price}</p> : null}`;
  if (key === 'actionLabels') return `{props.actionLabels?.map((label, index) => <button data-slot="action" key={index} type="button">{label}</button>)}`;
  if (['items','options'].includes(key)) return `{props.${key}?.map((item, index) => <span key={index}>{item}</span>)}`;
  if (key === 'columns') return `{props.columns ? <table><thead><tr>{props.columns.map((column) => <th key={column}>{column}</th>)}</tr></thead><tbody /></table> : null}`;
  return '';
}

function renderFamilyComponent(family) {
  const name = family.canonicalName;
  const propLines = Object.entries(family.propsSchema ?? {}).map(([key, spec]) => {
    const optional = spec.required ? '' : '?';
    return `  ${key}${optional}: ${tsType(spec.type)};`;
  });
  propLines.push(`  variant?: ${union(family.variants)};`);
  propLines.push(`  state?: ${union(family.states)};`);
  propLines.push('  instanceId?: string;');
  propLines.push('  children?: any;');

  const renders = Object.keys(family.propsSchema ?? {}).map(fieldRender).filter(Boolean);
  const tag = componentTag(family.semanticRole);
  const rowCountAttr = family.propsSchema?.rowCount ? ' data-row-count={props.rowCount}' : '';

  return `export interface ${name}Props {\n${propLines.join('\n')}\n}\n\nexport function ${name}(props: Readonly<${name}Props>) {\n  return (\n    <${tag} data-component="${name}" data-instance={props.instanceId} data-variant={props.variant ?? 'default'} data-state={props.state ?? 'default'}${rowCountAttr}>\n      ${renders.join('\n      ')}\n      {props.children}\n    </${tag}>\n  );\n}\n`;
}



function cssTokenValue(value) {
  if (typeof value === 'string' || typeof value === 'number') return String(value);
  return JSON.stringify(value);
}

function flattenDtcgTokens(tokens, prefix = [], out = []) {
  if (!tokens || typeof tokens !== 'object') return out;
  if (Object.prototype.hasOwnProperty.call(tokens, '$value')) {
    out.push({ name: prefix.join('-').replace(/[^a-zA-Z0-9_-]+/g, '-').toLowerCase(), value: cssTokenValue(tokens.$value) });
    return out;
  }
  for (const [key, value] of Object.entries(tokens)) {
    if (key.startsWith('$')) continue;
    flattenDtcgTokens(value, [...prefix, key], out);
  }
  return out;
}

function renderTokenCss(tokens) {
  const entries = flattenDtcgTokens(tokens);
  if (!entries.length) return ':root {\n}\n';
  return `:root {\n${entries.map((entry) => `  --${entry.name}: ${entry.value};`).join('\n')}\n}\n`;
}

function pageNameFor(route) {
  if (route.path === '/' || route.path === '') return 'HomePage';
  const words = route.path.split('/').filter(Boolean).flatMap((part) => part.split(/[^a-zA-Z0-9]+/).filter(Boolean));
  return `${words.map((word) => word[0]?.toUpperCase() + word.slice(1)).join('') || 'Route'}Page`;
}

function instanceOrder(a, b) {
  const ay = a.bbox?.y ?? 0, by = b.bbox?.y ?? 0;
  if (ay !== by) return ay - by;
  const ax = a.bbox?.x ?? 0, bx = b.bbox?.x ?? 0;
  if (ax !== bx) return ax - bx;
  return String(a.id).localeCompare(String(b.id));
}

function jsxPropValue(value) {
  return `{${JSON.stringify(value)}}`;
}

function renderInstance(instance, context, depth = 2) {
  const family = context.familyById.get(instance.familyId);
  if (!family) throw new Error(`Missing family ${instance.familyId}`);
  const indent = '  '.repeat(depth);
  const props = [];
  for (const key of Object.keys(family.propsSchema ?? {})) {
    const value = instance.contentBindings?.[key];
    if (value === undefined || value === null) continue;
    props.push(`${key}=${jsxPropValue(value)}`);
  }
  props.push(`instanceId=${jsxPropValue(instance.id)}`);
  if (instance.variant) props.push(`variant=${jsxPropValue(instance.variant)}`);
  if (instance.state) props.push(`state=${jsxPropValue(instance.state)}`);
  const propText = props.length ? ` ${props.join(' ')}` : '';
  const children = (instance.childInstanceIds ?? [])
    .map((id) => context.instanceById.get(id))
    .filter((child) => child?.routeId === instance.routeId)
    .sort(instanceOrder);
  if (!children.length) return `${indent}<${family.canonicalName}${propText} />`;
  const renderedChildren = children.map((child) => renderInstance(child, context, depth + 1)).join('\n');
  return `${indent}<${family.canonicalName}${propText}>\n${renderedChildren}\n${indent}</${family.canonicalName}>`;
}

function renderRoutePage(route, ir, options = {}) {
  const familyById = new Map(ir.componentFamilies.map((family) => [family.id, family]));
  const instanceById = new Map(ir.componentInstances.map((instance) => [instance.id, instance]));
  const routeInstances = ir.componentInstances.filter((instance) => instance.routeId === route.id);
  const usedFamilies = [...new Map(routeInstances.map((instance) => {
    const family = familyById.get(instance.familyId);
    return [family?.canonicalName, family];
  }).filter(([name, family]) => name && family)).values()].sort((a, b) => a.canonicalName.localeCompare(b.canonicalName));
  const imports = usedFamilies.map((family) => `import { ${family.canonicalName} } from '../components/${family.canonicalName}${options.importExtension ?? ''}';`).join('\n');
  const topLevel = routeInstances.filter((instance) => !instance.parentInstanceId || !instanceById.has(instance.parentInstanceId)).sort(instanceOrder);
  const context = { familyById, instanceById };
  const body = topLevel.map((instance) => renderInstance(instance, context, 3)).join('\n');
  const pageName = pageNameFor(route);
  return `${imports}\n\nexport function ${pageName}() {\n  return (\n    <main data-route=${jsxPropValue(route.path)}>\n${body}\n    </main>\n  );\n}\n`;
}



function renderAppEntry(ir) {
  const imports = ir.routes.map((route, index) => {
    const name = pageNameFor(route);
    return `import { ${name} } from './pages/${name}.js';`;
  }).join('\n');
  const routeEntries = ir.routes.map((route) => `  ${JSON.stringify(route.path || '/')}: ${pageNameFor(route)},`).join('\n');
  const fallback = pageNameFor(ir.routes[0]);
  return `${imports}\nimport './index.css';\n\ndeclare const React: any;\ndeclare const ReactDOM: any;\n\nconst routes: Record<string, any> = {\n${routeEntries}\n};\nconst Page = routes[window.location.pathname] ?? ${fallback};\nconst root = document.getElementById('root');\nif (!root) throw new Error('Missing #root mount point');\nReactDOM.createRoot(root).render(React.createElement(Page));\n`;
}

function escapeHtmlAttribute(value) {
  return String(value).replaceAll('&', '&amp;').replaceAll('"', '&quot;');
}

function prepareRenderedDocument(renderedDocument) {
  let html = String(renderedDocument?.html ?? '');
  if (!html) return '';
  if (!/<base\b/i.test(html)) {
    const base = `<base href="${escapeHtmlAttribute(renderedDocument?.sourceUrl ?? 'about:blank')}">`;
    if (/<head(?:\s[^>]*)?>/i.test(html)) html = html.replace(/<head(?:\s[^>]*)?>/i, (match) => `${match}${base}`);
    else html = html.replace(/<html(?:\s[^>]*)?>/i, (match) => `${match}<head>${base}</head>`);
  }
  return html;
}

async function emitRenderedDocuments(ir, outDir) {
  const replayDir = path.join(outDir, 'src', 'replay');
  const routes = {};
  for (const route of ir.routes ?? []) {
    const html = prepareRenderedDocument(route.renderedDocument);
    if (!html) continue;
    await fs.mkdir(replayDir, { recursive: true });
    const filename = `${route.id}.html`;
    await fs.writeFile(path.join(replayDir, filename), html, 'utf8');
    routes[route.path || '/'] = filename;
  }
  if (Object.keys(routes).length) {
    await fs.writeFile(path.join(replayDir, 'routes.json'), JSON.stringify(routes, null, 2) + '\n', 'utf8');
  }
}

const POC_REACT_RUNTIME = `(() => {
  const TEXT = Symbol('text');
  const flatten = (items) => items.flat(Infinity).filter((item) => item !== null && item !== undefined && item !== false && item !== true);
  function createElement(type, props, ...children) {
    return { type, props: props || {}, children: flatten(children) };
  }
  function toDom(vnode) {
    if (typeof vnode === 'string' || typeof vnode === 'number') return document.createTextNode(String(vnode));
    if (!vnode) return document.createTextNode('');
    if (typeof vnode.type === 'function') return toDom(vnode.type({ ...vnode.props, children: vnode.children }));
    const el = document.createElement(vnode.type);
    for (const [key, value] of Object.entries(vnode.props || {})) {
      if (key === 'children' || value === undefined || value === null || value === false) continue;
      if (key === 'className') { el.setAttribute('class', String(value)); continue; }
      if (key.startsWith('on') && typeof value === 'function') { el.addEventListener(key.slice(2).toLowerCase(), value); continue; }
      if (value === true) { el.setAttribute(key, ''); continue; }
      el.setAttribute(key, String(value));
    }
    for (const child of vnode.children || []) el.appendChild(toDom(child));
    return el;
  }
  globalThis.React = { createElement, Fragment: TEXT };
  globalThis.ReactDOM = {
    createRoot(container) {
      return { render(vnode) { container.replaceChildren(toDom(vnode)); } };
    },
  };
})();\n`;

function buildScriptSource() {
  return `import fs from 'node:fs/promises';\nimport path from 'node:path';\nimport { spawnSync } from 'node:child_process';\n\nconst root = process.cwd();\nconst dist = path.join(root, 'dist');\nawait fs.rm(dist, { recursive: true, force: true });\nawait fs.mkdir(path.join(dist, 'app'), { recursive: true });\nawait fs.mkdir(path.join(dist, 'vendor'), { recursive: true });\nconst tsc = spawnSync('tsc', ['-p', 'tsconfig.build.json'], { cwd: root, stdio: 'inherit' });\nif (tsc.status !== 0) process.exit(tsc.status ?? 1);\nfor (const file of ['index.css', 'design-tokens.css', 'component-styles.css', 'layout.css']) {\n  await fs.copyFile(path.join(root, 'src', file), path.join(dist, 'app', file));\n}\nawait fs.copyFile(path.join(root, 'vendor', 'react-poc-runtime.js'), path.join(dist, 'vendor', 'react-poc-runtime.js'));\nconst componentDir = path.join(dist, 'app', 'components');\nconst pageDir = path.join(dist, 'app', 'pages');\nconst stripModuleSyntax = (source) => source.replace(/^import .*?;\\n/gm, '').replace(/\\bexport\\s+(?=(function|const|let|var|class)\\b)/g, '');\nconst componentFiles = (await fs.readdir(componentDir)).filter((name) => name.endsWith('.js')).sort();\nconst pageFiles = (await fs.readdir(pageDir)).filter((name) => name.endsWith('.js')).sort();\nconst chunks = [];\nfor (const name of componentFiles) chunks.push(stripModuleSyntax(await fs.readFile(path.join(componentDir, name), 'utf8')));\nfor (const name of pageFiles) chunks.push(stripModuleSyntax(await fs.readFile(path.join(pageDir, name), 'utf8')));\nchunks.push(stripModuleSyntax(await fs.readFile(path.join(dist, 'app', 'main.js'), 'utf8')));\nawait fs.writeFile(path.join(dist, 'app.js'), chunks.join('\\n'), 'utf8');\nawait fs.writeFile(path.join(dist, 'index.html'), '<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/app/index.css"></head><body><div id="root"></div><script src="/vendor/react-poc-runtime.js"></script><script src="/app.js"></script></body></html>\\n');\nconsole.log(JSON.stringify({ ok: true, dist }, null, 2));\n`;
}

function serveScriptSource() {
  return `import http from 'node:http';\nimport fs from 'node:fs/promises';\nimport path from 'node:path';\n\nconst args = process.argv.slice(2);\nconst portIndex = args.indexOf('--port');\nconst port = Number(portIndex >= 0 ? args[portIndex + 1] : process.env.PORT || 4173);\nconst host = process.env.HOST || '127.0.0.1';\nconst root = path.join(process.cwd(), 'dist');\nconst mime = { '.html':'text/html; charset=utf-8', '.js':'text/javascript; charset=utf-8', '.css':'text/css; charset=utf-8', '.json':'application/json; charset=utf-8', '.png':'image/png', '.jpg':'image/jpeg', '.jpeg':'image/jpeg', '.svg':'image/svg+xml' };\nlet replayRoutes = {};\ntry { replayRoutes = JSON.parse(await fs.readFile(path.join(root, 'replay', 'routes.json'), 'utf8')); } catch {}\nconst server = http.createServer(async (req, res) => {\n  try {\n    const urlPath = decodeURIComponent(new URL(req.url || '/', 'http://localhost').pathname);\n    const replayFile = replayRoutes[urlPath];\n    let file = replayFile ? path.join(root, 'replay', replayFile) : path.join(root, urlPath === '/' ? 'index.html' : urlPath.slice(1));\n    if (!file.startsWith(root)) throw new Error('invalid path');\n    try { await fs.access(file); } catch { file = path.join(root, 'index.html'); }\n    const body = await fs.readFile(file);\n    res.writeHead(200, { 'content-type': mime[path.extname(file)] || 'application/octet-stream', 'cache-control': 'no-store' });\n    res.end(body);\n  } catch (error) { res.writeHead(500); res.end(String(error)); }\n});\nserver.listen(port, host, () => console.log('MATBOX_POC_SERVER http://' + host + ':' + port));\n`;
}

async function emitRunnableWorkspace(ir, outDir) {
  await fs.mkdir(path.join(outDir, 'scripts'), { recursive: true });
  await fs.mkdir(path.join(outDir, 'vendor'), { recursive: true });
  await fs.writeFile(path.join(outDir, 'package.json'), JSON.stringify({
    name: 'matbox-reconstructed-site-poc',
    version: '2.9.0',
    private: true,
    type: 'module',
    engines: { node: '>=22.13 <23' },
    devDependencies: { typescript: '5.9.3' },
    scripts: { check: 'tsc -p tsconfig.json --noEmit', build: 'node scripts/build.mjs', start: 'node scripts/serve.mjs' },
  }, null, 2) + '\n', 'utf8');
  await fs.writeFile(path.join(outDir, 'src', 'main.tsx'), renderAppEntry(ir), 'utf8');
  await emitRenderedDocuments(ir, outDir);
  await fs.writeFile(path.join(outDir, 'vendor', 'react-poc-runtime.js'), POC_REACT_RUNTIME, 'utf8');
  await fs.copyFile(new URL('./runnable-build-template.mjs', import.meta.url), path.join(outDir, 'scripts', 'build.mjs'));
  await fs.writeFile(path.join(outDir, 'scripts', 'serve.mjs'), serveScriptSource(), 'utf8');
  await fs.writeFile(path.join(outDir, 'tsconfig.build.json'), JSON.stringify({
    compilerOptions: {
      target: 'ES2022', module: 'ESNext', moduleResolution: 'Bundler', jsx: 'react', strict: true,
      skipLibCheck: true, noEmit: false, rootDir: 'src', outDir: 'dist/app', lib: ['ES2022', 'DOM'],
    },
    include: ['src/**/*'],
  }, null, 2) + '\n', 'utf8');
}

export async function compileReactScaffold(ir, outDir, options = {}) {
  const validation = validateComponentIr(ir);
  if (!validation.ok) throw new Error(`Invalid Component IR: ${validation.errors.join('; ')}`);
  const compiledIr = withUniqueFamilyNames(ir);
  const componentsDir = path.join(outDir, 'src', 'components');
  const pagesDir = path.join(outDir, 'src', 'pages');
  await fs.mkdir(componentsDir, { recursive: true });
  await fs.mkdir(pagesDir, { recursive: true });
  for (const family of compiledIr.componentFamilies) {
    await fs.writeFile(path.join(componentsDir, `${family.canonicalName}.tsx`), renderFamilyComponent(family), 'utf8');
  }
  for (const route of compiledIr.routes) {
    await fs.writeFile(path.join(pagesDir, `${pageNameFor(route)}.tsx`), renderRoutePage(route, compiledIr, { importExtension: options.runnable ? '.js' : '' }), 'utf8');
  }
  const registry = compiledIr.componentFamilies
    .slice()
    .sort((a, b) => a.canonicalName.localeCompare(b.canonicalName))
    .map((family) => `export { ${family.canonicalName} } from './components/${family.canonicalName}';`)
    .join('\n') + '\n';
  await fs.writeFile(path.join(outDir, 'src', 'component-registry.ts'), registry, 'utf8');
  await fs.writeFile(path.join(outDir, 'src', 'design-tokens.css'), renderTokenCss(compiledIr.designSystem?.tokens ?? {}), 'utf8');
  const componentCss = options.includeVisualStyles === false ? '' : renderComponentCss(compiledIr);
  await fs.writeFile(path.join(outDir, 'src', 'component-styles.css'), componentCss, 'utf8');
  await fs.writeFile(path.join(outDir, 'src', 'layout.css'), renderLayoutCss(compiledIr), 'utf8');
  await fs.writeFile(path.join(outDir, 'src', 'index.css'), `@import './design-tokens.css';
@import './component-styles.css';
@import './layout.css';
`, 'utf8');
  await fs.writeFile(path.join(outDir, 'src', 'jsx-shim.d.ts'), `declare const React: any;
declare const ReactDOM: any;
declare namespace JSX {
  interface IntrinsicElements {
    [elemName: string]: any;
  }
}
`, 'utf8');
  await fs.writeFile(path.join(outDir, 'tsconfig.json'), JSON.stringify({
    compilerOptions: {
      target: 'ES2022',
      module: 'ESNext',
      moduleResolution: 'Bundler',
      jsx: 'preserve',
      strict: true,
      skipLibCheck: true,
      noEmit: true,
      lib: ['ES2022', 'DOM'],
    },
    include: ['src/**/*'],
  }, null, 2) + '\n', 'utf8');
  if (options.runnable) await emitRunnableWorkspace(compiledIr, outDir);
  return { outDir, componentCount: compiledIr.componentFamilies.length, pageCount: compiledIr.routes.length, runnable: Boolean(options.runnable) };
}
