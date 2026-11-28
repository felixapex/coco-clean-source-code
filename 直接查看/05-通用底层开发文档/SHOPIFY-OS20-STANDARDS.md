# Shopify OS 2.0 等价架构研究覆盖矩阵（非终稿）

更新时间：2026-11-12  
状态：研究中，禁止据此直接施工  
适用对象：自有建站平台的组件库、模板 JSON、导入转换和验收；不是 Shopify Liquid 主题，也不是 Shopify Theme Store 投稿。

## 1. 本轮研究边界

“全部查完”指：把会影响本平台数据结构、组件能力、页面行为、编辑能力、导入转换和验收门禁的 Shopify 官方规则全部覆盖。以下内容即使查清，也按归属分别标记：

- `当前组件阶段`：sections、theme blocks、schema、presets、模板 JSON、前端交互和可编辑性。
- `编辑器阶段`：编辑界面、选择、拖动、历史记录、预览器。
- `后台阶段`：商品、库存、价格、账户、订单、结算、发布、API。
- `Shopify 专属/不照搬`：Liquid、Theme Store 投稿、Shopify 托管 API、Shopify 平台注入功能。
- `待决策`：官方存在多种路线，必须由产品决定后才能固化。

完成条件：本表不存在未解决研究项；每个“适用”条目都有平台决定和自动门禁；所有“后台/编辑器阶段”都有前端契约和责任边界。

## 2. 已确认的根原则

1. 我们保留 Shopify OS 2.0 的可迁移数据思想：页面模板 → 区块 → 通用小组件 → 设置 → 预设 → 全站设置。
2. 我们不复制 Liquid 实现，也不直接依赖 Shopify Ajax API、Liquid 对象或 Shopify 托管账户组件。
3. 官方当前同时存在经典 JSON sections 架构，以及 Skeleton 的新 block-first 参考方向。用户已明确要求 JSON templates / sections / theme blocks，因此当前数据合同继续以 JSON sections 为主，但吸收新架构的“可复用、可嵌套、上下文数据源、静态结构块”能力。
4. 所有可见内容、展示开关和允许调整的样式必须来自 schema、全站设置、locale 或后台动态数据；禁止散落写死。
5. “可编辑”不等于“所有值都能手输”。价格、库存、SKU、变体、订单、账户状态必须来自后台；组件只开放资源选择和展示方式。
6. 每生成一个区块/页面立即与标准答案逐块、逐交互验证，通过后才能进入正式结果；最后仍需整页和全站回归。

## 3. 覆盖矩阵

