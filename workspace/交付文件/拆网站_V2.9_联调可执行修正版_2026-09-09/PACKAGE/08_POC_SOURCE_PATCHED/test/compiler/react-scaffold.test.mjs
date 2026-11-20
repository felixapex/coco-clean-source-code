import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { compileReactScaffold } from '../../src/compiler/react-scaffold.mjs';

function sampleIr() {
  return {
    irVersion: '0.1',
    site: { id: 'shop-example', sourceUrl: 'https://shop.example.com/', capturedAt: new Date().toISOString() },
    designSystem: { tokenFormat: 'dtcg-2025.10', tokens: { color: { primary: { $value: '#111111', $type: 'color' } } } },
    routes: [{ id: 'route-home', path: '/', title: 'Home', sections: ['main'], evidenceIds: [] }],
    componentFamilies: [
      {
        id: 'fam-nav', canonicalName: 'Navigation', semanticRole: 'navigation', confidence: 1, occurrenceCount: 1, routeIds: ['route-home'],
        propsSchema: { items: { type: 'string[]', required: true } }, slots: ['body'], variants: ['default'], states: ['default'], fingerprints: {}, evidenceIds: [],
      },
      {
        id: 'fam-dropdown', canonicalName: 'Dropdown', semanticRole: 'dropdown', confidence: 1, occurrenceCount: 1, routeIds: ['route-home'],
        propsSchema: { options: { type: 'string[]', required: true } }, slots: ['body'], variants: ['default'], states: ['default','expanded'], fingerprints: {}, evidenceIds: [],
      },
      {
        id: 'fam-product', canonicalName: 'ProductCard', semanticRole: 'product-card', confidence: 1, occurrenceCount: 1, routeIds: ['route-home'],
        propsSchema: { title: { type: 'string', required: true }, price: { type: 'money', required: true }, media: { type: 'asset', required: false } },
        slots: ['media','title','meta'], variants: ['default','compact'], states: ['default','hover','selected'], fingerprints: {}, evidenceIds: [],
      },
      {
        id: 'fam-table', canonicalName: 'DataTable', semanticRole: 'data-table', confidence: 1, occurrenceCount: 1, routeIds: ['route-home'],
        propsSchema: { columns: { type: 'string[]', required: true }, rowCount: { type: 'number', required: true } },
        slots: ['body'], variants: ['default'], states: ['default','sorted','loading','empty','error'], fingerprints: {}, evidenceIds: [],
      },
    ],
    componentInstances: [
      { id: 'inst-nav', familyId: 'fam-nav', routeId: 'route-home', bbox: { x: 0,y:0,width:100,height:20 }, contentBindings: { items: ['Home','Shop'] }, variant: 'default', state: 'default', parentInstanceId: null, childInstanceIds: ['inst-dropdown'], evidenceIds: [] },
      { id: 'inst-dropdown', familyId: 'fam-dropdown', routeId: 'route-home', bbox: { x: 20,y:5,width:20,height:10 }, contentBindings: { options: ['Profile','Logout'] }, variant: 'default', state: 'default', parentInstanceId: 'inst-nav', childInstanceIds: [], evidenceIds: [] },
      { id: 'inst-product', familyId: 'fam-product', routeId: 'route-home', bbox: { x: 0,y:40,width:40,height:50 }, contentBindings: { title: 'Chair', price: '$99', media: '/chair.jpg' }, variant: 'compact', state: 'hover', parentInstanceId: null, childInstanceIds: [], evidenceIds: [] },
      { id: 'inst-table', familyId: 'fam-table', routeId: 'route-home', bbox: { x: 0,y:100,width:100,height:60 }, contentBindings: { columns: ['Order','Status'], rowCount: 2 }, variant: 'default', state: 'loading', parentInstanceId: null, childInstanceIds: [], evidenceIds: [] },
    ],
    interactions: [], assets: [], evidence: [], compileTargets: [],
  };
}

test('compiler emits one typed TSX component per family with props, variant and state unions', async () => {
  const out = await fs.mkdtemp(path.join(os.tmpdir(), 'react-scaffold-'));
  await compileReactScaffold(sampleIr(), out);

  const product = await fs.readFile(path.join(out, 'src/components/ProductCard.tsx'), 'utf8');
  assert.match(product, /export interface ProductCardProps/);
  assert.match(product, /title: string;/);
  assert.match(product, /price: string;/);
  assert.match(product, /media\?: string;/);
  assert.match(product, /variant\?: 'default' \| 'compact';/);
  assert.match(product, /state\?: 'default' \| 'hover' \| 'selected';/);

  const table = await fs.readFile(path.join(out, 'src/components/DataTable.tsx'), 'utf8');
  assert.match(table, /columns: readonly string\[\];/);
  assert.match(table, /rowCount: number;/);
  assert.match(table, /state\?: 'default' \| 'sorted' \| 'loading' \| 'empty' \| 'error';/);
});

