; Camog installer hooks — the Tauri NSIS template invokes these macros.
;
; POSTINSTALL adds the one inbound firewall rule the phone link needs,
; scoped to the local subnet plus Tailscale's CGNAT range (100.64.0.0/10),
; so the pairing listener cannot be reached from beyond the machine's own
; networks. The rule is program-scoped, so it follows whichever port the
; link pins or falls back to. Windows requires admin to touch the firewall,
; so the command elevates through one UAC prompt; if the user declines,
; Windows falls back to its standard "allow this app?" prompt the first
; time the link listens — the pre-hook behaviour, never worse. The
; PowerShell payload is base64 (UTF-16LE) to keep path quoting out of the
; NSIS layer entirely; the elevated script locates the installed .exe
; itself (per-user or per-machine) so no path crosses the boundary.
;
; Install payload, decoded:
;   $ErrorActionPreference='SilentlyContinue';
;   Remove-NetFirewallRule -DisplayName 'Camog phone link';
;   $exe=@("${env:LOCALAPPDATA}\Programs\Camog\Camog.exe",
;          "${env:ProgramFiles}\Camog\Camog.exe",
;          "${env:ProgramFiles(x86)}\Camog\Camog.exe")
;     | Where-Object { Test-Path $_ } | Select-Object -First 1;
;   if ($exe) { New-NetFirewallRule -DisplayName 'Camog phone link'
;     -Direction Inbound -Action Allow -Program $exe -Protocol TCP
;     -RemoteAddress LocalSubnet,100.64.0.0/10 | Out-Null }
;
; Uninstall payload, decoded:
;   Remove-NetFirewallRule -DisplayName 'Camog phone link' -ErrorAction SilentlyContinue

!macro NSIS_HOOK_POSTINSTALL
  nsExec::ExecToLog `powershell -NoProfile -ExecutionPolicy Bypass -Command "Start-Process powershell -Verb RunAs -WindowStyle Hidden -Wait -ArgumentList @('-NoProfile','-EncodedCommand','JABFAHIAcgBvAHIAQQBjAHQAaQBvAG4AUAByAGUAZgBlAHIAZQBuAGMAZQA9ACcAUwBpAGwAZQBuAHQAbAB5AEMAbwBuAHQAaQBuAHUAZQAnADsAIABSAGUAbQBvAHYAZQAtAE4AZQB0AEYAaQByAGUAdwBhAGwAbABSAHUAbABlACAALQBEAGkAcwBwAGwAYQB5AE4AYQBtAGUAIAAnAEMAYQBtAG8AZwAgAHAAaABvAG4AZQAgAGwAaQBuAGsAJwA7ACAAJABlAHgAZQA9AEAAKAAiACQAewBlAG4AdgA6AEwATwBDAEEATABBAFAAUABEAEEAVABBAH0AXABQAHIAbwBnAHIAYQBtAHMAXABDAGEAbQBvAGcAXABDAGEAbQBvAGcALgBlAHgAZQAiACwAIgAkAHsAZQBuAHYAOgBQAHIAbwBnAHIAYQBtAEYAaQBsAGUAcwB9AFwAQwBhAG0AbwBnAFwAQwBhAG0AbwBnAC4AZQB4AGUAIgAsACIAJAB7AGUAbgB2ADoAUAByAG8AZwByAGEAbQBGAGkAbABlAHMAKAB4ADgANgApAH0AXABDAGEAbQBvAGcAXABDAGEAbQBvAGcALgBlAHgAZQAiACkAIAB8ACAAVwBoAGUAcgBlAC0ATwBiAGoAZQBjAHQAIAB7ACAAVABlAHMAdAAtAFAAYQB0AGgAIAAkAF8AIAB9ACAAfAAgAFMAZQBsAGUAYwB0AC0ATwBiAGoAZQBjAHQAIAAtAEYAaQByAHMAdAAgADEAOwAgAGkAZgAgACgAJABlAHgAZQApACAAewAgAE4AZQB3AC0ATgBlAHQARgBpAHIAZQB3AGEAbABsAFIAdQBsAGUAIAAtAEQAaQBzAHAAbABhAHkATgBhAG0AZQAgACcAQwBhAG0AbwBnACAAcABoAG8AbgBlACAAbABpAG4AawAnACAALQBEAGkAcgBlAGMAdABpAG8AbgAgAEkAbgBiAG8AdQBuAGQAIAAtAEEAYwB0AGkAbwBuACAAQQBsAGwAbwB3ACAALQBQAHIAbwBnAHIAYQBtACAAJABlAHgAZQAgAC0AUAByAG8AdABvAGMAbwBsACAAVABDAFAAIAAtAFIAZQBtAG8AdABlAEEAZABkAHIAZQBzAHMAIABMAG8AYwBhAGwAUwB1AGIAbgBlAHQALAAxADAAMAAuADYANAAuADAALgAwAC8AMQAwACAAfAAgAE8AdQB0AC0ATgB1AGwAbAAgAH0A')"`
!macroend

!macro NSIS_HOOK_POSTUNINSTALL
  nsExec::ExecToLog `powershell -NoProfile -ExecutionPolicy Bypass -Command "Start-Process powershell -Verb RunAs -WindowStyle Hidden -Wait -ArgumentList @('-NoProfile','-EncodedCommand','UgBlAG0AbwB2AGUALQBOAGUAdABGAGkAcgBlAHcAYQBsAGwAUgB1AGwAZQAgAC0ARABpAHMAcABsAGEAeQBOAGEAbQBlACAAJwBDAGEAbQBvAGcAIABwAGgAbwBuAGUAIABsAGkAbgBrACcAIAAtAEUAcgByAG8AcgBBAGMAdABpAG8AbgAgAFMAaQBsAGUAbgB0AGwAeQBDAG8AbgB0AGkAbgB1AGUA')"`
!macroend
