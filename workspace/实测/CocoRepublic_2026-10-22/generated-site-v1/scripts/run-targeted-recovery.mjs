import fs from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { runTargetedRecovery } from './lib/targeted-recovery-runner.mjs';

function option(name) {
  return process.argv.find((value) => value.startsWith(`--${name}=`))?.slice(name.length + 3);
}

const siteId = option('site-id');
const failuresPath = option('failures');
const ledgerPath = option('ledger');
const handlerModulePath = option('handler-module');
if (!siteId || !failuresPath || !ledgerPath || !handlerModulePath) {
  throw new Error('Usage: node scripts/run-targeted-recovery.mjs --site-id=<id> --failures=<json> --ledger=<json> --handler-module=<mjs>');
}
const failures = JSON.parse(await fs.readFile(path.resolve(failuresPath), 'utf8'));
const handlerModule = await import(pathToFileURL(path.resolve(handlerModulePath)).href);
const summary = await runTargetedRecovery({ siteId, failures, ledgerPath: path.resolve(ledgerPath), handlers: handlerModule.handlers || {} });
process.stdout.write(`${JSON.stringify(summary, null, 2)}\n`);
