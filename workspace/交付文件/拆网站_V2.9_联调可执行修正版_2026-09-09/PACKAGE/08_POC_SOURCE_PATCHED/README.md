# Matbox Website → Component Engine PoC v2.9.1

## 2026-10-14 formal integration

- Every URL run now creates a new isolated project directory by default under `artifacts/projects`; an existing run is never overwritten.
- The command-level pipeline has a hard 1,200,000 ms deadline. Crossing it fails the run instead of shrinking scope or reporting a partial pass.
- Capture concurrency defaults to 8 and is capped at 12.
- The shared adaptive capture queue halves concurrency when at least 25% of a wave has transient browser/network failures, applies bounded exponential backoff, retries only failed items, and never repeats successful captures.
- Replay capture waits only for visible baseline images; hidden drawer/modal assets are validated when their interaction state is opened. A single image shares one bounded load/decode deadline across settle passes.
- The Majestic experiment imports the adaptive queue from this package. This directory is the authoritative implementation.

Default isolated run:

```bash
npm run url -- --url https://your-authorized-site.example --projects-root E:/MatboxProjects --max-pages 200
```

The returned JSON includes `projectId`, `outputRoot`, and the elapsed-time budget result. Passing unit/regression tests proves these controls, but does not yet prove that every route and interaction of an arbitrary live site reaches 95% within 20 minutes.

Standalone proof-of-concept for:

> **one authorized website URL → same-origin route discovery → Chromium evidence capture → automatic component candidates → cross-page component families → Component IR + Component Library**

The core pipeline remains independent of Google Stitch.

## What works now

- URL/SSRF gate for initial crawl targets: HTTP/HTTPS only; blocks loopback, private, link-local, metadata and other high-risk direct targets.
- Same-origin BFS route discovery:
  - canonicalizes URLs;
  - removes fragment/query crawl explosions;
  - excludes API/assets/download/media paths;
  - deduplicates;
  - caps `maxPages`;
  - retries transient capture failure once;
  - preserves partial crawl errors.
- Chromium CDP capture without Playwright/Puppeteer runtime dependencies:
  - DOM Snapshot;
  - selected Computed Styles;
  - Accessibility Tree;
  - screenshot;
  - interactive elements;
  - same-page links;
  - automatic component candidates.
- Candidate detection **does not require** `data-component`, `data-semantic-role`, or `data-variant`.
- Current semantic candidate classes include `ProductCard`, `ContentCard`, `SearchForm`, `Navigation`, `FilterPanel`, `Dropdown`, `DataTable`, and dynamically revealed `Modal`.
- Cross-page clustering from semantic + structure + style + visual + behavior signals.
- Behavior incompatibility veto prevents visually similar but behaviorally incompatible components from merging.
- Safe automatic State Explorer:
  - hovers addressable component roots;
  - focuses form controls;
  - clicks only ARIA-declared reversible state controls (`aria-expanded` / `aria-pressed`);
  - never generically clicks arbitrary buttons;
  - records a State only when computed style / focus / ARIA actually changes;
  - resets the page between experiments to avoid state contamination.
- Family inference:
  - canonical name;
  - occurrence count;
  - route provenance;
  - slots;
  - variants (`default`, `compact` in current fixture);
  - props such as `title`, `price`, `media`, `actionLabels`;
  - required vs optional props.
- File-backed Evidence Store with SHA-256 manifests.
- Component IR v0.1 validation.
- Provider capability schema hashing for controlled Stitch upgrades.
- Pairwise benchmark metrics including over-merge and under-merge.
- One-URL multi-page end-to-end fixture demo.

## Verified fixture result

Input only:

```text
https://shop.example.com/
```

The crawler discovers:

```text
/
/search
/stories
```

The Component Engine outputs:

```text
ProductCard × 4
  variants: default, compact
  states: default, hover, selected
  props: title, price, media, actionLabels

ContentCard × 3
  variant: default

SearchForm × 1
  variant: default
  states: default, focus, expanded
```

