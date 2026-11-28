import { classifyComponent } from './component-classifier.mjs';
import { createEditableSchemaFingerprint } from './component-fingerprints.mjs';

export function reclassifyComponentDossiers(componentLibrary = []) {
  const classifiedComponents = [];
  const counts = {
    new: 0,
    duplicate: 0,
    variant: 0,
    'review-required': 0,
  };

  for (const component of componentLibrary) {
    const schemaFingerprint = createEditableSchemaFingerprint(component.schema);
    const fingerprints = { ...component, schemaFingerprint };
    const classification = component.nameMatchStatus === 'review-required'
      ? { classification: 'review-required', matchedComponentTypeId: null }
      : classifyComponent(fingerprints, classifiedComponents);
    const updated = {
      ...component,
      schemaFingerprint,
      classification: classification.classification,
      matchedComponentTypeId: classification.matchedComponentTypeId ?? null,
    };
    classifiedComponents.push(updated);
    counts[updated.classification] = (counts[updated.classification] ?? 0) + 1;
  }

  return {
    components: classifiedComponents,
    report: {
      componentInstanceCount: classifiedComponents.length,
      classificationCounts: counts,
      reusableInstanceCount: counts.duplicate,
      variantInstanceCount: counts.variant,
      newCandidateCount: counts.new,
      reviewRequiredCount: counts['review-required'],
    },
  };
}
