import fs from 'node:fs/promises';
import { routeFilename } from './site-inventory.mjs';

function filenameFor(route, viewport) {
  const desktop = routeFilename(route);
  return viewport === 'mobile' ? desktop.replace(/\.html$/, '-mobile.html') : desktop;
}

export function buildRouteManifest(routes, viewport = 'desktop') {
  if (!['desktop', 'mobile'].includes(viewport)) throw new Error(`Unknown viewport: ${viewport}`);
  return Object.fromEntries(
    [...new Set(routes)].sort().map((route) => [route, filenameFor(route, viewport)]),
  );
}

export function validateRouteManifest(source, routes, viewport = 'desktop') {
  const text = Buffer.isBuffer(source) ? source.toString('utf8') : String(source);
  if (text.includes('\0')) throw new Error('Route manifest contains NUL bytes');
  let actual;
  try { actual = JSON.parse(text); } catch (error) {
    throw new Error(`Route manifest is not valid JSON: ${error.message}`);
  }
  const expected = buildRouteManifest(routes, viewport);
  const actualEntries = Object.entries(actual ?? {}).sort(([a], [b]) => a.localeCompare(b));
  const expectedEntries = Object.entries(expected);
  if (JSON.stringify(actualEntries) !== JSON.stringify(expectedEntries)) {
    throw new Error(`Route manifest does not match ${expectedEntries.length} ${viewport} routes`);
  }
  return actual;
}

export function validateRouteManifestEntries(source, expected) {
  const text = Buffer.isBuffer(source) ? source.toString('utf8') : String(source);
  if (text.includes('\0')) throw new Error('Route manifest contains NUL bytes');
  let actual;
  try { actual = JSON.parse(text); } catch (error) {
    throw new Error(`Route manifest is not valid JSON: ${error.message}`);
  }
  const actualEntries = Object.entries(actual ?? {}).sort(([a], [b]) => a.localeCompare(b));
  const expectedEntries = Object.entries(expected ?? {}).sort(([a], [b]) => a.localeCompare(b));
  if (JSON.stringify(actualEntries) !== JSON.stringify(expectedEntries)) {
    throw new Error(`Route manifest mapping does not match ${expectedEntries.length} expected entries`);
  }
  return actual;
}

export async function writeAtomicVerified(filePath, data, options = {}) {
  const operations = options.operations || fs;
  const attempts = options.attempts || 3;
  const expected = Buffer.isBuffer(data) ? data : Buffer.from(String(data), options.encoding || 'utf8');
  let lastError;
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    const temporaryPath = `${filePath}.${process.pid}.${attempt}.tmp`;
    try {
      await operations.writeFile(temporaryPath, expected);
      const temporaryReadback = await operations.readFile(temporaryPath);
      if (!Buffer.from(temporaryReadback).equals(expected)) throw new Error('temporary readback differs');
      await operations.rename(temporaryPath, filePath);
      const finalReadback = await operations.readFile(filePath);
      if (!Buffer.from(finalReadback).equals(expected)) throw new Error('final readback differs');
      return;
    } catch (error) {
      lastError = error;
      await operations.rm?.(temporaryPath, { force: true }).catch(() => {});
      if (attempt < attempts) await operations.rm?.(filePath, { force: true }).catch(() => {});
    }
  }
  throw new Error(`Verified atomic write failed for ${filePath}: ${lastError?.message || 'unknown error'}`);
}
