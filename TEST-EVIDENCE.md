# 源码验证证据

验证日期：2026-11-21

## 已通过

- 共享抓取、识别、组件化、编译、安全和视觉核心：131/131 通过。
- 导入基础、页面数字 ID、组件命名、指纹、可编辑数据、中央组件库候选与验证门禁：117/117 通过。
- 首页变化监听、图片策略与组件流式处理实验：4/4 通过。
- Coco 依赖闭合后的针对性回归：81 项中 80 项通过；唯一未运行成功项需要 `artifacts/homepage-component-probe/measured-homepage.html` 成品测量文件。
- Coco TypeScript：`tsc --noEmit` 通过。
- Microsoft Edge 启动禁止测试通过；验证使用显式 Google Chrome 路径。

## 为什么不声称 Coco 完整 `npm test` 全通过

Coco 的测试目录同时保存两类测试：

1. 程序逻辑测试；本包已携带对应源码并完成上述验证。
2. 针对已生成网站的成品测试；它们读取 `dist/replay`、`src/replay`、图片和测量 artifacts。

生成后的 Coco 网站约含 16.9GB replay 数据。把它塞入“最干净源代码包”会违背本次交付目标，所以本包保留测试源码，但不附带这些网站产物。成品网站的完整性由独立的 Coco 网站交接包验证，不用生成资产污染源码包。

## 验证中发现并已补齐的源码依赖

- 共享核心 `examples/`。
- `workspace/packages/import-foundation/`。
- `workspace/experiments/coco-homepage-method-benchmark/` 的源码文件（不含历史 results）。
- `workspace/scripts/register-central-component-library.mjs`。

这些缺口是通过实际运行测试发现的，不是根据文件名猜测。
