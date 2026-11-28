$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $MyInvocation.MyCommand.Path
$out = Join-Path $root 'COCO-完整组合源码'
if (Test-Path -LiteralPath $out) { throw "组合目标已经存在：$out" }
New-Item -ItemType Directory -Path $out | Out-Null
Get-ChildItem -LiteralPath (Join-Path $root '03-通用导入器底层代码') | Copy-Item -Destination $out -Recurse -Force
Get-ChildItem -LiteralPath (Join-Path $root '02-COCO网站源代码') | Copy-Item -Destination $out -Recurse -Force
Write-Host "组合完成：$out"
Write-Host '下一步：进入该目录，执行 npm ci、npm test、npm run check。'
