# 建站平台标准总览

版本：1.1.0  
状态：正式标准  
依据：Shopify Online Store 2.0 数据思想、Shopify 官方开发文档与本平台产品决定。

## 六份标准

1. `01-组件与模板开发标准.md`
2. `02-编辑器前端开发标准.md`
3. `03-后台与数据标准.md`
4. `04-导入与转换标准.md`
5. `05-自动验收标准.md`
6. `06-总体责任边界标准.md`
7. `00-规则来源追踪表.md`（来源证据，不替代六份职责标准）
8. `08-产品决策记录.md`

## 固定术语

- 页面模板：JSON template。
- 区块组：section group。
- 区块：section。
- 通用小组件：theme block。
- 设置：schema setting。
- 预设：preset。
- 全站设置：global settings。
- Shopify 导入器：`shopify-importer`。
- Wix 导入器：`wix-importer`，当前未实现。
- 外网导入器：`external-web-importer`。
- Coco 验证网站：`coco-validation-site`。
- Majestic 验证网站：`majestic-validation-site`。
- 组件层级：`componentKind`，只允许 `section|theme-block`。
- 组件家族：`familyId`，四位数字字符串，例如 `0001`。
- 正式组件类型：`componentTypeId`，家族号加家族内流水号，例如 `0001-0001`。
- 组件预设：`presetId`，例如 `0001-0001-P001`。

## 规则级别

- `[SHOPIFY]`：来自 Shopify 官方文档或官方参考实现的兼容规则。
- `[PLATFORM]`：本平台为独立建站系统定义的产品规则。
- `[GATE]`：不满足即禁止保存、验收或发布的硬门禁。

本平台不运行 Liquid，但尽量保持 Shopify OS 2.0 的 schema 字段、设置类型和 JSON 结构，方便对照和迁移。
