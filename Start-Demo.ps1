$ErrorActionPreference = 'Stop'
Set-Location -LiteralPath $PSScriptRoot
if (-not (Test-Path -LiteralPath 'dist/index.html')) { npm run build }
Start-Process -FilePath 'node' -ArgumentList 'scripts/serve.mjs' -WorkingDirectory $PSScriptRoot -WindowStyle Hidden -RedirectStandardOutput '.tools/server.log' -RedirectStandardError '.tools/server-error.log'
if (Test-Path -LiteralPath '.tools/cloudflared.exe') {
    Start-Process -FilePath (Join-Path $PSScriptRoot '.tools/cloudflared.exe') -ArgumentList 'tunnel --url http://localhost:4174 --protocol http2' -WorkingDirectory $PSScriptRoot -WindowStyle Hidden -RedirectStandardOutput '.tools/tunnel-output.log' -RedirectStandardError '.tools/tunnel.log'
    Write-Host 'Preview started. The new phone HTTPS URL appears in .tools/tunnel.log after several seconds.'
} else {
    Write-Host 'Local preview started at http://localhost:4174. Install cloudflared to create an HTTPS phone link.'
}
Start-Process 'http://localhost:4174'
