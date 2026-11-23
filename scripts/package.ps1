$ErrorActionPreference = 'Stop'
$mojiRoot = Split-Path -Parent $PSScriptRoot
$mojiExtension = Join-Path $mojiRoot 'extension'
$mojiOutput = Join-Path $mojiRoot 'dist'
New-Item -ItemType Directory -Force -Path $mojiOutput | Out-Null
$mojiVersion = (Get-Content -LiteralPath (Join-Path $mojiExtension 'manifest.json') -Raw | ConvertFrom-Json).version
$mojiZip = Join-Path $mojiOutput "moji-reader-v$mojiVersion.zip"
Compress-Archive -LiteralPath $mojiExtension -DestinationPath $mojiZip -Force
Write-Output "Packaged extension: $mojiZip"
$mojiConnectorZip = Join-Path $mojiOutput "moji-codex-v$mojiVersion.zip"
$mojiBundle = @($mojiExtension, (Join-Path $mojiRoot 'bridge'), (Join-Path $mojiRoot 'package.json'), (Join-Path $mojiRoot 'package-lock.json'), (Join-Path $mojiRoot 'README.md'), (Join-Path $mojiRoot 'docs'), (Join-Path $mojiRoot 'VERIFICATION.md'))
Compress-Archive -LiteralPath $mojiBundle -DestinationPath $mojiConnectorZip -Force
Write-Output "Packaged connector (no credentials or user data): $mojiConnectorZip"
