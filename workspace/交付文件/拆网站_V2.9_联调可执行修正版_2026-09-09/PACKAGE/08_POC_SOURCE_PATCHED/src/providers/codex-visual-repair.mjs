import path from 'node:path';

function required(value, name) {
  if (!value) throw new Error(`${name} is required`);
  return value;
}

export function buildCodexVisualRepairRequest({ task, workspaceDir, referenceScreenshot, diffScreenshot }) {
  required(task, 'task');
  required(workspaceDir, 'workspaceDir');
  required(referenceScreenshot, 'referenceScreenshot');
  required(diffScreenshot, 'diffScreenshot');
  const instructions = (task.instructions ?? []).join('\n- ');
  return {
    adapter: 'codex-visual-repair',
    mode: 'workspace-write-sandbox',
    workspaceDir,
    networkAccess: 'disabled',
    allowedScopes: [...(task.allowedScopes ?? [])],
    forbiddenScopes: [...(task.forbiddenScopes ?? [])],
    routeId: task.routeId,
    prompt: `Repair visual fidelity for route ${task.routeId}.\n\nReference screenshot: ${referenceScreenshot}\nVisual diff: ${diffScreenshot}\nGenerated artifact: ${task.generatedArtifact ?? 'unknown'}\nCurrent similarity: ${task.similarity}\nTarget similarity: ${task.threshold}\n\nRules:\n- ${instructions}\n- Work only inside ${workspaceDir}.\n- Re-run the route render and visual gate after edits.\n- Do not use network access.`,
    evidence: {
      referenceScreenshot: path.resolve(referenceScreenshot),
      diffScreenshot: path.resolve(diffScreenshot),
      referenceEvidenceId: task.referenceEvidenceId ?? null,
    },
  };
}