test('compiler emits deterministic route pages with nested component hierarchy and registry exports', async () => {
  const out = await fs.mkdtemp(path.join(os.tmpdir(), 'react-scaffold-pages-'));
  await compileReactScaffold(sampleIr(), out);

  const page = await fs.readFile(path.join(out, 'src/pages/HomePage.tsx'), 'utf8');
  assert.match(page, /import \{ Navigation \} from '\.\.\/components\/Navigation';/);
  assert.match(page, /import \{ Dropdown \} from '\.\.\/components\/Dropdown';/);
  assert.match(page, /<Navigation[^>]*items=\{\["Home","Shop"\]\}[^>]*>/);
  assert.match(page, /<Dropdown[^>]*options=\{\["Profile","Logout"\]\}[^>]*\/>/);
  assert.match(page, /<\/Navigation>/);
  assert.equal((page.match(/<Dropdown/g) ?? []).length, 1, 'nested child must not be duplicated as a top-level sibling');

  const registry = await fs.readFile(path.join(out, 'src/component-registry.ts'), 'utf8');
  assert.match(registry, /export \{ ProductCard \} from '\.\/components\/ProductCard';/);
  assert.match(registry, /export \{ DataTable \} from '\.\/components\/DataTable';/);
});

test('compiler assigns stable unique symbols when distinct families share a canonical name', async () => {
  const ir = sampleIr();
  ir.componentFamilies.push({
    id: 'fam-product-alt', canonicalName: 'ProductCard', semanticRole: 'product-card', confidence: 1, occurrenceCount: 1, routeIds: ['route-home'],
    propsSchema: { title: { type: 'string', required: true } }, slots: ['title'], variants: ['default'], states: ['default'], fingerprints: {}, evidenceIds: [],
  });
  ir.componentInstances.push({
    id: 'inst-product-alt', familyId: 'fam-product-alt', routeId: 'route-home', bbox: { x: 50,y:40,width:40,height:50 },
    contentBindings: { title: 'Lamp' }, variant: 'default', state: 'default', parentInstanceId: null, childInstanceIds: [], evidenceIds: [],
  });
  const out = await fs.mkdtemp(path.join(os.tmpdir(), 'react-scaffold-duplicate-family-names-'));
  await compileReactScaffold(ir, out);

  await fs.access(path.join(out, 'src/components/ProductCard_Product.tsx'));
  await fs.access(path.join(out, 'src/components/ProductCard_ProductAlt.tsx'));
  const page = await fs.readFile(path.join(out, 'src/pages/HomePage.tsx'), 'utf8');
  assert.match(page, /import \{ ProductCard_Product \} from '\.\.\/components\/ProductCard_Product';/);
  assert.match(page, /import \{ ProductCard_ProductAlt \} from '\.\.\/components\/ProductCard_ProductAlt';/);
  assert.match(page, /<ProductCard_Product[^>]*price=\{"\$99"\}/);
  assert.match(page, /<ProductCard_ProductAlt[^>]*title=\{"Lamp"\}/);
});

