import { validateComponentSchemaContract } from './component-schema-contract.mjs';

const RESOURCE_TYPES = new Set([
  'image_picker', 'video', 'video_url', 'product', 'product_list',
  'collection', 'collection_list', 'page', 'link_list',
]);

function settingIds(schema) {
  return (Array.isArray(schema?.settings) ? schema.settings : [])
    .map((setting) => setting?.id)
    .filter(Boolean);
}

function resourceSettingIds(schema) {
  return (Array.isArray(schema?.settings) ? schema.settings : [])
    .filter((setting) => RESOURCE_TYPES.has(setting?.type))
    .map((setting) => setting.id);
}

function prefixFailures(failures, context) {
  return failures.map((failure) => ({ ...context, ...failure }));
}

function validateSourceHierarchy(component, manifest, failures) {
  const componentId = component.componentInstanceId;
  const hierarchy = manifest?.hierarchy;
  if (!hierarchy || !Array.isArray(hierarchy.nodes) || !Array.isArray(hierarchy.rootNodeIds)) {
    failures.push({ scope: 'component-hierarchy', componentId, type: 'missing-source-hierarchy' });
    return;
  }

  const nodeById = new Map();
  for (const node of hierarchy.nodes) {
    if (!node?.nodeId) {
      failures.push({ scope: 'component-hierarchy', componentId, type: 'invalid-hierarchy-node' });
      continue;
    }
    if (nodeById.has(node.nodeId)) {
      failures.push({ scope: 'component-hierarchy', componentId, type: 'duplicate-hierarchy-node', nodeId: node.nodeId });
    }
    nodeById.set(node.nodeId, node);
  }

  for (const rootNodeId of hierarchy.rootNodeIds) {
    const root = nodeById.get(rootNodeId);
    if (!root) failures.push({ scope: 'component-hierarchy', componentId, type: 'unknown-hierarchy-root', nodeId: rootNodeId });
    else if (root.parentNodeId) failures.push({ scope: 'component-hierarchy', componentId, type: 'hierarchy-root-has-parent', nodeId: rootNodeId });
  }
  for (const node of hierarchy.nodes) {
    if (node?.parentNodeId && !nodeById.has(node.parentNodeId)) {
      failures.push({ scope: 'component-hierarchy', componentId, type: 'unknown-hierarchy-parent', nodeId: node.nodeId, parentNodeId: node.parentNodeId });
    }
  }

  const seenNodeIds = new Set();
  function visitBlocks(blocks, expectedParentNodeId = null) {
    const entries = Object.entries(blocks || {});
    for (const [blockId, block] of entries) {
      const sourceHierarchy = block?.sourceHierarchy;
      if (!sourceHierarchy?.nodeId) {
        failures.push({ scope: 'component-hierarchy', componentId, blockId, type: 'missing-block-hierarchy' });
        continue;
      }
      if (seenNodeIds.has(sourceHierarchy.nodeId)) {
        failures.push({ scope: 'component-hierarchy', componentId, blockId, type: 'duplicate-block-hierarchy-node', nodeId: sourceHierarchy.nodeId });
      }
      seenNodeIds.add(sourceHierarchy.nodeId);
      if ((sourceHierarchy.parentNodeId || null) !== (expectedParentNodeId || null)) {
        failures.push({
          scope: 'component-hierarchy',
          componentId,
          blockId,
          type: 'hierarchy-parent-mismatch',
          expectedParentNodeId: expectedParentNodeId || null,
          actualParentNodeId: sourceHierarchy.parentNodeId || null,
        });
      }
      const manifestNode = nodeById.get(sourceHierarchy.nodeId);
      if (!manifestNode) {
        failures.push({ scope: 'component-hierarchy', componentId, blockId, type: 'missing-block-hierarchy-manifest-node', nodeId: sourceHierarchy.nodeId });
      } else {
        if (manifestNode.blockId !== blockId) {
          failures.push({ scope: 'component-hierarchy', componentId, blockId, type: 'hierarchy-block-reference-mismatch', nodeId: sourceHierarchy.nodeId });
        }
        if ((manifestNode.parentNodeId || null) !== (sourceHierarchy.parentNodeId || null)) {
          failures.push({ scope: 'component-hierarchy', componentId, blockId, type: 'hierarchy-manifest-parent-mismatch', nodeId: sourceHierarchy.nodeId });
        }
      }

      if (block.type === 'group') {
        const childKeys = Object.keys(block.blocks || {});
        if (!Array.isArray(block.block_order) || block.block_order.length !== childKeys.length
          || block.block_order.some((childId, index) => childId !== childKeys[index])) {
          failures.push({ scope: 'component-hierarchy', componentId, blockId, type: 'invalid-child-block-order' });
        }
        visitBlocks(block.blocks, sourceHierarchy.nodeId);
      }
    }
  }

  visitBlocks(component.blocks, null);
}

function validateCatalog(catalog, failures) {
  for (const [type, schema] of Object.entries(catalog || {})) {
    const inactiveSettingIds = settingIds(schema);
    const result = validateComponentSchemaContract(schema, {
      componentKind: 'theme-block',
      bindings: [],
      visibleValues: [],
      inactiveSettingIds,
      emptySafeSettingIds: resourceSettingIds(schema),
      images: [],
      requiredViewports: [],
    });
    failures.push(...prefixFailures(result.failures, { scope: 'theme-block-catalog', blockType: type }));
  }
}

