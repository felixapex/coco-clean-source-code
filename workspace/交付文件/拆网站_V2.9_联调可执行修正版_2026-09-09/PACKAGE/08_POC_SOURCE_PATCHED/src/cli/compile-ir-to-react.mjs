import fs from 'node:fs/promises';
import path from 'node:path';
import { compileReactScaffold } from '../compiler/react-scaffold.mjs';

function arg(name, fallback = null) {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : fallback;
}

const irPath = arg('--ir');
const out = path.resolve(arg('--out', './artifacts/generated-react'));
if (!irPath) throw new Error('--ir <component-ir.json> is required');
const ir = JSON.parse(await fs.readFile(path.resolve(irPath), 'utf8'));
const result = await compileReactScaffold(ir, out);
console.log(JSON.stringify(result, null, 2));
