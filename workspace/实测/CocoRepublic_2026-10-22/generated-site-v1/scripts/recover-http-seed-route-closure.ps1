param(
  [Parameter(Mandatory = $true)][string]$SourceOrigin,
  [string]$SourceAssetMap = 'artifacts/full-site-audit/recovery/cocorepublichelp-zendesk-com/contact-us-assets.json'
)

$ErrorActionPreference = 'Stop'
$projectRoot = Split-Path -Parent $PSScriptRoot
$auditPath = Join-Path $projectRoot 'artifacts/full-site-audit/route-link-audit.json'
$batchRelative = 'artifacts/full-site-audit/recovery/http-seed-batch'
$batchRoot = Join-Path $projectRoot $batchRelative
New-Item -ItemType Directory -Force -Path $batchRoot | Out-Null

$audit = Get-Content -LiteralPath $auditPath -Raw | ConvertFrom-Json
$capturedManifestPath = Join-Path $projectRoot 'src/replay/routes.json'
$capturedRoutes = @{}
if (Test-Path -LiteralPath $capturedManifestPath) {
  $capturedManifest = Get-Content -LiteralPath $capturedManifestPath -Raw | ConvertFrom-Json
  foreach ($property in $capturedManifest.PSObject.Properties) { $capturedRoutes[$property.Name] = $true }
}
$routes = @($audit.uniqueMissingTargets |
  Where-Object { $_.type -eq 'uncaptured-local-route' } |
  ForEach-Object { [string]$_.targetRoute } |
  Where-Object { -not $capturedRoutes.ContainsKey($_) } |
  Sort-Object -Unique)

if ($routes.Count -eq 0) {
  Write-Output 'HTTP_SEED_CLOSURE no uncaptured local routes'
  exit 0
}

$index = 0
$deferred = @()
foreach ($route in $routes) {
  $index += 1
  $sourceUrl = ([uri]::new([uri]$SourceOrigin, $route)).AbsoluteUri
  $htmlName = '{0:D3}.html' -f $index
  $htmlPath = Join-Path $batchRoot $htmlName
  $htmlRelative = "$batchRelative/$htmlName"
  Write-Output "HTTP_SEED_CLOSURE $index/$($routes.Count) fetch $route"
  & curl.exe -L --fail --max-time 45 -o $htmlPath $sourceUrl
  if ($LASTEXITCODE -ne 0) {
    $deferred += $route
    Write-Output "HTTP_SEED_DEFERRED fetch-failed $route"
    continue
  }
  $nodeArgs = @(
    'scripts/capture-rendered-golden.mjs',
    "--route=$route",
    "--source-url=$sourceUrl",
    "--source-html-file=$htmlRelative",
    "--source-asset-map=$SourceAssetMap",
    '--viewport=both',
    '--http-seed'
  )
  & node @nodeArgs
  if ($LASTEXITCODE -ne 0) {
    $deferred += $route
    Write-Output "HTTP_SEED_DEFERRED capture-failed $route"
  }
}

Write-Output "HTTP_SEED_CLOSURE attempted=$($routes.Count) deferred=$($deferred.Count)"
if ($deferred.Count -gt 0) {
  Write-Output "HTTP_SEED_DEFERRED_ROUTES $($deferred -join ',')"
  exit 2
}
