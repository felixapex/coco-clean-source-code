# 图片来源恢复、构建门禁与问题清单

## 目标

缺少真实图片来源证据时，禁止继续做昂贵的全站生成。恢复只处理未完成图片和受影响页面，不重跑已经通过的页面。

## 当前执行链

1. `scripts/compile-image-recovery-blockers.mjs`
   - 合并缓存恢复、网络恢复、组件库恢复和历史组件恢复证据。
   - 生成 `artifacts/component-geometry-migration/image-recovery-blockers.json`。
   - 生成仅包含受影响页面的 `image-recovery-resume-queue.json`。
   - 把当前缺图页写入 `artifacts/full-site-audit/validation-issues.json`。
2. `scripts/build.mjs`
   - 在资源预检和页面生成以前执行图片门禁。
   - 命中未解决图片时返回 `unresolved-source-images`。
   - 页面文件发生变化而阻塞证据未更新时返回 `stale-image-recovery-blocker-report`。
3. `scripts/resume-image-recovery.mjs`
   - 只重试仍未恢复的图片来源。
   - 连续三次同类网络错误后对该主机熔断。
   - 重复执行时识别已经本地化的图片，不重复写页面。
   - 只对本轮真正修改的页面重新测量图片和组件几何。
   - 最后重新生成阻塞报告和问题清单。

## 执行命令

```powershell
$env:MATBOX_CHROMIUM_PATH='C:/Program Files/Google/Chrome/Application/chrome.exe'
node scripts/resume-image-recovery.mjs
```

本工作区禁止自动化启动 Microsoft Edge。若没有页面发生变化，恢复流程不会启动浏览器测量。

## 问题清单字段

每条问题至少包含：

- `id`：稳定问题编号。
- `category`、`type`：问题分类和机器类型。
- `severity`、`status`：严重级别和处理状态。
- `filename`、`routes`：受影响文件和本站路由。
- `sources`、`sourceCount`、`occurrenceCount`：缺少的来源及出现次数。
- `replaySha256`：问题发现时页面文件的证据哈希。

后续全站验收的布局、交互、路由、响应式、乱码、组件结构和可编辑性问题继续写入同一个 `validation-issues.json`，不能用另一份临时清单替代。

## 当前 COCO 状态

- 原始缺图来源：170 个唯一来源、392 处。
- 已恢复：51 个唯一来源。
- 未恢复：119 个唯一来源、154 处、50 个页面。
- 直接访问 BigCommerce 图片 CDN 的三个样本均为网络错误，主机已熔断。
- 当前问题清单包含50条阻塞问题；未解决前正式构建必须失败。
