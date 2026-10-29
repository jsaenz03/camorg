# Camog phone-link firewall repair.
#
# Recreates the "Camog phone link" inbound rule so the phone link works on
# Private AND Public network profiles — the same rule the Windows installer
# creates (installer-hooks.nsh), scoped to the local subnet plus Tailscale's
# range (100.64.0.0/10) and bound to whichever Camog.exe it finds.
#
# Run on the practice PC in an ADMINISTRATOR PowerShell:
#   powershell -ExecutionPolicy Bypass -File .\repair-phone-link-firewall.ps1
#
# Machines where the rule is missing or Private-only (Microsoft Store
# installs, or a declined UAC prompt at install time — Windows' own
# "Allow access" dialog defaults to Private only) are the ones where the
# phone link fails on a Public-profile network. This script replaces that
# rule; no Camog reinstall needed.

$ErrorActionPreference = 'Stop'

Remove-NetFirewallRule -DisplayName 'Camog phone link' -ErrorAction SilentlyContinue

$exe = @(
  "$env:LOCALAPPDATA\Programs\Camog\Camog.exe",
  "$env:ProgramFiles\Camog\Camog.exe",
  "${env:ProgramFiles(x86)}\Camog\Camog.exe"
) | Where-Object { Test-Path $_ } | Select-Object -First 1

if (-not $exe) {
  Write-Host "Camog.exe not found - install Camog first."
  exit 1
}

New-NetFirewallRule -DisplayName 'Camog phone link' `
  -Direction Inbound -Action Allow -Program $exe -Protocol TCP -Profile Any `
  -RemoteAddress LocalSubnet,100.64.0.0/10 | Out-Null

Write-Host "Rule created for $exe - all network profiles, local subnet + Tailscale only."
