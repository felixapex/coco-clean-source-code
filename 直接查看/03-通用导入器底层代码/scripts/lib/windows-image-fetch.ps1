param(
  [Parameter(Mandatory = $true)][string]$Url,
  [Parameter(Mandatory = $true)][string]$OutputPath,
  [Parameter(Mandatory = $true)][string]$MetadataPath,
  [Parameter(Mandatory = $true)][int]$TimeoutSeconds,
  [Parameter(Mandatory = $true)][string]$UserAgent
)

$ErrorActionPreference = 'Stop'

function Write-Metadata([hashtable]$Value) {
  $json = $Value | ConvertTo-Json -Compress
  [System.IO.File]::WriteAllText($MetadataPath, $json, [System.Text.UTF8Encoding]::new($false))
}

try {
  $response = Invoke-WebRequest `
    -Uri $Url `
    -UseBasicParsing `
    -MaximumRedirection 10 `
    -TimeoutSec $TimeoutSeconds `
    -UserAgent $UserAgent `
    -Headers @{ Accept = 'image/avif,image/webp,image/apng,image/svg+xml,image/*,*/*;q=0.8' } `
    -OutFile $OutputPath `
    -PassThru

  $contentType = [string]$response.Headers['Content-Type']
  if ($contentType.Contains(';')) { $contentType = $contentType.Split(';')[0] }
  Write-Metadata @{
    ok = $true
    status = [int]$response.StatusCode
    contentType = $contentType
    resolvedSource = [string]$response.BaseResponse.ResponseUri.AbsoluteUri
  }
  exit 0
} catch {
  $status = 0
  try { $status = [int]$_.Exception.Response.StatusCode } catch {}
  Write-Metadata @{
    ok = $false
    status = $status
    error = [string]$_.Exception.Message
  }
  exit 2
}
