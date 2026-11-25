<#
.SYNOPSIS
  Builds the Nottli MSIX package for the Microsoft Store (or a self-signed local test package).

.EXAMPLE
  # Local test package, self-signed (install it yourself to try it out):
  .\scripts\build-msix.ps1 -TestSign

.EXAMPLE
  # Store package. Use the exact values from Partner Center > Product identity:
  .\scripts\build-msix.ps1 -IdentityName "12345Publisher.Nottli" -Publisher "CN=XXXXXXXX-XXXX-..." -PublisherDisplayName "Your Name"

  The Store package is left unsigned on purpose: the Store signs it after certification.
#>
param(
  [string]$IdentityName = "Nottli.Test",
  [string]$Publisher = "CN=NottliTest",
  [string]$PublisherDisplayName = "Nottli",
  [switch]$TestSign,
  [switch]$SkipBuild
)

$ErrorActionPreference = "Stop"
$root = Split-Path -Parent $PSScriptRoot
Set-Location $root

$conf = Get-Content "src-tauri/tauri.conf.json" -Raw | ConvertFrom-Json
# MSIX versions are four parts; the Store requires the last part to be 0.
$version = "$($conf.version).0"
if ($conf.version -notmatch '^\d+\.\d+\.\d+$') { throw "Expected a x.y.z version in tauri.conf.json, got '$($conf.version)'" }

if (-not $SkipBuild) {
  pnpm tauri build --no-bundle
  if ($LASTEXITCODE -ne 0) { throw "tauri build failed" }
}

$targetDir = (cargo metadata --format-version 1 --no-deps --manifest-path src-tauri/Cargo.toml | ConvertFrom-Json).target_directory
$exe = Join-Path $targetDir "release/desktop-doodle-companion.exe"
if (-not (Test-Path $exe)) { throw "Release exe not found at $exe" }

# Windows SDK tools
$sdk = Get-ChildItem "${env:ProgramFiles(x86)}\Windows Kits\10\bin" -Directory |
  Where-Object { $_.Name -match '^10\.' -and (Test-Path (Join-Path $_.FullName "x64\makeappx.exe")) } |
  Sort-Object Name -Descending | Select-Object -First 1
if (-not $sdk) { throw "Windows 10/11 SDK (makeappx.exe) not found. Install the Windows SDK." }
$makeappx = Join-Path $sdk.FullName "x64\makeappx.exe"
$signtool = Join-Path $sdk.FullName "x64\signtool.exe"

# Stage the package contents
$out = Join-Path $root "dist-msix"
$stage = Join-Path $out "stage"
if (Test-Path $stage) { Remove-Item $stage -Recurse -Force }
New-Item -ItemType Directory -Path (Join-Path $stage "Assets") -Force | Out-Null
Copy-Item $exe (Join-Path $stage "Nottli.exe")
foreach ($a in "StoreLogo", "Square150x150Logo", "Square44x44Logo") {
  Copy-Item "src-tauri/icons/$a.png" (Join-Path $stage "Assets/$a.png")
}

$manifest = Get-Content "packaging/msix/AppxManifest.template.xml" -Raw
$manifest = $manifest.Replace("__IDENTITY_NAME__", $IdentityName).
  Replace("__PUBLISHER__", $Publisher).
  Replace("__PUBLISHER_DISPLAY__", $PublisherDisplayName).
  Replace("__VERSION__", $version)
Set-Content -Path (Join-Path $stage "AppxManifest.xml") -Value $manifest -Encoding utf8

$msix = Join-Path $out "Nottli_${version}_x64.msix"
if (Test-Path $msix) { Remove-Item $msix -Force }
& $makeappx pack /d $stage /p $msix /o
if ($LASTEXITCODE -ne 0) { throw "makeappx failed" }

if ($TestSign) {
  $cert = Get-ChildItem Cert:\CurrentUser\My | Where-Object { $_.Subject -eq $Publisher } | Select-Object -First 1
  if (-not $cert) {
    $cert = New-SelfSignedCertificate -Type Custom -Subject $Publisher -KeyUsage DigitalSignature `
      -FriendlyName "Nottli test" -CertStoreLocation Cert:\CurrentUser\My `
      -TextExtension @("2.5.29.37={text}1.3.6.1.5.5.7.3.3", "2.5.29.19={text}")
  }
  & $signtool sign /fd SHA256 /sha1 $cert.Thumbprint $msix
  if ($LASTEXITCODE -ne 0) { throw "signtool failed" }
  $cer = Join-Path $out "NottliTest.cer"
  Export-Certificate -Cert $cert -FilePath $cer | Out-Null
  Write-Host "`nTest package signed. To install it:"
  Write-Host "  1. Admin PowerShell: Import-Certificate -FilePath '$cer' -CertStoreLocation Cert:\LocalMachine\TrustedPeople"
  Write-Host "  2. Double-click $msix"
} else {
  Write-Host "`nUnsigned package for Partner Center upload (the Store signs it)."
}
Write-Host "Output: $msix"
