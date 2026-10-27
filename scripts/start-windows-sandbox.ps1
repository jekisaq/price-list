# Run from the repository root after enabling Windows Sandbox and rebooting.
$ErrorActionPreference = 'Stop'
$repository = Split-Path $PSScriptRoot
$validationDirectory = Join-Path $repository ('out\tests\windows-sandbox-' + (Get-Date -Format 'yyyyMMdd-HHmmss'))
$inputDirectory = Join-Path $validationDirectory 'input'
$resultsDirectory = Join-Path $validationDirectory 'results'
$null = New-Item -ItemType Directory -Path $inputDirectory,$resultsDirectory -Force
Copy-Item (Join-Path $repository 'release\Price-List-1.0.0-x64-Setup.exe') (Join-Path $inputDirectory 'Setup.exe')
$null = New-Item -ItemType Directory -Path (Join-Path $inputDirectory 'samples') -Force
Copy-Item (Join-Path $repository 'samples\csv'),(Join-Path $repository 'samples\xlsx') (Join-Path $inputDirectory 'samples') -Recurse
$guestScript = Get-Content (Join-Path $PSScriptRoot 'windows-sandbox.ps1') -Raw -Encoding UTF8
# Windows PowerShell 5.1 requires a BOM for Cyrillic source text.
[IO.File]::WriteAllText((Join-Path $inputDirectory 'validate.ps1'), $guestScript, [Text.UTF8Encoding]::new($true))
(Get-FileHash (Join-Path $inputDirectory 'Setup.exe') -Algorithm SHA256).Hash | Set-Content (Join-Path $inputDirectory 'sha256.txt')
$configuration = @"
<Configuration>
  <Networking>Disable</Networking>
  <MappedFolders>
    <MappedFolder><HostFolder>$([Security.SecurityElement]::Escape($inputDirectory))</HostFolder><SandboxFolder>C:\PriceListInput</SandboxFolder><ReadOnly>true</ReadOnly></MappedFolder>
    <MappedFolder><HostFolder>$([Security.SecurityElement]::Escape($resultsDirectory))</HostFolder><SandboxFolder>C:\PriceListResults</SandboxFolder><ReadOnly>false</ReadOnly></MappedFolder>
  </MappedFolders>
  <LogonCommand><Command>powershell.exe -NoProfile -ExecutionPolicy Bypass -File C:\PriceListInput\validate.ps1</Command></LogonCommand>
</Configuration>
"@
$configurationPath = Join-Path $validationDirectory 'validation.wsb'
$configuration | Set-Content $configurationPath -Encoding UTF8
$configurationPath | Set-Content (Join-Path $repository 'out\tests\active-windows-sandbox.txt')
Start-Process -FilePath "$env:WINDIR\System32\WindowsSandbox.exe" -ArgumentList ('"' + $configurationPath + '"') -WindowStyle Hidden
Write-Output $validationDirectory
