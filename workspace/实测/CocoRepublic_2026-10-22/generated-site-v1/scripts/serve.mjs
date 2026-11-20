import http from 'node:http';
import fs from 'node:fs/promises';
import path from 'node:path';

const args = process.argv.slice(2);
const portIndex = args.indexOf('--port');
const port = Number(portIndex >= 0 ? args[portIndex + 1] : process.env.PORT || 4173);
const host = process.env.HOST || '127.0.0.1';
const root = path.resolve(process.cwd(), process.env.MATBOX_DIST_DIR || 'dist');
const mime = { '.html':'text/html; charset=utf-8', '.js':'text/javascript; charset=utf-8', '.css':'text/css; charset=utf-8', '.json':'application/json; charset=utf-8', '.png':'image/png', '.jpg':'image/jpeg', '.jpeg':'image/jpeg', '.svg':'image/svg+xml' };
const server = http.createServer(async (req, res) => {
  try {
    let replayRoutes = {};
    let mobileReplayRoutes = {};
    try { replayRoutes = JSON.parse(await fs.readFile(path.join(root, 'replay', 'routes.json'), 'utf8')); } catch {}
    try { mobileReplayRoutes = JSON.parse(await fs.readFile(path.join(root, 'replay', 'routes-mobile.json'), 'utf8')); } catch {}
    const requestUrl = new URL(req.url || '/', 'http://localhost');
    const decodedPath = decodeURIComponent(requestUrl.pathname);
    const urlPath = decodedPath === '/' ? '/' : decodedPath.replace(/\/+$/, '');
    const mobileRequested = requestUrl.searchParams.get('matbox-viewport') === 'mobile' || /Mobile|Android|iPhone/i.test(req.headers['user-agent'] || '');
    const replayStateUrl = new URL(requestUrl);
    for (const internalParameter of ['matbox-viewport', 'responsive-audit', 'full-site-audit']) {
      replayStateUrl.searchParams.delete(internalParameter);
    }
    const replayQuery = replayStateUrl.searchParams.toString();
    const routeState = `${urlPath}${replayQuery ? `?${replayQuery}` : ''}`;
    const replayFile = (mobileRequested ? mobileReplayRoutes[routeState] || mobileReplayRoutes[urlPath] : null)
      || replayRoutes[routeState]
      || replayRoutes[urlPath];
    let file = replayFile ? path.join(root, 'replay', replayFile) : path.join(root, urlPath === '/' ? 'index.html' : urlPath.slice(1));
    if (!file.startsWith(root)) throw new Error('invalid path');
    try { await fs.access(file); } catch { file = path.join(root, 'index.html'); }
    const body = await fs.readFile(file);
    res.writeHead(200, { 'content-type': mime[path.extname(file)] || 'application/octet-stream', 'cache-control': 'no-store' });
    res.end(body);
  } catch (error) { res.writeHead(500); res.end(String(error)); }
});
server.listen(port, host, () => console.log('MATBOX_POC_SERVER http://' + host + ':' + port));