No fixture page contains component answer attributes.

## Run

```bash
npm test
npm run demo
npm run demo:site
npm run verify
```

Production-like URL entry point:

```bash
npm run url -- --url https://your-authorized-site.example --out ./artifacts/site --max-pages 20
```

The current ChatGPT execution container restricts real Chromium navigation through administrator policy, so the multi-page automated demo uses controlled HTML pages with real absolute route URLs. Run the `url` command in the Matbox/Codex development environment for authorized public sites.

## Directory map

```text
src/security/      URL / SSRF gate
src/capture/       Chromium CDP client + evidence/candidate capture
src/site/          route discovery + BFS crawler
src/evidence/      evidence artifact store
src/ir/            Component IR factory/validator
src/component/     fingerprints, clustering, family/props inference
src/pipeline/      one-URL site component pipeline
src/providers/     provider capability registry/hash
src/benchmark/     clustering metrics
src/poc/           legacy controlled single-page pipeline
src/cli/           controlled demos + real URL entry point
```

## What the current RC proves

It proves the architecture is executable without manual component labels:

```text
start URL
→ discover pages
→ capture each page
→ infer candidates
→ cluster across routes
→ infer props/variants
→ valid Component IR
→ Component Library artifact
```

## What is NOT claimed yet

- This is not a real-site accuracy score.
- Controlled fixture correctness does not imply arbitrary website F1.
- Charts, complex forms, WebGL/canvas, iframe/shadow-DOM and heavily animated sites still need broader semantic/evidence coverage.
- Visual embeddings/LPIPS are not implemented yet.
- Redirect-time SSRF interception still needs browser-network enforcement before production deployment.
- Google Stitch account integration/quota/cost still requires a disposable project and API key.

## Next slice

1. Run 10 authorized real sites / 40+ pages in the unrestricted Matbox/Codex environment and build the first Golden Set.
2. Execute the prepared Codex visual-repair request through the real Codex runtime and measure convergence/cost.
3. Add browser request/redirect interception for SSRF defense in depth.
4. Add visual embeddings/geometry matching only where real-site Benchmark shows deterministic evidence is insufficient.
5. Run the Stitch capability/quota/cost probe with a disposable Stitch project and API key.

## v0.4.0 update

The PoC now recognizes and models complex reusable UI beyond cards/forms:

- `Navigation`
- `FilterPanel`
- `Dropdown`
- `DataTable`
- dynamically revealed `Modal`

Nested relationships are preserved in Component IR (`parentInstanceId` / `childInstanceIds`) and aggregated to family-level parent/child relations. Safe state exploration can identify dropdown/filter `expanded` states and can promote a modal that only appears after an authorized reversible dialog trigger.

Run the complex demo:

```bash
npm run demo:complex
```

Run the complete regression gate:

```bash
npm run verify
```

## v0.5 — Runtime data states and DataTable behavior

v0.5 adds semantic runtime-state inference and reversible table interaction probes without `data-state` answer labels.

Supported DataTable states now include:

- `loading` — inferred from `aria-busy=true` and/or loading status semantics.
- `empty` — inferred from zero data rows plus an accessible empty-state message.
- `error` — inferred from `role=alert` / error semantics.
- `sorted` — confirmed only when clicking a sortable header changes `aria-sort`.
- `selected` — confirmed when a checkbox/radio actually changes checked state.
- `paginated` — confirmed when a pagination control changes its `aria-controls` target.

The same DataTable family can now carry all of these states across routes. Each instance also records its current observed state (for example `loading`, `empty`, or `error`).

Run the dedicated demo:

```bash
npm run demo:table
```

## v0.6 — Component IR → React scaffold compiler

v0.6 adds a deterministic compiler from canonical Component IR to a typed React/TSX project scaffold.

Generated output includes:

