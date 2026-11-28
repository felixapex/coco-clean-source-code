import { createHash } from 'node:crypto';

const FONT_ROLE_OPTIONS = [
  { value: 'heading', label: '标题字体' },
  { value: 'body', label: '正文字体' },
  { value: 'button', label: '按钮字体' },
];
const FONT_SIZE_OPTIONS = [
  { value: 'xs', label: '特小' },
  { value: 'sm', label: '小' },
  { value: 'md', label: '中' },
  { value: 'lg', label: '大' },
  { value: 'xl', label: '特大' },
  { value: '2xl', label: '超大' },
];
const FONT_WEIGHT_OPTIONS = [
  { value: 'regular', label: '常规' },
  { value: 'medium', label: '中等' },
  { value: 'semibold', label: '半粗' },
  { value: 'bold', label: '加粗' },
];
const SPACING_OPTIONS = [
  { value: 'tight', label: '紧凑' },
  { value: 'normal', label: '标准' },
  { value: 'loose', label: '宽松' },
];

function select(id, label, options, defaultValue) {
  return { type: 'select', id, label, options, default: defaultValue };
}

function typographySettings({ role = 'body', size = 'md', weight = 'regular' } = {}) {
  return [
    select('font_role', '字体', FONT_ROLE_OPTIONS, role),
    select('font_size', '字号', FONT_SIZE_OPTIONS, size),
    select('font_weight', '字重', FONT_WEIGHT_OPTIONS, weight),
    select('line_height', '行高', SPACING_OPTIONS, 'normal'),
    select('letter_spacing', '字间距', SPACING_OPTIONS, 'normal'),
    { type: 'text_alignment', id: 'alignment', label: '文字对齐', default: 'left' },
  ];
}

export function buildThemeBlockCatalog() {
  return {
    heading: {
      name: '标题',
      settings: [
        { type: 'inline_richtext', id: 'text', label: '标题文字', default: '标题' },
        ...typographySettings({ role: 'heading', size: 'xl', weight: 'medium' }),
      ],
      presets: [{ name: '标题' }],
    },
    text: {
      name: '正文',
      settings: [
        { type: 'richtext', id: 'text', label: '正文', default: '<p>正文内容</p>' },
        ...typographySettings({ role: 'body', size: 'md' }),
      ],
      presets: [{ name: '正文' }],
    },
    button: {
      name: '按钮',
      settings: [
        { type: 'text', id: 'label', label: '按钮文字', default: '了解更多' },
        { type: 'url', id: 'link', label: '链接' },
        select('style', '按钮样式', [
          { value: 'solid', label: '实心' },
          { value: 'outline', label: '描边' },
        ], 'solid'),
        ...typographySettings({ role: 'button', size: 'md', weight: 'semibold' }),
      ],
      presets: [{ name: '按钮' }],
    },
    image: {
      name: '图片',
      settings: [
        { type: 'image_picker', id: 'image', label: '图片' },
        { type: 'text', id: 'alt', label: '替代文字', default: '' },
        select('image_ratio', '图片比例', [
          { value: 'original', label: '原图' },
          { value: '16:9', label: '16:9' },
          { value: '4:3', label: '4:3' },
          { value: '1:1', label: '1:1' },
        ], 'original'),
        select('image_fit', '填充方式', [
          { value: 'cover', label: '裁切填充' },
          { value: 'contain', label: '完整显示' },
        ], 'cover'),
        { type: 'text', id: 'image_position', label: '图片焦点', default: '50% 50%' },
        { type: 'url', id: 'link', label: '图片链接' },
      ],
      presets: [{ name: '图片' }],
    },
    video: {
      name: '视频',
      settings: [
        { type: 'video', id: 'video', label: '视频' },
        { type: 'video_url', id: 'video_url', label: '外部视频链接' },
        { type: 'image_picker', id: 'poster', label: '封面图' },
        { type: 'checkbox', id: 'autoplay', label: '自动播放', default: false },
      ],
      presets: [{ name: '视频' }],
    },
    group: {
      name: '分组',
      settings: [
        select('layout', '布局', [
          { value: 'stack', label: '纵向' },
          { value: 'row', label: '横向' },
          { value: 'grid', label: '网格' },
        ], 'stack'),
      ],
      blocks: [{ type: '@theme' }],
      max_blocks: 50,
      presets: [{ name: '分组' }],
    },
  };
}

