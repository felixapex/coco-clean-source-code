import fs from 'node:fs/promises';
import path from 'node:path';
import { capturePage } from '../capture/chromium-capture.mjs';
import { classifyCaptureFailure } from '../capture/capture-failure-classifier.mjs';
import { writeCaptureBundle } from '../replay/capture-bundle.mjs';
import { crawlSite } from '../site/site-crawler.mjs';
import { createRobotsVisitPolicy, fetchRobotsTxt, robotsFetchDecision } from '../site/fetch-robots.mjs';
import { validateRealSiteSuite } from './real-site-suite.mjs';

function robotsAudit(result, policy) {
  return {
    policy,
    url: result?.url ?? null,
    status: result?.status ?? 0,
    fetched: Boolean(result?.fetched),
    sha256: result?.sha256 ?? null,
    redirects: result?.redirects ?? [],
    error: result?.error ? String(result.error?.message ?? result.error) : null,
  };
}

export async function captureRealSiteSuite({
  suite: rawSuite,
  outputRoot,
  chromiumPath = '/usr/bin/chromium',
  resolver,
  fetchRobotsFn = fetchRobotsTxt,
  capturePageFn = null,
}) {
  const suite = validateRealSiteSuite(rawSuite);
  const root = path.resolve(outputRoot);
  await fs.mkdir(root, { recursive: true });
  const sites = [];

  for (const site of suite.sites) {
    const siteRoot = path.join(root, site.id);
    let robots;
    try {
      robots = await fetchRobotsFn(site.url, { resolver, userAgent: 'MatboxComponentEngine/1.0' });
    } catch (error) {
      robots = {
        url: new URL('/robots.txt', site.url).href,
        status: 0,
        fetched: false,
        text: '',
        sha256: null,
        redirects: [],
        error,
      };
    }
    const robotsDecision = robotsFetchDecision(robots);
    if (site.capturePolicy.robots === 'respect' && robotsDecision.access === 'deny') {
      const classified = robots.error
        ? classifyCaptureFailure(robots.error)
        : { category: 'robots-unreachable', retryable: true, message: `robots.txt unavailable with status ${robots.status}` };
      sites.push({
        siteId: site.id,
        startUrl: site.url,
        status: 'failed',
        capturedPages: 0,
        replayRoot: null,
        skipped: [],
        errors: [{ url: robots.url, phase: 'robots', ...classified }],
        authorization: site.authorization,
        robots: robotsAudit(robots, site.capturePolicy.robots),
        captureOutcome: { attempted: 0, captured: 0, skipped: 0, errors: 1 },
      });
      continue;
    }
    const visitPolicy = createRobotsVisitPolicy(robots, {
      mode: site.capturePolicy.robots,
      userAgent: 'MatboxComponentEngine',
    });
    const pageCapture = capturePageFn ?? ((url) => capturePage(url, {
      chromiumPath,
      timeoutMs: site.capturePolicy.timeoutMs,
      requestGuard: true,
      resolver,
    }));

    const crawl = await crawlSite({
      startUrl: site.url,
      maxPages: site.capturePolicy.maxPages,
      captureFn: pageCapture,
      resolver,
      visitPolicy,
    });
    const errors = crawl.errors.map((entry) => ({
      url: entry.url,
      ...classifyCaptureFailure(new Error(entry.message)),
    }));
    const captureOutcome = {
      attempted: crawl.pages.length + crawl.errors.length + crawl.skipped.length,
      captured: crawl.pages.length,
      skipped: crawl.skipped.length,
      errors: crawl.errors.length,
    };
    let replayRoot = null;
    if (crawl.pages.length) {
      await writeCaptureBundle({
        startUrl: crawl.startUrl,
        pages: crawl.pages,
        outputRoot: siteRoot,
        metadata: {
          siteId: site.id,
          authorization: site.authorization,
          robots: robotsAudit(robots, site.capturePolicy.robots),
          captureOutcome,
        },
      });
      replayRoot = siteRoot;
    }
    const status = crawl.pages.length === 0 ? 'failed' : (errors.length || crawl.skipped.length ? 'partial' : 'captured');
    // A robots-only skip is policy-compliant and still counts as a successful capture if at least one page was captured.
    const normalizedStatus = crawl.pages.length && errors.length === 0 ? 'captured' : status;
    sites.push({
      siteId: site.id,
      startUrl: crawl.startUrl,
      status: normalizedStatus,
      capturedPages: crawl.pages.length,
      replayRoot,
      skipped: crawl.skipped,
      errors,
      authorization: site.authorization,
      robots: robotsAudit(robots, site.capturePolicy.robots),
      captureOutcome,
    });
  }

  const report = {
    version: '1.0',
    generatedAt: new Date().toISOString(),
    siteCount: sites.length,
    capturedSiteCount: sites.filter((site) => site.capturedPages > 0).length,
    failedSiteCount: sites.filter((site) => site.status === 'failed').length,
    sites,
  };
  await fs.writeFile(path.join(root, 'real-site-capture-report.json'), `${JSON.stringify(report, null, 2)}\n`, 'utf8');
  return report;
}