- one `src/components/<Family>.tsx` file per Component Family;
- typed props inferred from `propsSchema`;
- typed `variant` and `state` unions;
- nested parent/child JSX composition (for example Navigation → Dropdown);
- one page file per captured route;
- `component-registry.ts`;
- DTCG token export as `design-tokens.css` CSS variables;
- a dependency-free JSX type shim and `tsconfig.json` for structural `tsc --noEmit` verification.

This stage intentionally establishes **clean component architecture**, not final pixel-perfect styling. The later evidence/Codex visual-repair stage consumes these files and the original screenshots/styles to produce final fidelity.

Compile an IR file:

```bash
npm run compile:react -- --ir ./component-ir.json --out ./generated-react
```

## v0.7 Visual Fidelity Loop

v0.7 extends the deterministic pipeline beyond component discovery/code scaffolding:

```text
Source page evidence
  -> detailed computed style + slot style snapshots
  -> Component Family style profile + Variant overrides
  -> Component CSS + instance geometry CSS
  -> dependency-free IR preview render
  -> Chromium screenshot
  -> ImageMagick normalized RMSE + diff.png
  -> visual repair task when below gate
```

The visual analysis stage is read-only. The bounded repair executor may write only generated React/CSS; it explicitly forbids changing Component IR architecture, crawler/provider code, deployment, secrets, or network behavior.

Run:

```bash
npm run demo:visual
```

The controlled v0.7 fixture currently verifies that visual styling improves the structure-only baseline and must meet a strict `0.98` similarity gate during `npm run verify`.


## v0.8 — Bounded Automatic Visual Repair Controller

v0.8 closes the local PoC loop from generated React to bounded visual repair:

```text
Component IR
  -> structure-only generated React workspace
  -> render + screenshot
  -> visual score / diff
  -> repair task
  -> local deterministic evidence repair (writes generated CSS)
  -> re-render + re-score
  -> pass / stall / exhaust
  -> rollback to best revision if a repair regresses
```

Added:

- `runVisualRepairLoop()` with a hard `maxIterations` budget.
- Repair-task observer hook for provider requests, audit logs and later cost telemetry.
- Best-revision rollback hook when a repair makes fidelity worse.
- Structure-only React compilation (`includeVisualStyles: false`) for a real baseline workspace.
- Local deterministic repair adapter that **actually writes** `generated-react/src/component-styles.css` and `layout.css`.
- Workspace visual revision snapshots and restore support.
- Preview renderer can consume CSS directly from the generated React workspace.
- A bounded Codex visual-repair request contract is emitted for each needed repair:
  - workspace-write scope;
  - network disabled;
  - generated React/CSS only;
  - Component IR, crawler, provider adapters and deployment explicitly forbidden.
- The current execution container has **no Codex CLI/runtime credential**, so Codex execution is honestly reported as `prepared-not-executed`; the local deterministic adapter performs the verified repair in this PoC.

Fresh v0.8 verification:

- **60 / 60 automated tests passed.**
- Full `npm run verify` passed.
- Generated structural React passed `tsc --noEmit`.
- Repaired visual React passed `tsc --noEmit`.
- Structure-only visual similarity: `0.9215785`.
- After deterministic evidence repair: `1.0000000`.
- Strict target: `0.98` — passed.
- `codex-repair-request.json`, `visual-repair-task.json`, `baseline-diff.png` and final `diff.png` are produced as verification artifacts.


### Browser request SSRF defense added in v0.8

Real `capturePage(URL)` now enables a CDP `Fetch` request guard by default. Every intercepted HTTP/HTTPS request is URL-validated and DNS-checked before Chromium is allowed to continue it. Requests resolving to loopback/private/link-local/cloud-metadata/reserved addresses are failed with `BlockedByClient` and recorded for audit. This applies to the main navigation as well as later browser requests, including redirect targets and subresources.

Controlled `captureHtml()` fixture mode keeps the guard off by default so synthetic pages with fake domains do not perform unintended DNS; it can be explicitly enabled for security tests.

