export function assertAuditCaptureReady(result, url) {
  const failures = [];
  const readiness = result?.metadata?.visualReadiness;
  if (!result?.renderedDocument?.html) failures.push('missing-rendered-document');
  if (!result?.screenshot?.length) failures.push('missing-screenshot');
  if (!readiness?.fontsReady) failures.push('fonts-not-ready');
  if (Number(readiness?.pendingImages ?? 0) > 0) failures.push('pending-images');
  if (Number(readiness?.failedImages ?? 0) > 0) failures.push('failed-images');
  if (Number(readiness?.pendingBackgroundImages ?? 0) > 0) failures.push('pending-background-images');
  if (Number(readiness?.failedBackgroundImages ?? 0) > 0) failures.push('failed-background-images');
  if (Number(readiness?.pendingStylesheets ?? 0) > 0) failures.push('pending-stylesheets');
  if (Number(readiness?.failedStylesheets ?? 0) > 0) failures.push('failed-stylesheets');
  if (Number(readiness?.uncapturedStylesheets ?? 0) > 0) failures.push('uncaptured-stylesheets');
  if (/<img\b[^>]*\bdata-matbox-browser-screenshot-image=["']true["']/i.test(result?.renderedDocument?.html || '')) {
    failures.push('critical-screenshot-image');
  }
  const imageDetails = [
    ...(readiness?.failedImageDetails ?? []),
    ...(readiness?.pendingImageDetails ?? []),
  ];
  const stylesheetDetails = [
    ...(readiness?.failedStylesheetDetails ?? []),
    ...(readiness?.uncapturedStylesheetDetails ?? []),
  ];
  if (failures.length) throw new Error(`Invalid local fidelity capture for ${url}: ${failures.join(', ')} details=${JSON.stringify({ images: imageDetails, stylesheets: stylesheetDetails })}`);
}