| 领域 | 官方资料 | 状态 | 我们平台的决定 | 必须建立的门禁 |
|---|---|---:|---|---|
| JSON templates | JSON templates、alternate templates | 已覆盖 | `sections` + `order`；支持 disabled、alternate/context override 的等价结构；页面最多 25 个区块 | JSON Schema；ID 唯一；order 引用存在；超限失败 |
| 模板类型 | Templates、Theme Store requirements | 已覆盖 | 首页、产品、分类、分类列表、搜索、购物车、普通页/联系页、博客/文章、404、密码页必须有等价模板；gift card、AI discovery、账户/结算另分阶段 | 模板能力表；必需页面缺失失败 |
| Layout | Layouts | 已覆盖 | 自有 `site layout` 统一承载 head、SEO、header-group、main、footer-group；不复制 Liquid | 全站只能有一套公共壳；重复页头页脚失败 |
| Section groups | Section groups | 已覆盖 | header/footer/aside/custom group；每组最多 25 sections；独立 sections/order | 组类型、顺序、ID、引用验证 |
| Sections | Sections、section schema | 已覆盖 | 支持 name/tag/class/limit/settings/blocks/max_blocks/presets/locales/enabled_on/disabled_on；每个可添加 section 必须有 preset | schema 校验；enabled/disabled 互斥；limit 仅允许 1/2；无 preset 不进入添加列表 |
| Theme blocks | Blocks、block schema | 已覆盖 | 基础内容统一做通用 block；支持嵌套，最多 8 层；最多 300 类；每个可添加 block 至少一项 preset | 嵌套深度、循环引用、类型白名单、preset 校验 |
| Static blocks | Static blocks | 已覆盖 | 增加“可编辑但不可删除/移动/复制”的结构块，适用于轮播控制、固定标题槽等 | static 标记；编辑器操作权限测试 |
| Block targeting | Theme block targeting | 已覆盖 | `@theme` 可接收全部，或显式白名单；私有结构块不能出现在通用添加列表 | 不兼容 block 插入必须失败 |
| Section blocks | Section blocks | 已覆盖 | 用户要求统一 theme blocks；仅在无法复用且产品批准时例外，且同一 section 不混用两套 | 混用检测失败 |
| App blocks | Blocks / Theme Store requirements | 已覆盖，当前不适用 | 预留 extension slot 数据契约；当前不实现 Shopify `@app` | 未支持的 app block 不能静默渲染 |
| 数量限制 | Theme limits | 已覆盖 | 1000 JSON templates、25 sections/template、20 groups、25 sections/group、50 dynamic blocks/section、1250 blocks/template、300 block types、8 层嵌套；平台可设置更低 | 所有限制自动失败 |
| 基础设置 | Input settings | 已覆盖 | checkbox、number、radio、range、select、text、textarea | 类型、默认值、数值/选项约束校验 |
| 专用设置 | Input settings | 已覆盖 | 兼容 article/article_list/blog/collection/collection_list/color/color_background/color_palette/color_scheme/color_scheme_group/font_picker/image_picker/inline_richtext/link_list/metaobject/metaobject_list/page/product/product_list/richtext/text_alignment/url/video/video_url；`html`/`liquid` 不作为商家开放输入，只允许受信任系统模板或白名单富文本 | 每类型单测；空值不报错；资源不存在有占位/隐藏策略；任意代码输入失败 |
| Sidebar settings | Sidebar settings | 已覆盖 | header、paragraph 只做说明和分组，不保存值 | 禁止 id/default；本地化检查 |
| visible_if | Settings | 已覆盖 | 条件只依赖同级设置值，不依赖运行时解析结果 | 表达式解析、循环依赖、无效引用失败 |
| 动态数据源 | Dynamic sources | 已覆盖 | 支持模板、section 资源、祖先 block、显式上下文；实现 `closest` 等价解析 | 类型匹配；上下文缺失；回退和空态测试 |
| 全站设置 | config/settings schema/data | 已覆盖 | 品牌、颜色方案、字体、按钮、圆角、页面宽度、社交、联系信息、语言/地区；实例值与 schema 分离 | schema 与 data 一致；孤儿设置和缺失默认值检查 |
| Theme presets | settings_data | 已覆盖 | 与 section/block preset 分开；全站视觉预设最多 5 套；只覆盖展示型设置，不覆盖商家内容 | 切换预设不得覆盖文字/资源内容 |
| 颜色 | Input/settings data | 已覆盖 | 全站 color scheme 为主；section 只选择方案；个别直接颜色需产品批准 | 对比度、空值、方案引用验证 |
| 字体/文字 | Input settings、accessibility、theme checklist | 已覆盖 | 全站标题/正文/按钮字体；block 开放字体角色、字号档、字重、行高、字距、对齐；正文仍保留语义层级；官方长文本基线之外，本平台增加 CJK、长德语、emoji、组合字符和动态字体失败回退 | 长文、30 字符无空格词、60–100 字符单行、1000+ 字符富文本、换行/内外链、CJK、长德语、emoji、组合字符、放大 200%、溢出/重叠、字体失败回退 |
| 图片 | Input settings、responsive performance | 已覆盖 | image picker + alt + focal point + ratio + fit + position；实例图片存模板 JSON；响应式 srcset/sizes 或平台等价能力 | 禁止页面截图冒充图片；固有尺寸；比例/裁切；LCP/懒加载；多视口视觉门禁 |
| 视频/富媒体 | Input settings、accessibility、theme checklist | 已覆盖 | 上传视频、外链视频、封面、静音、循环、自动播放策略、字幕；产品富媒体预留 3D/AR 后台能力 | 可暂停、键盘、字幕、无自动有声播放；移动/桌面测试 |
| 导航/菜单 | Navigation、requirements/checklist | 已覆盖 | 后台菜单数据 + link_list；支持 1–3 层、mega menu、移动抽屉；所有目标必须本站路由或明确外链 | 全部菜单逐项点击；长标题；键盘；目标存在；外链策略 |
| 产品页 | Product overview/variants/quantity rules/unit pricing/subscriptions/gift cards/pickup/requirements/checklist | 已覆盖 | 产品主 section 拆成 title/vendor/price/SKU/inventory/quantity/variant picker/buy buttons/description/media/share/disclosure/pickup/recommendations 等独立 blocks；数量控件读取当前变体 min/max/increment；阶梯价、selling plan、pickup 都随当前变体更新；礼品卡收件人字段嵌入产品表单 | 变体切换同步媒体/价格/库存/SKU/按钮/数量规则/阶梯价/selling plan/pickup；数量规则；订阅必选/不可用；礼品卡限长/日期/时区；pickup 无地点/不可用/API 失败 |
| 产品卡片 | Collection/search/product rules、Dawn/Horizon quick add | 已覆盖 | 图片、标题、vendor、价格区间/折扣、单位价格、徽章、变体/quick add 按能力配置；单变体且无额外数量规则时可直接加购，多变体或存在数量规则时必须打开可访问弹窗并复用产品表单状态；必须保留进入完整详情页的入口 | 资源缺失、不同图片比例、长标题、售罄、路由；单变体直接加购；多变体/数量规则弹窗；变体、价格、库存、数量、selling plan、错误、成功、关闭与焦点返回；不得跳原站 |
| 分类页 | Filtering/requirements/checklist | 已覆盖 | 分类标题/描述/图片、产品网格、排序、过滤、分页/加载更多、空态 | 组合过滤、URL 状态、排序、分页边界、空分类、全产品可达 |
| 分类列表 | Requirements | 已覆盖 | collection title 不截断；featured image 回退；分页/加载更多 | 缺图、长标题、分页、目标存在 |
| 搜索 | Search/predictive search/requirements | 已覆盖 | 搜产品/页面/文章；预测搜索支持产品/分类/查询/页面/文章；无结果、过滤、排序、分页 | 输入→建议→结果逐步验证；键盘 listbox；无结果；对象类型正确 |
| 购物车 | Cart template/Ajax Cart/discounts/requirements/cart drawer | 已覆盖，后台阶段 | 自有 cart API 等价实现；drawer 与 `/cart` 复用同一 line-item 合同；覆盖 title/image/options/quantity/unit price/final price/properties/selling plan，支持删除、备注、属性、行级与整单折扣、税、空态、总计、结账；JS 未加载或关闭时入口退化到 `/cart` | 加购/改量/删除/售罄/超量/折扣/总计逐动作断言；drawer 的 Escape/关闭键/背景关闭/焦点圈定与返回；无 JS 跳 `/cart`；不得只验 URL |
| 推荐 | Product recommendations | 已覆盖，后台阶段 | related/complementary 异步资源；有空态和不可用产品过滤 | API 失败/空结果；卡片路由；加载状态；数量限制 |
| Blog/article | Requirements/checklist | 已覆盖 | 博客列表、分页；文章标题、发布时间、正文、可选评论及结果消息 | 长文/RTE/图片/链接/评论分页/错误成功状态 |
| Page/contact | Requirements/contact form | 已覆盖 | 普通页和联系页分开；联系表单字段由 schema 配置，但提交走后台 | 必填、唯一 ID/label、错误、成功、重复提交、隐私同意 |
| Newsletter | Requirements/checklist | 已覆盖，后台阶段 | 通用表单 block + 后台订阅接口 | 错误/成功/重复/无网络/键盘 |
| 404/password | Requirements | 已覆盖 | 404 必须给继续路径；密码页必须品牌、消息、密码表单 | 真实无效路由；密码错误/成功；移动端 |
| Gift card | Requirements/recipient form | 已覆盖，后台阶段 | 礼品卡码、QR、钱包能力属于交易后台；产品页可选收件人 email/name/message/send-on/timezone；name 最长 255、message 最长 200、最多提前 90 天，验证失败原位显示；收件人模式不得使用加速结账 | 必填 email、格式、限长、过去/超 90 天日期、时区、立即发送、购物车属性、敏感数据、二维码尺寸、打印/移动、权限 |
| Customer accounts | Account component、templates | 已覆盖，后台阶段 | 不复制已废弃 customers/* 模板；定义自有账户入口、登录状态、抽屉/跳转协议 | 原交互形态与本地结果对比；登录态/退出/错误；不得仅验“页面能开” |
| Checkout | Layouts/checkout deprecation | 已覆盖，后台阶段 | 不复制 checkout.liquid；自有结算系统单独开发，组件库只提供入口和订单摘要展示合同 | 支付/隐私/安全独立验收 |
| 多语言 | Locales、Markets、shop_locale | 已覆盖 | storefront locale 与 schema locale 分离；所有 UI 文案走 locale；内容设置可翻译；路由保留 locale；根元素必须按 locale 输出正确 `lang` 与 `dir=ltr/rtl` | 缺 key、回退、长字符串、RTL、切换后路由/状态保持；locale 单文件最多 3400 项、单值最多 1000 字符 |
| 多地区/货币 | Markets | 已覆盖，后台阶段 | 国家和语言选择器成组；货币由市场/后台决定；所有动态请求保留 locale/market | 国家/语言组合、货币代码、价格一致、URL 保持 |
| SEO | Metadata/requirements/structured_data/Storefront sitemap | 已覆盖 | layout 输出 title、description、当前页面 canonical、Open Graph/Twitter；分页标题附页码，分页页面默认使用当前页自引用 canonical；无变体产品输出 Product，有变体产品输出 ProductGroup，至少包含稳定 @id、name、description、image、brand/category（有值时）、url 及每个 offer 的 url/currency/price/availability；Article 输出 Article；XML sitemap 和 robots 由发布层生成，主题/组件不得各自生成 | 每模板元数据；唯一 H1；分页 canonical 不错误指回第一页；Product/ProductGroup/Article JSON-LD 校验；offer 与当前变体一致；sitemap 遍历必须依据 hasNextPage，不能把空页当结束；robots 与发布环境测试 |
| 编辑器生命周期 | Editor integration/settings data/theme updates/help center | 已覆盖，编辑器阶段 | add/remove/re-render/reorder/select/deselect 事件合同；初始化和销毁；选中交互块必须保持可见；预览必须与发布一致；setting ID 和 section/block type 是持久标识，升级不可随意改名；旧数据迁移需显式版本映射；撤销/重做只作用于当前未保存会话，保存形成新 revision；主题有 Draft/Live 状态；本平台采用显式保存、草稿预览、发布版本和乐观并发控制，冲突禁止静默覆盖 | 重复初始化、事件泄漏、重排、选中轮播/折叠块、预览与发布一致；改 ID/type 的迁移用例；未保存 undo/redo；保存后历史边界；草稿预览不污染 Live；发布/回滚；版本号冲突与合并提示 |
| Preview inspector | Editor best practices | 已覆盖，编辑器阶段 | data-section/data-block/data-setting 与点击定位合同 | 点哪改哪映射；隐藏块选中后可见 |
| 响应式 | Responsive design/requirements | 已覆盖 | 内容驱动布局；禁止固定页面宽度和截图坐标；单 DOM 优先；图片按真实容器 sizes；所有组件自动适配 | 320/360/390/768/1024/1440/1920；横向溢出、右侧空白、重叠、遮挡直接失败 |
| 无障碍 | Accessibility/requirements | 已覆盖 | 键盘、焦点、语义、label、alt、对比度、触控目标、媒体控制、减少动画 | axe/Lighthouse + 人工键盘；accessibility 平均门槛至少 90 |
| 性能 | Performance/Theme Store requirements | 已覆盖 | LCP 图不懒加载；高优先级；非首屏懒加载；图片尺寸；减少 DOM/CSS/JS；自托管资源 | Lighthouse 桌面/移动；至少参考 Shopify performance 60，项目应另定更高目标 |
| 浏览器兼容 | Requirements/test theme | 已覆盖 | Chrome/Safari/Firefox/移动 Chrome/Safari/Samsung Internet；应用 WebView | 支持矩阵自动/真机验收；JS 关闭时基础导航和购买表单可用 |
| 静态检查 | Theme Check/tools | 已覆盖 | 因非 Liquid，自建 schema/lint/a11y/security 检查；Theme Check 规则转成平台等价规则 | CI 必须阻断错误；不能代替浏览器和视觉测试 |
| 逐块验收 | 官方 checklist + 项目要求 | 已覆盖 | 保存原站标准答案后，每生成一块立即对比；通过才保存 | 文字、图片、比例、尺寸、布局、响应式、可编辑性、交互结果全部断言 |
| 全站验收 | 官方 checklist + 项目要求 | 已覆盖 | 代表样本三遍通过后逐步扩容；逐页状态可恢复；最后桌面/手机全站回归 | 公共资源、组件、页面、全站四层门禁；任何一层失败禁止发布 |
| 版权/来源 | Theme Store asset rights + 用户规则 | 已覆盖 | 自有/授权站可完整导入；第三方仅学习结构并换为自有/占位内容；不保留来源编号/品牌/文案/图片 | 模式声明、资源授权元数据、第三方素材检测 |
| 输入与上传安全 | Shopify app security/stagedUploadsCreate/fileCreate/CAPTCHA | 已覆盖，后台阶段 | 所有外部值按输出上下文转义；富文本白名单净化；URL 协议/主机校验；上传采用短期签名直传或受控 URL 拉取，先进入临时区，再由后台校验实际类型/大小、重命名、恶意文件扫描和图片重新编码；拒绝 SVG/XML/HTML（除非专门启用）；异步处理必须暴露 processing/ready/failed 状态，READY 前不得用于正式页面；文件记录保存 ID、alt、尺寸、类型、大小、所有者、引用计数和生命周期；删除先检查引用，再软删和异步清理；商家不可写 JS/HTML/CSS | XSS/危险 URL/SSRF/文件伪装/超限/恶意文件/中断重试/重复文件/处理失败/READY 前引用/孤儿文件/引用中删除/配额/到期清理/重复提交/机器人流量；CSP 仅作后备，不当主防线 |
| 隐私同意 | Customer Privacy API | 已覆盖，后台阶段 | 自有平台提供 consent API 和可配置横幅；分别记录 preferences、analytics、marketing、sale-of-data；按商家设置、访客地区和访客选择计算是否允许处理；只能由访客交互写入，禁止替用户自动同意；组件只消费状态和触发明确操作，不直接读写底层 cookie | 首访/已同意/已拒绝/部分同意/地区差异；撤回与重选；同意前非必要脚本不运行；事件与后台记录一致；禁止默认全选和静默写入 |
| 数据权利与保留 | Shopify privacy-law compliance（借鉴） | 已覆盖，后台阶段 | 自有平台必须有数据导出、客户删除、店铺删除三类后台任务；请求鉴权、幂等、审计和法定保留例外由后台负责；默认按最小化原则收集，并由产品定义保留期限，不把 Shopify App Store webhook 机制原样当成本站前端能力 | 数据导出完整性；删除/匿名化；店铺注销清理；重复请求；失败重试；法定保留例外；前端不得承诺后台未实现的删除时限 |
| 官方参考实现与长期架构 | Skeleton/Horizon/Dawn | 已覆盖 | 当前官方 Skeleton 仍以 JSON templates 组合 sections/blocks；theme blocks 提供跨 section 复用和最多 8 层嵌套，是对 OS 2.0 结构的增强而非替代。本平台长期保持 JSON template → section → theme block 的稳定数据合同，新增 block 能力通过 schemaVersion/capabilities 渐进启用；Horizon 看 block-first 组合，Dawn 看成熟交互；只学习合同和行为，禁止复制为产品代码 | 来源和版本记录；旧模板在新渲染器保持；能力开关；schema 迁移；未知 block fail closed；禁止整段代码导入；自主实现审查 |

## 4. 已查清、待转入最终责任表和机器门禁

1. 产品 quantity rules、volume pricing、unit pricing、subscriptions/selling plans、gift-card recipient、pickup availability 已查清；转成最终前端/后台责任表与机器门禁。
2. quick add / quick view 的分流、弹窗、产品表单复用、完整详情入口和焦点合同已查清；转成最终机器状态表。cart drawer / cart page 与无 JavaScript 基线已查清。
3. 隐私同意、数据权利、上传状态机、恶意文件处理、配额、引用和删除生命周期已查清；转成自有后台合同和前端状态合同。
4. SEO 的 Product/ProductGroup/Article、分页 canonical 和发布层 sitemap/robots 边界已查清；转成发布层与组件层门禁。
5. CJK、长德语、emoji、组合字符、动态字体失败、长文和无空格长词压力样本已查清；转成视觉与响应式夹具。
6. 编辑器的未保存 undo/redo、显式保存、Draft/Live、预览、发布、回滚和乐观并发边界已查清；转成编辑器前端与后台事务合同。
7. 长期保持 JSON template → section → theme block；通过 schemaVersion/capabilities 吸收 Skeleton/Horizon 新能力，不以 block-first 名义废弃现有模板合同。

## 4.1 已查清的设置硬约束（待转成机器规则）

- `checkbox` 无 default 时为 `false`。
- `radio` / `select` 无 default 时取第一个 option；options 必须是 value/label，select 可按 group 分组。
- `number` default 必须是数字；空值允许返回空。
- `range` 必须有数字型 min/max/default，step 也必须是数字，省略时为 1；越界值夹到边界，不合法步长取最近值。
- `font_picker` 必须有有效 default。
- `text` / `textarea` / `richtext` / `inline_richtext` / `html` 是可翻译内容；但本平台不开放任意 HTML。
- `richtext` default 顶层必须为 `<p>` 或 `<ul>`；本平台应在保存时转为安全结构化富文本，而不是信任 HTML 字符串。
- `image_picker` / `video` / article/blog/collection/page/product 等单资源设置不支持 default，并且不随视觉 preset 切换；资源丢失必须返回空态。
- `article_list` / `collection_list` / `product_list` / `metaobject_list` 默认和最大选择数均为 50。
- `metaobject` / `metaobject_list` 必须声明单一 `metaobject_type`；本平台可支持自有定义，但必须先存在且允许前台读取。
- `url` 只接受明确内部资源或经校验的外部 URL；Shopify 仅允许 `/collections`、`/collections/all` 作为 schema default，本平台应优先不设默认链接。
- `video_url` 必须显式限定允许的服务商；本平台再按产品需要扩展白名单。
- 每个主题只能有一个全站 `color_palette`，2–20 个无 alpha 的十六进制颜色；`color_scheme_group` 仅能定义在全站设置。
- `color_scheme` 无效时回退默认方案，再回退第一套方案；没有方案数据时为空。
- 每个 section/block schema `name` 最长 25 字符；自定义实例名最长 100 字符；group name 最长 50 字符。
- JSON template、section group、settings_schema 单文件最大 512 KB；settings_data 与 locale 最大 1.5 MB；这些限制先作为兼容上限，平台可设更低值。

## 5. 不得误用的结论

- 官方 Theme Store 要求不是本平台的全部产品需求；它只能作为最低功能/质量基线。
- Dawn/Horizon/Skeleton 是参考实现，不是允许直接复制的产品代码。
- Shopify Ajax API 只适用于 Shopify 托管主题；本平台必须有自己的 API。
- Shopify 当前账户组件由平台控制；本平台必须自己实现等价账户系统与交互。
- Lighthouse 通过不代表视觉、交互、路由和可编辑性通过。
- “按钮可点击”不代表交互正确；必须比较点击前后状态、抽屉/弹窗/页面、数据变化和目标路由。