Important boundary: this is defense in depth, not a complete DNS-rebinding solution. Validation and Chromium DNS resolution are still separate operations, so production deployment must also use network isolation or an enforcing outbound proxy / DNS-pinning layer.

### What remains external to this PoC

The core local loop is closed. Remaining production proof is external-environment work, not missing local architecture:

1. real authorized websites and a real Golden Set;
2. real Codex execution/cost/convergence measurements;
3. Stitch API-key quota/cost/capability measurements;
4. deployment-layer DNS pinning / egress proxy / network isolation to close DNS-rebinding TOCTOU beyond the in-browser request guard.


## v0.9 — Frozen Replay + Golden Benchmark

v0.9 added a reproducible offline evaluation layer:

- authorized site capture can be frozen once into a replay bundle;
- binary evidence is externalized with SHA-256 integrity checks;
- replay paths are constrained to the bundle root;
- Golden annotations are stored independently from model predictions;
- suite metrics include coverage, clustering F1, over-merge, under-merge, semantic-role accuracy, Variant accuracy and State F1;
- upgrade regressions can be evaluated against the exact same frozen evidence without re-crawling customer websites.

## v1.0-rc.1 — Auditable Real-Site Release Workflow

The RC adds the production validation workflow around the local Component Engine:

```text
authorized site list
  -> robots/security preflight
  -> frozen real-site replay bundles
  -> machine-generated Golden drafts
  -> mandatory human approval
  -> offline release benchmark
  -> aggregate + per-site release gates
```

New commands:

```bash
npm run capture:real -- --suite ./real-site-suite.json --out ./artifacts/real-captures
npm run golden:draft -- --capture-report ./artifacts/real-captures/real-site-capture-report.json --out ./artifacts/real-golden
npm run benchmark:release -- --suite ./real-site-suite.json --capture-report ./artifacts/real-captures/real-site-capture-report.json --golden ./artifacts/real-golden --out ./artifacts/real-release-benchmark
```

Real-site suite requirements:

- every site has explicit `owned`, `authorized`, or `public-benchmark` attestation;
- default robots policy is `respect`;
- `robots.txt` 4xx is treated as unavailable/no rules; unreachable/5xx is fail-closed under `respect`;
- capture failures are categorized (security policy, environment policy, DNS, timeout, auth wall, browser/network, unknown);
- capture replay manifests persist authorization, robots and capture-outcome audit metadata;
- machine-generated Gold is `unreviewed` and cannot be used for release scoring;
- production defaults require at least **10 sites**;
- aggregate scores cannot hide a bad site: per-site Coverage and Clustering F1 gates are enforced too.

Fresh `npm run verify` evidence for v1.0-rc.1:

- **88 / 88 automated tests passed**;
- controlled single-page capture passed;
- one-URL multi-page component-library demo passed;
- complex hierarchy/state demo passed;
- offline Golden replay benchmark passed;
- authorized-capture → approved-Gold → release-gate workflow demo passed;
- DataTable runtime state-machine demo passed;
- generated React passed `tsc --noEmit`;
- automatic visual repair passed;
- repaired React passed `tsc --noEmit`;
- visual similarity improved from `0.9215785` to `1.0000000` against a strict `0.98` gate.

### Current external-environment blocker

A real-network smoke capture against `https://example.com/` was attempted on 2026-08-17. The current execution container cannot resolve public DNS and returns:

```text
getaddrinfo EAI_AGAIN example.com
```

The RC now records this as an auditable `phase=robots`, `category=dns`, `retryable=true` site failure instead of crashing or pretending the site was captured.

Therefore the remaining proof is genuinely external-environment work:

1. run the same `capture:real` command in a normal Matbox/Codex worker with outbound DNS/HTTPS;
2. freeze at least 10 authorized sites / 40+ pages;
3. human-approve Golden annotations;
4. run the release benchmark and collect real accuracy/cost distributions;
5. run the existing Stitch and Codex provider probes with real credentials;
6. deploy network-level egress enforcement/DNS pinning in addition to the browser request guard.