test('compiler emits DTCG CSS variables and a dependency-free TSX scaffold that passes tsc', async () => {
  const { spawnSync } = await import('node:child_process');
  const out = await fs.mkdtemp(path.join(os.tmpdir(), 'react-scaffold-tsc-'));
  await compileReactScaffold(sampleIr(), out);

  const css = await fs.readFile(path.join(out, 'src/design-tokens.css'), 'utf8');
  assert.match(css, /--color-primary: #111111;/);
  await fs.access(path.join(out, 'src/jsx-shim.d.ts'));
  await fs.access(path.join(out, 'tsconfig.json'));

  const tscEntry = path.join(process.cwd(), 'node_modules', 'typescript', 'bin', 'tsc');
  const result = spawnSync(process.execPath, [tscEntry, '-p', path.join(out, 'tsconfig.json'), '--noEmit'], { encoding: 'utf8' });
  assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`);
});

test('compiler emits fidelity component CSS, route geometry CSS, and instance ids for visual replay', async () => {
  const ir = sampleIr();
  ir.routes[0].viewport = { width: 800, height: 600, devicePixelRatio: 1 };
  ir.routes[0].documentStyle = { backgroundColor: 'rgb(248, 248, 248)', color: 'rgb(20, 20, 20)', fontFamily: 'Arial', marginTop: '0px', marginRight: '0px', marginBottom: '0px', marginLeft: '0px' };
  const product = ir.componentFamilies.find((family) => family.semanticRole === 'product-card');
  product.styleProfile = {
    root: { display: 'block', boxSizing: 'border-box', paddingTop: '20px', paddingRight: '20px', paddingBottom: '20px', paddingLeft: '20px', backgroundColor: 'rgb(255, 245, 235)', borderTopStyle: 'solid', borderRadius: '18px', color: 'rgb(35, 35, 35)', fontFamily: 'Arial', fontSize: '16px', lineHeight: '22px' },
    slots: { title: { fontSize: '26px', fontWeight: '700', lineHeight: '30px', marginTop: '0px', marginBottom: '12px' }, price: { fontSize: '20px', lineHeight: '24px', color: 'rgb(150, 60, 20)', marginTop: '0px', marginBottom: '14px' } },
    variants: { compact: { root: { paddingTop: '10px', paddingRight: '10px', paddingBottom: '10px', paddingLeft: '10px' }, slots: {} } },
  };
  const out = await fs.mkdtemp(path.join(os.tmpdir(), 'react-scaffold-visual-css-'));
  await compileReactScaffold(ir, out);

  const componentCss = await fs.readFile(path.join(out, 'src/component-styles.css'), 'utf8');
  assert.match(componentCss, /\[data-component="ProductCard"\][^{]*\{/);
  assert.match(componentCss, /background-color: rgb\(255, 245, 235\);/);
  assert.match(componentCss, /border-top-style: solid;/);
  assert.match(componentCss, /\[data-component="ProductCard"\] \[data-slot="title"\]/);
  assert.match(componentCss, /\[data-component="ProductCard"\]\[data-variant="compact"\]/);

  const layoutCss = await fs.readFile(path.join(out, 'src/layout.css'), 'utf8');
  assert.match(layoutCss, /\[data-route="\/"\]/);
  assert.match(layoutCss, /min-height: 600px;/);
  assert.match(layoutCss, /\[data-instance="inst-product"\]/);
  assert.match(layoutCss, /left: 0px;/);
  assert.match(layoutCss, /top: 40px;/);
  assert.match(layoutCss, /width: 40px;/);
  assert.match(layoutCss, /height: 50px;/);

  const page = await fs.readFile(path.join(out, 'src/pages/HomePage.tsx'), 'utf8');
  assert.match(page, /instanceId=\{"inst-product"\}/);
  const component = await fs.readFile(path.join(out, 'src/components/ProductCard.tsx'), 'utf8');
  assert.match(component, /instanceId\?: string;/);
  assert.match(component, /data-instance=\{props\.instanceId\}/);
  assert.match(component, /data-slot="title"/);
});


test('compiler can emit a structure-only baseline without component visual styles', async () => {
  const ir = sampleIr();
  const product = ir.componentFamilies.find((family) => family.semanticRole === 'product-card');
  product.styleProfile = {
    root: { backgroundColor: 'rgb(255, 245, 235)', borderTopStyle: 'solid' },
    slots: {},
    variants: {},
  };
  const out = await fs.mkdtemp(path.join(os.tmpdir(), 'react-scaffold-structure-only-'));
  await compileReactScaffold(ir, out, { includeVisualStyles: false });

  const componentCss = await fs.readFile(path.join(out, 'src/component-styles.css'), 'utf8');
  const layoutCss = await fs.readFile(path.join(out, 'src/layout.css'), 'utf8');
  assert.equal(componentCss.trim(), '');
  assert.match(layoutCss, /\[data-instance="inst-product"\]/);
});

test('runnable compiler emits an installable workspace with build and start entrypoints', async () => {
  const out = await fs.mkdtemp(path.join(os.tmpdir(), 'react-runnable-workspace-'));
  await compileReactScaffold(sampleIr(), out, { runnable: true });

  const pkg = JSON.parse(await fs.readFile(path.join(out, 'package.json'), 'utf8'));
  assert.equal(pkg.private, true);
  assert.equal(pkg.scripts.build, 'node scripts/build.mjs');
  assert.equal(pkg.scripts.start, 'node scripts/serve.mjs');
  await fs.access(path.join(out, 'src/main.tsx'));
  await fs.access(path.join(out, 'scripts/build.mjs'));
  const serveScript = await fs.readFile(path.join(out, 'scripts/serve.mjs'), 'utf8');
  assert.match(serveScript, /process\.env\.HOST/);
  await fs.access(path.join(out, 'vendor/react-poc-runtime.js'));
  await fs.access(path.join(out, 'tsconfig.build.json'));
});

test('runnable compiler preserves a rendered route document as the visual-fidelity replay layer', async () => {
  const ir = sampleIr();
  ir.routes[0].renderedDocument = {
    sourceUrl: 'https://shop.example.com/',
    html: '<!doctype html><html><head><title>Exact source</title></head><body><main data-shopify-section-id="23369189458141"><h1>Exact source</h1></main></body></html>',
  };
  const out = await fs.mkdtemp(path.join(os.tmpdir(), 'react-rendered-document-'));
  await compileReactScaffold(ir, out, { runnable: true });

  const replay = await fs.readFile(path.join(out, 'src/replay/route-home.html'), 'utf8');
  assert.match(replay, /data-shopify-section-id="23369189458141"/);
  assert.match(replay, /<base href="https:\/\/shop\.example\.com\/">/);
  const manifest = JSON.parse(await fs.readFile(path.join(out, 'src/replay/routes.json'), 'utf8'));
  assert.equal(manifest['/'], 'route-home.html');
});

test('runnable workspace installs without dependencies and produces browser-loadable build artifacts', async () => {
  const { spawnSync } = await import('node:child_process');
  const out = await fs.mkdtemp(path.join(os.tmpdir(), 'react-runnable-build-'));
  await compileReactScaffold(sampleIr(), out, { runnable: true });

  const npmCommand = process.platform === 'win32' ? 'npm.cmd' : 'npm';
  const spawnOptions = { cwd: out, encoding: 'utf8', shell: process.platform === 'win32' };
  const install = spawnSync(npmCommand, ['install', '--ignore-scripts', '--no-audit', '--no-fund'], spawnOptions);
  assert.equal(install.status, 0, `${install.stdout}\n${install.stderr}`);
  const build = spawnSync(npmCommand, ['run', 'build'], spawnOptions);
  assert.equal(build.status, 0, `${build.stdout}\n${build.stderr}`);
  const html = await fs.readFile(path.join(out, 'dist/index.html'), 'utf8');
  assert.match(html, /id="root"/);
  await fs.access(path.join(out, 'dist/app/main.js'));
  await fs.access(path.join(out, 'dist/app.js'));
  await fs.access(path.join(out, 'dist/app/pages/HomePage.js'));
  await fs.access(path.join(out, 'dist/app/components/ProductCard.js'));
  await fs.access(path.join(out, 'dist/vendor/react-poc-runtime.js'));
});

test('runnable build copies visual-fidelity replay documents into dist', async () => {
  const { spawnSync } = await import('node:child_process');
  const ir = sampleIr();
  ir.routes[0].renderedDocument = {
    sourceUrl: 'https://shop.example.com/',
    html: '<!doctype html><html><head></head><body><h1>Pixel replay</h1></body></html>',
  };
  const out = await fs.mkdtemp(path.join(os.tmpdir(), 'react-rendered-build-'));
  await compileReactScaffold(ir, out, { runnable: true });
  const npmCommand = process.platform === 'win32' ? 'npm.cmd' : 'npm';
  const spawnOptions = { cwd: out, encoding: 'utf8', shell: process.platform === 'win32' };
  const install = spawnSync(npmCommand, ['install', '--ignore-scripts', '--no-audit', '--no-fund'], spawnOptions);
  assert.equal(install.status, 0, `${install.stdout}\n${install.stderr}`);
  const build = spawnSync(npmCommand, ['run', 'build'], spawnOptions);
  assert.equal(build.status, 0, `${build.stdout}\n${build.stderr}`);
  assert.match(await fs.readFile(path.join(out, 'dist/replay/route-home.html'), 'utf8'), /Pixel replay/);
  assert.equal(JSON.parse(await fs.readFile(path.join(out, 'dist/replay/routes.json'), 'utf8'))['/'], 'route-home.html');
});
