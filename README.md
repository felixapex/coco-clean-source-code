# Coco 最干净源代码包

这是“程序逻辑源码包”，不是生成后的网站成品，也不包含图片库。它只整理目前真实存在的 Coco/外网导入、组件化、页面生成、增量验证、恢复、计时与交付验收代码。

## 目录

- `workspace/实测/CocoRepublic_2026-10-22/generated-site-v1/`：Coco 适配、页面与组件、导入流程、验收逻辑和测试。
- `workspace/交付文件/.../08_POC_SOURCE_PATCHED/`：多个渠道共用的抓取、组件识别、指纹、队列、恢复、安全与视觉核心。
- `standards/`：已经确定的组件、编辑器责任边界、导入、验收和底层执行标准。
- `delivery-verification/`：网站成品交付时使用的清理、完整性和发布检查源码。
- `tools/verify-clean-source-package.mjs`：本源码包自身的完整性与洁净度检查器。

## 环境

- Node.js：`>=22.13 <23`
- 浏览器自动化只能显式指定隔离的 Google Chrome。
- 严禁启动 Microsoft Edge；代码与测试遇到 Edge 必须失败关闭。

## 安装与测试

共享核心：

```powershell
cd 'workspace/交付文件/拆网站_V2.9_联调可执行修正版_2026-09-09/PACKAGE/08_POC_SOURCE_PATCHED'
npm ci
npm test
```

Coco 项目：

```powershell
cd 'workspace/实测/CocoRepublic_2026-10-22/generated-site-v1'
npm install
npm run check
```

完整的 `npm test` 还包含针对已生成 Coco 网站、测量 HTML 和图片的成品验收测试；这些大型网站产物不在本纯源码包内，因此不能把缺少成品测试数据误报为源码失败。已执行的纯源码测试范围与结果见 `TEST-EVIDENCE.md`。

涉及真实浏览器的命令执行前必须显式设置：

```powershell
$env:MATBOX_CHROMIUM_PATH='C:/Program Files/Google/Chrome/Application/chrome.exe'
```

## 源码包验证

双击 `verify-source.cmd`，或运行：

```powershell
node tools/verify-clean-source-package.mjs .
```

只有输出中的 `pass` 为 `true` 才表示：关键源码齐全、没有混入生成网站/图片/依赖/缓存，且全部文件 SHA256 与清单一致。

## 重要边界

本包保留当前实现，不把未完成内容伪装成已完成。详细状态见 `IMPLEMENTATION-STATUS.md`。
