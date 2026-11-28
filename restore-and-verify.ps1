param(
  [string]$DestinationDirectory = (Join-Path $PSScriptRoot 'restored')
)

$ErrorActionPreference = 'Stop'
$partsDirectory = Join-Path $PSScriptRoot '完整网站分卷'
$manifestPath = Join-Path $partsDirectory '分卷SHA256校验清单.json'
if (-not (Test-Path -LiteralPath $manifestPath -PathType Leaf)) {
  throw "Missing part manifest: $manifestPath"
}

$manifest = Get-Content -LiteralPath $manifestPath -Raw | ConvertFrom-Json
$parts = @($manifest.parts)
if ($parts.Count -ne [int]$manifest.partCount) {
  throw "Part count mismatch: manifest=$($manifest.partCount), listed=$($parts.Count)"
}

foreach ($part in $parts) {
  $partPath = Join-Path $partsDirectory $part.file
  if (-not (Test-Path -LiteralPath $partPath -PathType Leaf)) {
    throw "Missing part: $($part.file)"
  }
  $item = Get-Item -LiteralPath $partPath
  if ([int64]$item.Length -ne [int64]$part.bytes) {
    throw "Part size mismatch: $($part.file)"
  }
  $actual = (Get-FileHash -LiteralPath $partPath -Algorithm SHA256).Hash.ToLowerInvariant()
  if ($actual -ne [string]$part.sha256) {
    throw "Part SHA256 mismatch: $($part.file)"
  }
}

if (Test-Path -LiteralPath $DestinationDirectory) {
  $existing = @(Get-ChildItem -LiteralPath $DestinationDirectory -Force -ErrorAction SilentlyContinue)
  if ($existing.Count -gt 0) {
    throw "Destination is not empty: $DestinationDirectory"
  }
} else {
  New-Item -ItemType Directory -Path $DestinationDirectory | Out-Null
}

$archivePath = Join-Path $DestinationDirectory $manifest.archiveFile
$output = [IO.File]::Open($archivePath, [IO.FileMode]::CreateNew, [IO.FileAccess]::Write, [IO.FileShare]::None)
try {
  $buffer = New-Object byte[] (4MB)
  foreach ($part in $parts) {
    $partPath = Join-Path $partsDirectory $part.file
    $input = [IO.File]::OpenRead($partPath)
    try {
      while (($read = $input.Read($buffer, 0, $buffer.Length)) -gt 0) {
        $output.Write($buffer, 0, $read)
      }
    } finally {
      $input.Dispose()
    }
  }
} finally {
  $output.Dispose()
}

$archive = Get-Item -LiteralPath $archivePath
if ([int64]$archive.Length -ne [int64]$manifest.archiveBytes) {
  throw 'Combined archive size mismatch.'
}
$archiveHash = (Get-FileHash -LiteralPath $archivePath -Algorithm SHA256).Hash.ToLowerInvariant()
if ($archiveHash -ne [string]$manifest.archiveSha256) {
  throw 'Combined archive SHA256 mismatch.'
}

tar -xzf $archivePath -C $DestinationDirectory
if ($LASTEXITCODE -ne 0) {
  throw "tar extraction failed with exit code $LASTEXITCODE"
}

$restoredRoot = Join-Path $DestinationDirectory 'COCO_FINAL_CLEAN_SEPARATED_REVIEW_2026-11-28'
$sumPath = Join-Path $restoredRoot 'SHA256SUMS.txt'
if (-not (Test-Path -LiteralPath $sumPath -PathType Leaf)) {
  throw "Missing restored SHA256SUMS.txt: $sumPath"
}

$checked = 0
foreach ($line in Get-Content -LiteralPath $sumPath) {
  if ($line -notmatch '^([0-9a-fA-F]{64}) \*(.+)$') {
    throw "Invalid SHA256SUMS line: $line"
  }
  $expected = $Matches[1].ToLowerInvariant()
  $relative = $Matches[2] -replace '/', [IO.Path]::DirectorySeparatorChar
  $filePath = Join-Path $restoredRoot $relative
  if (-not (Test-Path -LiteralPath $filePath -PathType Leaf)) {
    throw "Missing restored file: $relative"
  }
  $actual = (Get-FileHash -LiteralPath $filePath -Algorithm SHA256).Hash.ToLowerInvariant()
  if ($actual -ne $expected) {
    throw "Restored file SHA256 mismatch: $relative"
  }
  $checked += 1
}

[ordered]@{
  pass = $true
  restoredRoot = $restoredRoot
  partCount = $parts.Count
  archiveBytes = [int64]$archive.Length
  archiveSha256 = $archiveHash
  verifiedFiles = $checked
} | ConvertTo-Json -Depth 4

