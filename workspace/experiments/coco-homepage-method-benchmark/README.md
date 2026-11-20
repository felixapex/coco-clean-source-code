# COCO homepage method benchmark

Throwaway, homepage-only comparison. It does not modify or publish the canonical importer.

- Method A: live browser full-page capture, then late component conversion.
- Method B: live browser capture, then component-by-component editability gating before page assembly.
- Method C: HTTP seed for static content, browser for rendered/dynamic state, then the same component-first gates as B.

Each run writes an isolated directory under `results/` with source/output HTML, screenshots, per-stage timings, component/editability evidence, and a hard-gate report.

Run one method at a time so browser and network contention do not distort the comparison:

```powershell
$env:MATBOX_CHROMIUM_PATH='C:/Program Files/Google/Chrome/Application/chrome.exe'
node benchmark.mjs --method=A
node benchmark.mjs --method=B
node benchmark.mjs --method=C
```