export function buildGlobalSettingsSchema() {
  return [
    {
      name: '品牌信息',
      settings: [
        { type: 'text', id: 'brand_name', label: '品牌名称', default: '示例工厂' },
        { type: 'image_picker', id: 'logo', label: 'Logo' },
        { type: 'text', id: 'contact_phone', label: '联系电话', default: '' },
        { type: 'text', id: 'contact_email', label: '联系邮箱', default: '' },
      ],
    },
    {
      name: '字体',
      settings: [
        { type: 'font_picker', id: 'heading_font', label: '标题字体', default: 'assistant_n4' },
        { type: 'font_picker', id: 'body_font', label: '正文字体', default: 'assistant_n4' },
        { type: 'font_picker', id: 'button_font', label: '按钮字体', default: 'assistant_n6' },
        select('type_scale', '全站字号比例', [
          { value: 'compact', label: '紧凑' },
          { value: 'standard', label: '标准' },
          { value: 'large', label: '宽大' },
        ], 'standard'),
      ],
    },
    {
      name: '配色方案',
      settings: [
        { type: 'color', id: 'scheme_1_background', label: '方案一背景', default: '#ffffff' },
        { type: 'color', id: 'scheme_1_text', label: '方案一文字', default: '#111111' },
        { type: 'color', id: 'scheme_1_button', label: '方案一按钮', default: '#111111' },
      ],
    },
  ];
}

function stableId(value, index, type) {
  return `${type}-${index + 1}-${createHash('sha256').update(String(value)).digest('hex').slice(0, 8)}`;
}

function blockInstance(block) {
  const instance = { type: block.type, settings: block.settings || {} };
  if (block.sourceEvidence) instance.sourceEvidence = block.sourceEvidence;
  if (block.sourceHierarchy) instance.sourceHierarchy = block.sourceHierarchy;
  if (block.blocks) instance.blocks = block.blocks;
  if (block.block_order) instance.block_order = block.block_order;
  return instance;
}

function packThemeBlocks(blocks, sectionId, level = 0, hierarchyNodes = []) {
  if (blocks.length <= 50) return blocks;
  const groups = [];
  for (let offset = 0; offset < blocks.length; offset += 50) {
    const children = blocks.slice(offset, offset + 50);
    const groupIndex = groups.length;
    const groupId = stableId(`${sectionId}\n${level}\n${groupIndex}\n${children.map((block) => block.id).join('\n')}`, groupIndex, 'group');
    const commonParentNodeId = children[0]?.sourceHierarchy?.parentNodeId || null;
    const domPath = `packed.${level}.${groupIndex}`;
    const sourceHierarchy = {
      nodeId: hierarchyNodeId(sectionId, domPath, 'div'),
      parentNodeId: commonParentNodeId,
      depth: Math.max(1, Math.min(...children.map((block) => Number(block.sourceHierarchy?.depth) || 1))),
      tag: 'div',
      role: 'group',
      domPath,
      synthetic: true,
    };
    for (const child of children) {
      if (!child.sourceHierarchy) continue;
      child.sourceHierarchy = { ...child.sourceHierarchy, parentNodeId: sourceHierarchy.nodeId };
      const manifestNode = hierarchyNodes.find((node) => node.nodeId === child.sourceHierarchy.nodeId);
      if (manifestNode) manifestNode.parentNodeId = sourceHierarchy.nodeId;
    }
    groups.push({
      id: groupId,
      type: 'group',
      settings: { layout: 'stack' },
      sourceHierarchy,
      blocks: Object.fromEntries(children.map((block) => [block.id, blockInstance(block)])),
      block_order: children.map((block) => block.id),
    });
    hierarchyNodes.push({
      ...sourceHierarchy,
      blockId: groupId,
      childNodeIds: children.map((child) => child.sourceHierarchy?.nodeId).filter(Boolean),
    });
  }
  return packThemeBlocks(groups, sectionId, level + 1, hierarchyNodes);
}

function decodeHtml(value) {
  return String(value || '')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/\s+/g, ' ')
    .trim();
}

function attribute(attributes, name) {
  const escapedName = String(name).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return attributes.match(new RegExp(`(?:^|\\s)${escapedName}\\s*=\\s*(["'])(.*?)\\1`, 'i'))?.[2] || '';
}

