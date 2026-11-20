import { captureHtml } from '../../src/capture/chromium-capture.mjs';

const resolver = async (hostname) => {
  if (hostname === 'internal.example') return [{ address: '127.0.0.1', family: 4 }];
  return [{ address: '93.184.216.34', family: 4 }];
};

const html = `<!doctype html><html><head></head><body><link rel="stylesheet" href="https://internal.example/secret.png"><h1>Safe document</h1></body></html>`;
const capture = await captureHtml(html, {
  chromiumPath: '/usr/bin/chromium',
  timeoutMs: 15000,
  requestGuard: true,
  resolver,
});
console.log(JSON.stringify(capture.requestGuard));