function validateBlockTree({ blocks, catalog, manifest, componentId, failures, counters }) {
  const entries = Object.entries(blocks || {});
  counters.blockContainers += 1;
  counters.maxBlocksPerContainer = Math.max(counters.maxBlocksPerContainer, entries.length);
  if (entries.length > 50) {
    failures.push({ scope: 'component-block-tree', componentId, type: 'block-container-limit-exceeded', count: entries.length });
  }

  for (const [blockId, block] of entries) {
    counters.blocks += 1;
    const blockSchema = catalog?.[block?.type];
    if (!blockSchema) {
      failures.push({ scope: 'component-block-tree', componentId, blockId, type: 'unknown-theme-block-type', blockType: block?.type || null });
      continue;
    }
    const missingSettings = settingIds(blockSchema).filter((settingId) => !Object.hasOwn(block.settings || {}, settingId));
    for (const settingId of missingSettings) {
      failures.push({ scope: 'component-block-tree', componentId, blockId, type: 'missing-block-setting-value', settingId });
    }

    if (block.type === 'group') {
      validateBlockTree({ blocks: block.blocks, catalog, manifest, componentId, failures, counters });
      continue;
    }

    counters.leafBlocks += 1;
    const explicitBindings = (manifest.bindings || [])
      .filter((binding) => binding.blockId === blockId)
      .map(({ blockId: _blockId, ...binding }) => binding);
    const visibleValues = (manifest.visibleValues || [])
      .filter((value) => value.blockId === blockId)
      .map(({ blockId: _blockId, ...value }) => value);
    const emptySafeSettingIds = (manifest.emptySafeSettingIds || [])
      .filter((value) => value.startsWith(`${blockId}:`))
      .map((value) => value.slice(blockId.length + 1));
    const explicitBindingIds = new Set(explicitBindings.map((binding) => binding.settingId));
    for (const value of visibleValues) {
      if (value.settingId && !explicitBindingIds.has(value.settingId)) {
        failures.push({ scope: 'component-block', componentId, blockId, blockType: block.type, type: 'missing-visible-setting-binding', settingId: value.settingId });
      }
    }
    // Non-content controls such as font size, weight, alignment and spacing
    // are resolved from block ID + block type + the shared theme-block schema.
    // Synthesise those bindings for contract validation instead of repeating
    // millions of identical records in every imported instance.
    const explicitBindingById = new Map(explicitBindings.map((binding) => [binding.settingId, binding]));
    const bindings = settingIds(blockSchema).map((settingId) => ({
      settingId,
      editable: true,
      kind: explicitBindingById.get(settingId)?.kind,
    }));
    const images = (manifest.images || []).filter((image) => (
      image.blockId === blockId
      || (!image.blockId && image.settingId && explicitBindingById.has(image.settingId))
    ));
    const result = validateComponentSchemaContract(blockSchema, {
      componentKind: 'theme-block',
      bindings,
      visibleValues,
      emptySafeSettingIds,
      images,
      requiredViewports: manifest.requiredViewports || [],
    });
    failures.push(...prefixFailures(result.failures, { scope: 'component-block', componentId, blockId, blockType: block.type }));
  }
}

export function auditEditableImportFoundation(foundation = {}) {
  const failures = [];
  const catalog = foundation.themeBlockCatalog || {};
  const components = Array.isArray(foundation.componentLibrary) ? foundation.componentLibrary : [];
  const counters = {
    components: components.length,
    blocks: 0,
    leafBlocks: 0,
    blockContainers: 0,
    maxBlocksPerContainer: 0,
    pageReferences: 0,
  };

  validateCatalog(catalog, failures);
  const componentIds = new Set(components.map((component) => component.componentInstanceId));
  for (const page of foundation.pages || []) {
    for (const componentId of page.componentInstanceIds || []) {
      counters.pageReferences += 1;
      if (!componentIds.has(componentId)) failures.push({ scope: 'page', route: page.route, componentId, type: 'unknown-component-instance-reference' });
    }
  }

  for (const component of components) {
    const componentId = component.componentInstanceId;
    const manifest = component.editableContract?.renderedManifest;
    if (!manifest) {
      failures.push({ scope: 'component', componentId, type: 'missing-editable-rendered-manifest' });
      continue;
    }
    validateSourceHierarchy(component, manifest, failures);
    const sectionBindings = (manifest.bindings || []).filter((binding) => !binding.blockId);
    const sectionResult = validateComponentSchemaContract(component.schema, {
      componentKind: 'section',
      bindings: sectionBindings,
      visibleValues: [],
      emptySafeSettingIds: [],
      images: [],
      requiredViewports: [],
    });
    failures.push(...prefixFailures(sectionResult.failures, { scope: 'component-section', componentId }));
    for (const settingId of settingIds(component.schema)) {
      if (!Object.hasOwn(component.settings || {}, settingId)) {
        failures.push({ scope: 'component-section', componentId, type: 'missing-section-setting-value', settingId });
      }
    }
    validateBlockTree({ blocks: component.blocks, catalog, manifest, componentId, failures, counters });
  }

  return {
    pass: failures.length === 0,
    failures,
    coverage: counters,
  };
}
