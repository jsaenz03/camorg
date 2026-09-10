# Make-MSIX — packages an installed Camog Windows build into an .msix for
# Microsoft Store submission (Partner Center accepts only MSIX for packaged
# apps; Store re-signs the final package, so local signing is optional and
# only needed for local validation).
#
# Run on a Windows machine/runner with the Windows SDK (MakeAppx.exe /
# Signtool.exe) and the Camog NSIS setup installed, e.g.:
#
#   .\scripts\make-msix.ps1 `
#     -AppDir "C:\Program Files\Camog" `
#     -Version "0.6.0.0" `
#     -IdentityName "PASTE_PARTNER_CENTER_PACKAGE_NAME" `
#     -Publisher "PASTE_PARTNER_CENTER_PUBLISHER_CN" `
#     -OutDir .\msix
#
# Identity values come from Partner Center: App management → App identity
# ("Package/Identity" → Name and Publisher). See MSSTORE_GUIDE.md step 2.
#
# The WebView2 PackageDependency below matches the Microsoft Store's
# framework package so packaged installs get the WebView2 runtime.

param(
  [Parameter(Mandatory = $true)][string]$AppDir,
  [Parameter(Mandatory = $true)][string]$Version,          # "x.y.z.0"
  [Parameter(Mandatory = $true)][string]$IdentityName,     # Partner Center package name
  [Parameter(Mandatory = $true)][string]$Publisher,        # Partner Center publisher (CN=...)
  [string]$Executable = "Camog.exe",
  [string]$DisplayName = "Camog",
  [string]$OutDir = ".\msix",
  # Sideloading a test package fails unless the machine has Microsoft's
  # WebView2 framework package (the Store resolves the dependency
  # automatically; a direct install does not). Skip it for local test
  # builds — the app's own WebView2 loader still finds the evergreen
  # runtime that Windows 11 ships.
  [switch]$NoWebView2Dependency
)

$ErrorActionPreference = "Stop"

if (-not (Test-Path (Join-Path $AppDir $Executable))) {
  throw "Executable not found: $(Join-Path $AppDir $Executable). Point -AppDir at the installed app folder."
}

$staging = Join-Path $OutDir "staging"
Remove-Item -Recurse -Force $staging -ErrorAction SilentlyContinue
New-Item -ItemType Directory -Force -Path $staging | Out-Null

# The app files form the package payload.
Copy-Item -Path (Join-Path $AppDir "*") -Destination $staging -Recurse -Force

# Store-required logo assets (44x44 shown in Start/tiles; 150x150 optional
# but expected). Replace with branded art from the Store listing assets when
# available — these placeholders pass packaging validation.
$assets = Join-Path $staging "assets"
New-Item -ItemType Directory -Force -Path $assets | Out-Null
Add-Type -AssemblyName System.Drawing
foreach ($size in 44, 150) {
  $bmp = New-Object System.Drawing.Bitmap($size, $size)
  $g = [System.Drawing.Graphics]::FromImage($bmp)
  $g.Clear([System.Drawing.Color]::FromArgb(28, 100, 242))
  $font = New-Object System.Drawing.Font("Segoe UI", $size * 0.45)
  $g.DrawString("C", $font, [System.Drawing.Brushes]::White, ($size * 0.28), ($size * 0.12))
  $g.Dispose()
  $bmp.Save((Join-Path $assets "Square${size}x${size}Logo.png"), [System.Drawing.Imaging.ImageFormat]::Png)
  $bmp.Dispose()
}

# AppxManifest — Win32 full-trust app. The WebView2 package dependency is
# included unless -NoWebView2Dependency is set (see param comment).
$webview2Dependency = if ($NoWebView2Dependency) { "" } else @"

    <PackageDependency Name="Microsoft.WebView2"
      MinVersion="119.0.2151.48"
      Publisher="CN=Microsoft Corporation, O=Microsoft Corporation, L=Redmond, S=Washington, C=US" />
"@
$manifest = @"
<?xml version="1.0" encoding="utf-8"?>
<Package
  xmlns="http://schemas.microsoft.com/appx/manifest/foundation/windows10"
  xmlns:uap="http://schemas.microsoft.com/appx/manifest/uap/windows10"
  xmlns:rescap="http://schemas.microsoft.com/appx/manifest/foundation/windows10/restrictedcapabilities">
  <Identity Name="$IdentityName" Version="$Version" Publisher="$Publisher" />
  <Properties>
    <DisplayName>$DisplayName</DisplayName>
    <PublisherDisplayName>ClinicIQ Solutions</PublisherDisplayName>
    <Logo>assets\Square44x44Logo.png</Logo>
  </Properties>
  <Dependencies>
    <TargetDeviceFamily Name="Windows.Desktop" MinVersion="10.0.17763.0" MaxVersionTested="10.0.22621.0" />$webview2Dependency
  </Dependencies>
  <Resources>
    <Resource Language="en-au" />
  </Resources>
  <Applications>
    <Application Id="Camog" Executable="$Executable" EntryPoint="Windows.FullTrustApplication">
      <uap:VisualElements
        DisplayName="$DisplayName"
        Description="Clinical photo documentation"
        BackgroundColor="transparent"
        Square150x150Logo="assets\Square150x150Logo.png"
        Square44x44Logo="assets\Square44x44Logo.png">
        <uap:DefaultTile Square44x44Logo="assets\Square44x44Logo.png" Square150x150Logo="assets\Square150x150Logo.png" />
      </uap:VisualElements>
    </Application>
  </Applications>
  <Capabilities>
    <rescap:Capability Name="runFullTrust" />
  </Capabilities>
</Package>
"@
$manifest | Out-File -FilePath (Join-Path $staging "AppxManifest.xml") -Encoding utf8

# Locate MakeAppx (Windows SDK) and pack.
$makeAppx = Get-ChildItem "C:\Program Files (x86)\Windows Kits\10\bin" -Recurse -Filter "MakeAppx.exe" -ErrorAction SilentlyContinue |
  Sort-Object FullName -Descending | Select-Object -First 1 -ExpandProperty FullName
if (-not $makeAppx) { throw "MakeAppx.exe not found — install the Windows 10/11 SDK." }

New-Item -ItemType Directory -Force -Path $OutDir | Out-Null
$msix = Join-Path $OutDir "Camog_${Version}_x64.msix"
& $makeAppx pack /d $staging /p $msix /o
if ($LASTEXITCODE -ne 0) { throw "MakeAppx pack failed." }

Write-Host "`nPacked: $msix"
Write-Host "Optional local validation (Store re-signs the uploaded package):"
Write-Host "  signtool sign /fd SHA256 /a /f <selfsigned.pfx> `"$msix`""
Write-Host "Upload this .msix in Partner Center → Packages."
