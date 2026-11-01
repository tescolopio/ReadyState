$ErrorActionPreference = 'Stop'
& (Join-Path $PSScriptRoot 'runtime\node.exe') (Join-Path $PSScriptRoot 'launch.mjs') --open-browser @args
exit $LASTEXITCODE