function annotateOpeningTag(tag, attributes, blockId, type, settingId) {
  return `<${tag}${attributes} data-block-id="${blockId}" data-block-type="${type}" data-setting="${settingId}">`;
}

function escapeAttribute(value) {
  return String(value || '').replace(/&/g, '&amp;').replace(/"/g, '&quot;');
}

function numericAttribute(attributes, name) {
  const value = Number(attribute(attributes, name));
  return Number.isFinite(value) ? value : 0;
}

const VOID_ELEMENTS = new Set([
  'area', 'base', 'br', 'col', 'embed', 'hr', 'img', 'input',
  'link', 'meta', 'param', 'source', 'track', 'wbr',
]);

function parseElementTree(markup) {
  const documentRoot = { tag: '#document', attributes: '', children: [], parent: null };
  const stack = [documentRoot];
  const tokenPattern = /<!--[\s\S]*?-->|<![^>]*>|<\/?([a-z][\w:-]*)\b[^>]*>/gi;
  let match;
  while ((match = tokenPattern.exec(String(markup || '')))) {
    const token = match[0];
    const tag = String(match[1] || '').toLowerCase();
    if (!tag || token.startsWith('<!--') || token.startsWith('<!')) continue;
    if (/^<\//.test(token)) {
      for (let index = stack.length - 1; index > 0; index -= 1) {
        const node = stack[index];
        stack.pop();
        if (node.tag === tag) break;
      }
      continue;
    }
    const attributes = token
      .replace(new RegExp(`^<${tag}\\b`, 'i'), '')
      .replace(/\/?>$/, '');
    const parent = stack[stack.length - 1];
    const node = { tag, attributes, children: [], parent };
    parent.children.push(node);
    if (!VOID_ELEMENTS.has(tag) && !/\/>$/.test(token)) stack.push(node);
  }
  return documentRoot;
}

function hierarchyNodeId(sectionId, domPath, tag) {
  return `node-${createHash('sha256').update(`${sectionId}\n${domPath}\n${tag}`).digest('hex').slice(0, 12)}`;
}

function buildEditableHierarchy(annotatedMarkup, flatBlocks, sectionId) {
  const documentRoot = parseElementTree(annotatedMarkup);
  const blockById = new Map(flatBlocks.map((block) => [block.id, block]));
  const hierarchyNodes = [];

  const roots = documentRoot.children;
  const sectionRoot = roots.find((node) => attribute(node.attributes, 'data-section-id') === sectionId) || roots[0] || documentRoot;

  function createSourceHierarchy(node, parentNodeId, depth, domPath, role) {
    return {
      nodeId: hierarchyNodeId(sectionId, domPath, node.tag),
      parentNodeId: parentNodeId || null,
      depth,
      tag: node.tag,
      role,
      domPath,
    };
  }

  function convertNode(node, parentNodeId, depth, domPath) {
    const ownBlockId = attribute(node.attributes, 'data-block-id');
    const ownBlock = ownBlockId ? blockById.get(ownBlockId) : null;
    const childNodes = node.children.map((child, index) => (
      convertNode(child, null, depth + 1, `${domPath}.${index}`)
    )).filter(Boolean);
    if (!ownBlock && childNodes.length === 0) return null;

    if (ownBlock && childNodes.length === 0) {
      const sourceHierarchy = createSourceHierarchy(node, parentNodeId, depth, domPath, 'leaf');
      ownBlock.sourceHierarchy = sourceHierarchy;
      hierarchyNodes.push({ ...sourceHierarchy, blockId: ownBlock.id, childNodeIds: [] });
      return ownBlock;
    }

    const sourceHierarchy = createSourceHierarchy(node, parentNodeId, depth, domPath, 'group');
    const children = [];
    if (ownBlock) {
      const contentHierarchy = {
        nodeId: `${sourceHierarchy.nodeId}:content`,
        parentNodeId: sourceHierarchy.nodeId,
        depth: depth + 1,
        tag: node.tag,
        role: 'leaf',
        domPath: `${domPath}:content`,
      };
      ownBlock.sourceHierarchy = contentHierarchy;
      hierarchyNodes.push({ ...contentHierarchy, blockId: ownBlock.id, childNodeIds: [] });
      children.push(ownBlock);
    }
    for (const child of childNodes) {
      child.sourceHierarchy = { ...child.sourceHierarchy, parentNodeId: sourceHierarchy.nodeId };
      const hierarchyRecord = hierarchyNodes.find((entry) => entry.nodeId === child.sourceHierarchy.nodeId);
      if (hierarchyRecord) hierarchyRecord.parentNodeId = sourceHierarchy.nodeId;
      children.push(child);
    }
    const packedChildren = packThemeBlocks(children, `${sectionId}:${domPath}`, 0, hierarchyNodes);
    const groupId = stableId(`${sectionId}\n${domPath}\n${node.tag}`, hierarchyNodes.length, 'group');
    const group = {
      id: groupId,
      type: 'group',
      settings: { layout: 'stack' },
      sourceHierarchy,
      blocks: Object.fromEntries(packedChildren.map((block) => [block.id, blockInstance(block)])),
      block_order: packedChildren.map((block) => block.id),
    };
    hierarchyNodes.push({
      ...sourceHierarchy,
      blockId: groupId,
      childNodeIds: packedChildren.map((child) => child.sourceHierarchy?.nodeId).filter(Boolean),
    });
    return group;
  }

  const topLevelCandidates = sectionRoot === documentRoot ? sectionRoot.children : sectionRoot.children;
  const topLevelBlocks = topLevelCandidates.map((node, index) => (
    convertNode(node, null, 1, String(index))
  )).filter(Boolean);
  const packedTopLevelBlocks = packThemeBlocks(topLevelBlocks, sectionId, 0, hierarchyNodes);
  return {
    topLevelBlocks: packedTopLevelBlocks,
    hierarchy: {
      rootNodeIds: packedTopLevelBlocks.map((block) => block.sourceHierarchy?.nodeId).filter(Boolean),
      nodes: hierarchyNodes.sort((left, right) => left.domPath.localeCompare(right.domPath, undefined, { numeric: true })),
    },
  };
}

function imageRatioSetting(intrinsicWidth, intrinsicHeight, renderedWidth, renderedHeight) {
  const renderedRatio = renderedWidth > 0 && renderedHeight > 0 ? renderedWidth / renderedHeight : 0;
  const intrinsicRatio = intrinsicWidth > 0 && intrinsicHeight > 0 ? intrinsicWidth / intrinsicHeight : 0;
  const near = (left, right) => left > 0 && Math.abs(left - right) <= 0.03;
  if (near(renderedRatio, 16 / 9)) return '16:9';
  if (near(renderedRatio, 4 / 3)) return '4:3';
  if (near(renderedRatio, 1)) return '1:1';
  if (near(renderedRatio, intrinsicRatio)) return 'original';
  return 'original';
}

export function inertImportedExecutableMarkup(markup) {
  return String(markup || '')
    .replace(/<script\b[^>]*>[\s\S]*?<\/script\s*>/gi, '')
    .replace(/<script\b[^>]*\/?>/gi, '')
    .replace(/\s+on[a-z]+\s*=\s*(?:"[^"]*"|'[^']*'|[^\s>]+)/gi, '')
    .replace(/\s+srcdoc\s*=\s*(?:"[^"]*"|'[^']*'|[^\s>]+)/gi, '')
    .replace(/<iframe\b([^>]*)>/gi, (full, attributes) => {
      const source = attribute(attributes, 'src');
      const safeAttributes = attributes.replace(/\s+src\s*=\s*(?:"[^"]*"|'[^']*'|[^\s>]+)/i, '');
      const provenance = source ? ` data-source-src="${escapeAttribute(source)}"` : '';
      return `<iframe${safeAttributes}${provenance} src="about:blank">`;
    });
}

export function convertMarkupToEditableSection({ sectionId, sectionType, markup } = {}) {
  const themeBlocks = buildThemeBlockCatalog();
  const blocks = [];
  const bindings = [];
  const visibleValues = [];
  const emptySafeSettingIds = new Set();
  const imageEvidence = [];
  const requiredViewports = new Set();
  let annotatedMarkup = inertImportedExecutableMarkup(markup);
  let index = 0;

  // Source storefronts sometimes reuse data-section-id on nested runtime
  // elements (for example cart-items-component). Preserve that provenance,
  // but reserve data-section-id/data-section-type for the single editor root.
  annotatedMarkup = annotatedMarkup
    .replace(/\s+data-section-id\s*=\s*(["'])(.*?)\1/gi, ' data-matbox-source-section-id="$2"')
    .replace(/\s+data-section-type\s*=\s*(["'])(.*?)\1/gi, ' data-matbox-source-section-type="$2"');

  annotatedMarkup = annotatedMarkup.replace(/<video\b([^>]*)>([\s\S]*?)<\/video\s*>/gi, (full, attributes, inner) => {
    const directSource = attribute(attributes, 'src');
    const nestedSource = inner.match(/<source\b([^>]*)>/i)?.[1] || '';
    const source = directSource || attribute(nestedSource, 'src');
    const poster = attribute(attributes, 'poster');
    const isExternalEmbed = /^(?:https?:)?\/\/(?:www\.)?(?:youtube\.com|youtu\.be|vimeo\.com)\//i.test(source);
    const primarySetting = isExternalEmbed ? 'video_url' : 'video';
    const blockId = stableId(`${sectionId}\n${index}\nvideo\n${source}\n${poster}`, index, 'video');
    const settings = {
      video: isExternalEmbed ? '' : source,
      video_url: isExternalEmbed ? source : '',
      poster,
      autoplay: /\bautoplay(?:\s|=|>|$)/i.test(attributes),
    };
    blocks.push({ id: blockId, type: 'video', settings });
    bindings.push({ blockId, settingId: primarySetting, kind: 'video', visible: Boolean(source), editable: true });
    if (poster) bindings.push({ blockId, settingId: 'poster', kind: 'image', visible: true, editable: true });
    bindings.push({ blockId, settingId: 'autoplay', kind: 'setting', visible: true, editable: true });
    if (source) visibleValues.push({ blockId, settingId: primarySetting, kind: 'video', source: 'component_setting', editableHere: true });
    if (poster) visibleValues.push({ blockId, settingId: 'poster', kind: 'image', source: 'component_setting', editableHere: true });
    emptySafeSettingIds.add(`${blockId}:video`);
    emptySafeSettingIds.add(`${blockId}:video_url`);
    emptySafeSettingIds.add(`${blockId}:poster`);
    index += 1;
    return `${annotateOpeningTag('video', attributes, blockId, 'video', primarySetting)}${inner}</video>`;
  });

  annotatedMarkup = annotatedMarkup.replace(/<(h[1-6]|p|a|button)\b([^>]*)>([\s\S]*?)<\/\1>/gi, (full, rawTag, attributes, inner) => {
    const tag = rawTag.toLowerCase();
    const text = decodeHtml(inner);
    if (!text) return full;
    const type = /^h[1-6]$/.test(tag) ? 'heading' : (tag === 'a' || tag === 'button') ? 'button' : 'text';
    const blockId = stableId(`${sectionId}\n${index}\n${type}\n${text}`, index, type);
    const settings = type === 'button'
      ? { label: text, link: attribute(attributes, 'href'), style: 'solid', font_role: 'button', font_size: 'md', font_weight: 'semibold', line_height: 'normal', letter_spacing: 'normal', alignment: 'left' }
      : { text: type === 'text' ? `<p>${text}</p>` : text, font_role: type === 'heading' ? 'heading' : 'body', font_size: type === 'heading' ? 'xl' : 'md', font_weight: type === 'heading' ? 'medium' : 'regular', line_height: 'normal', letter_spacing: 'normal', alignment: 'left' };
    blocks.push({ id: blockId, type, settings });
    const primarySetting = type === 'button' ? 'label' : 'text';
    bindings.push({ blockId, settingId: primarySetting, kind: 'text', visible: true, editable: true });
    visibleValues.push({ blockId, settingId: primarySetting, kind: 'text', source: 'component_setting', editableHere: true });
    if (type === 'button') {
      bindings.push({ blockId, settingId: 'link', kind: 'link', visible: true, editable: true });
      visibleValues.push({ blockId, settingId: 'link', kind: 'link', source: 'component_setting', editableHere: true });
      emptySafeSettingIds.add(`${blockId}:link`);
    }
    index += 1;
    return `${annotateOpeningTag(tag, attributes, blockId, type, primarySetting)}${inner}</${tag}>`;
  });

  annotatedMarkup = annotatedMarkup.replace(/<img\b([^>]*)>/gi, (full, attributes) => {
    const source = attribute(attributes, 'src');
    if (!source) return full;
    const alt = attribute(attributes, 'alt');
    const blockId = stableId(`${sectionId}\n${index}\nimage\n${source}`, index, 'image');
    const intrinsicWidth = numericAttribute(attributes, 'data-matbox-image-intrinsic-width');
    const intrinsicHeight = numericAttribute(attributes, 'data-matbox-image-intrinsic-height');
    const renderedWidth = numericAttribute(attributes, 'data-matbox-image-rendered-width');
    const renderedHeight = numericAttribute(attributes, 'data-matbox-image-rendered-height');
    const containerWidth = numericAttribute(attributes, 'data-matbox-image-container-width');
    const containerHeight = numericAttribute(attributes, 'data-matbox-image-container-height');
    const sourceObjectFit = attribute(attributes, 'data-matbox-image-object-fit') || 'fill';
    const objectFit = ['cover', 'contain'].includes(sourceObjectFit) ? sourceObjectFit : 'contain';
    const objectPosition = attribute(attributes, 'data-matbox-image-object-position') || '50% 50%';
    const viewport = attribute(attributes, 'data-matbox-image-viewport');
    const explicitVisibility = attribute(attributes, 'data-matbox-image-visible');
    const visible = explicitVisibility === 'true'
      || (explicitVisibility !== 'false' && renderedWidth > 0 && renderedHeight > 0);
    const sourceAsset = {
      source,
      intrinsicWidth,
      intrinsicHeight,
      intrinsicAspectRatio: intrinsicWidth > 0 && intrinsicHeight > 0 ? intrinsicWidth / intrinsicHeight : 0,
    };
    const presentation = {
      visible,
      renderedWidth,
      renderedHeight,
      containerWidth,
      containerHeight,
      renderedAspectRatio: renderedWidth > 0 && renderedHeight > 0 ? renderedWidth / renderedHeight : 0,
      containerAspectRatio: containerWidth > 0 && containerHeight > 0 ? containerWidth / containerHeight : 0,
      sourceObjectFit,
      objectFit,
      objectPosition,
      viewport,
      viewportWidth: numericAttribute(attributes, 'data-matbox-image-viewport-width'),
      viewportHeight: numericAttribute(attributes, 'data-matbox-image-viewport-height'),
      overflowPx: numericAttribute(attributes, 'data-matbox-image-overflow-px'),
      overflowXPx: numericAttribute(attributes, 'data-matbox-image-overflow-x-px'),
      overflowYPx: numericAttribute(attributes, 'data-matbox-image-overflow-y-px'),
      containerOverflowX: attribute(attributes, 'data-matbox-image-container-overflow-x') || 'visible',
      containerOverflowY: attribute(attributes, 'data-matbox-image-container-overflow-y') || 'visible',
      containerAncestorDepth: numericAttribute(attributes, 'data-matbox-image-container-ancestor-depth'),
      clippedX: attribute(attributes, 'data-matbox-image-clipped-x') === 'true',
      clippedY: attribute(attributes, 'data-matbox-image-clipped-y') === 'true',
      clipAncestorDepthX: numericAttribute(attributes, 'data-matbox-image-clip-ancestor-depth-x'),
      clipAncestorDepthY: numericAttribute(attributes, 'data-matbox-image-clip-ancestor-depth-y'),
    };
    const sourceEvidence = {
      intrinsicWidth,
      intrinsicHeight,
      renderedWidth,
      renderedHeight,
      containerWidth,
      containerHeight,
      renderedAspectRatio: renderedWidth > 0 && renderedHeight > 0 ? renderedWidth / renderedHeight : 0,
      intrinsicAspectRatio: intrinsicWidth > 0 && intrinsicHeight > 0 ? intrinsicWidth / intrinsicHeight : 0,
      sourceObjectFit,
      objectPosition,
      viewport,
      viewportWidth: numericAttribute(attributes, 'data-matbox-image-viewport-width'),
      viewportHeight: numericAttribute(attributes, 'data-matbox-image-viewport-height'),
      overflowPx: numericAttribute(attributes, 'data-matbox-image-overflow-px'),
      overflowXPx: numericAttribute(attributes, 'data-matbox-image-overflow-x-px'),
      overflowYPx: numericAttribute(attributes, 'data-matbox-image-overflow-y-px'),
      containerOverflowX: attribute(attributes, 'data-matbox-image-container-overflow-x') || 'visible',
      containerOverflowY: attribute(attributes, 'data-matbox-image-container-overflow-y') || 'visible',
      containerAncestorDepth: numericAttribute(attributes, 'data-matbox-image-container-ancestor-depth'),
      clippedX: attribute(attributes, 'data-matbox-image-clipped-x') === 'true',
      clippedY: attribute(attributes, 'data-matbox-image-clipped-y') === 'true',
      clipAncestorDepthX: numericAttribute(attributes, 'data-matbox-image-clip-ancestor-depth-x'),
      clipAncestorDepthY: numericAttribute(attributes, 'data-matbox-image-clip-ancestor-depth-y'),
      sourceAsset,
      presentation,
    };
    const imageRatio = imageRatioSetting(intrinsicWidth, intrinsicHeight, renderedWidth, renderedHeight);
    blocks.push({ id: blockId, type: 'image', settings: { image: source, alt, image_ratio: imageRatio, image_fit: objectFit, image_position: objectPosition, link: '' }, sourceEvidence });
    if (viewport) requiredViewports.add(viewport);
    imageEvidence.push({
      blockId,
      settingId: 'image',
      viewport,
      ratio: imageRatio,
      intrinsicWidth,
      intrinsicHeight,
      renderedWidth,
      renderedHeight,
      containerWidth,
      containerHeight,
      renderedAspectRatio: sourceEvidence.renderedAspectRatio,
      intrinsicAspectRatio: sourceEvidence.intrinsicAspectRatio,
      objectFit,
      sourceObjectFit,
      objectPosition,
      overflowPx: sourceEvidence.overflowPx,
      sourceAsset,
      presentation,
    });
    bindings.push({ blockId, settingId: 'image', kind: 'image', visible, editable: true });
    if (visible) visibleValues.push({ blockId, settingId: 'image', kind: 'image', source: 'component_setting', editableHere: true });
    emptySafeSettingIds.add(`${blockId}:image`);
    emptySafeSettingIds.add(`${blockId}:link`);
    index += 1;
    return `<img${attributes} data-block-id="${blockId}" data-block-type="image" data-setting="image">`;
  });

  annotatedMarkup = annotatedMarkup.replace(/<([a-z][\w:-]*)\b([^>]*)>/i, (full, tag, attributes) => (
    `<${tag}${attributes} data-section-id="${sectionId}" data-section-type="${sectionType}">`
  ));

  const { topLevelBlocks, hierarchy } = buildEditableHierarchy(annotatedMarkup, blocks, sectionId);
  const instanceBlocks = Object.fromEntries(topLevelBlocks.map((block) => [block.id, blockInstance(block)]));

  const sectionSchema = {
    name: sectionType || '通用区块',
    tag: 'section',
    settings: [
      { type: 'color_scheme', id: 'color_scheme', label: '配色方案', default: 'scheme-1' },
      { type: 'range', id: 'padding_top', label: '上间距', min: 0, max: 100, step: 4, unit: 'px', default: 40 },
      { type: 'range', id: 'padding_bottom', label: '下间距', min: 0, max: 100, step: 4, unit: 'px', default: 40 },
    ],
    blocks: [{ type: '@theme' }],
    max_blocks: Math.max(1, topLevelBlocks.length),
    // Presets describe which reusable block types are available by default.
    // Imported source content belongs to this page instance, not to the global
    // component type, otherwise one unusually large page would be copied into
    // every registry record and every future insertion of the component.
    presets: [{ name: sectionType || '通用区块', blocks: Object.fromEntries(topLevelBlocks.map((block) => [block.id, { type: block.type }])) }],
  };

  const sectionBindings = sectionSchema.settings.map((setting) => ({ settingId: setting.id, kind: 'style', visible: true, editable: true }));
  return {
    sectionSchema,
    themeBlocks,
    blocks,
    instance: {
      id: sectionId,
      type: sectionType,
      settings: { color_scheme: 'scheme-1', padding_top: 40, padding_bottom: 40 },
      blocks: instanceBlocks,
      block_order: topLevelBlocks.map((block) => block.id),
    },
    annotatedMarkup,
    renderedManifest: {
      componentKind: 'section',
      section: { id: sectionId, type: sectionType },
      bindings: [...sectionBindings, ...bindings],
      visibleValues,
      emptySafeSettingIds: [...emptySafeSettingIds],
      images: imageEvidence,
      requiredViewports: [...requiredViewports],
      hierarchy,
    },
  };
}
