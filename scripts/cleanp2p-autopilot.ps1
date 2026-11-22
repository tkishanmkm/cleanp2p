param(
  [switch]$SkipInstall,
  [switch]$SkipBuild,
  [switch]$RunIntegrationTests
)
$ErrorActionPreference = "Stop"
$ProgressPreference = "SilentlyContinue"
$Root = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path
$LogDir = Join-Path $Root "local-audit-logs"
New-Item -ItemType Directory -Force -Path $LogDir | Out-Null
$Stamp = Get-Date -Format "yyyyMMdd-HHmmss"
$Report = Join-Path $LogDir "autopilot-$Stamp.json"
$Rows = [System.Collections.Generic.List[object]]::new()
function Invoke-Check([string]$Name, [string]$Exe, [string[]]$Args, [switch]$AllowFailure) {
  $Log = Join-Path $LogDir ("{0}-{1}.log" -f $Stamp, ($Name -replace '[^a-zA-Z0-9_-]','-'))
  Write-Host "`n=== $Name ===" -ForegroundColor Cyan
  Push-Location $Root
  $prior = $ErrorActionPreference
  try {
    $ErrorActionPreference = "Continue"
    & $Exe @Args 2>&1 | Tee-Object -FilePath $Log
    $code = $LASTEXITCODE
  } catch {
    $_ | Out-File -FilePath $Log -Append
    $code = 1
  } finally {
    $ErrorActionPreference = $prior
    Pop-Location
  }
  $status = if ($code -eq 0) { "PASS" } else { "FAIL" }
  $Rows.Add([pscustomobject]@{ check=$Name; status=$status; exitCode=$code; log=$Log })
  if ($code -ne 0 -and !$AllowFailure) { Write-Warning "$Name failed; continuing to collect all results." }
}
Write-Host "CleanP2P Production Autopilot - local checks only" -ForegroundColor Green
Write-Host "Repository: $Root"
Write-Host "Report: $Report"
$node = (node --version 2>$null)
$npm = (npm --version 2>$null)
if (!$node -or !$npm) { throw "Node.js and npm are required. Install Node.js LTS once, then reopen this launcher." }
$Rows.Add([pscustomobject]@{check="Environment";status="INFO";node=$node;npm=$npm;root=$Root})
$diskRoot = [System.IO.Path]::GetPathRoot($Root)
$drive = Get-PSDrive -Name $diskRoot.Substring(0,1) -ErrorAction SilentlyContinue
if ($drive -and $drive.Free -lt 5GB) { throw "Less than 5 GB free; stopping before dependency installation." }
if (!(Test-Path (Join-Path $Root "package-lock.json"))) { throw "package-lock.json is missing; refusing non-reproducible installation." }
$bins = @("tsc.cmd","next.cmd","eslint.cmd") | ForEach-Object { Join-Path $Root ("node_modules\.bin\" + $_) }
$missing = @($bins | Where-Object { !(Test-Path $_) })
if (!$SkipInstall -and (!(Test-Path (Join-Path $Root "node_modules")) -or $missing.Count -gt 0)) {
  Invoke-Check "Install locked dependencies" "npm" @("ci","--no-audit","--no-fund")
}
if (!(Test-Path (Join-Path $Root "node_modules\.bin\tsc.cmd"))) {
  $Rows.Add([pscustomobject]@{check="Dependency tools";status="FAIL";detail="npm ci did not provide TypeScript; subsequent checks may fail."})
}
Invoke-Check "TypeScript" "npm" @("run","typecheck")
Invoke-Check "Lint" "npm" @("run","lint")
Invoke-Check "Production dependency security audit" "npm" @("audit","--omit=dev")
if (!$SkipBuild) { Invoke-Check "Production build" "npm" @("run","build") }
else { $Rows.Add([pscustomobject]@{check="Production build";status="SKIPPED";detail="SkipBuild supplied."}) }
if ($RunIntegrationTests) {
  if ($env:TEST_SUPABASE_URL -and $env:TEST_SUPABASE_SERVICE_ROLE_KEY -and $env:TEST_ALLOW_DESTRUCTIVE_P2P_TESTS -eq "true") {
    Invoke-Check "Integration test suite (dedicated test Supabase only)" "npm" @("run","test:all")
  } else {
    $Rows.Add([pscustomobject]@{check="Integration tests";status="BLOCKED";detail="Set dedicated test project credentials and TEST_ALLOW_DESTRUCTIVE_P2P_TESTS=true; never use production credentials."})
    Write-Warning "Integration tests were not run: dedicated isolated test credentials/explicit safety flag are missing."
  }
} else {
  $Rows.Add([pscustomobject]@{check="Integration tests";status="SKIPPED";detail="Use -RunIntegrationTests only after configuring a dedicated disposable test Supabase project."})
}
$Rows | ConvertTo-Json -Depth 5 | Set-Content -Path $Report -Encoding UTF8
Write-Host "`n=== AUTOPILOT SUMMARY ===" -ForegroundColor Cyan
$Rows | Format-Table -AutoSize
$failed = @($Rows | Where-Object { $_.status -eq "FAIL" }).Count
$blocked = @($Rows | Where-Object { $_.status -eq "BLOCKED" }).Count
Write-Host "JSON report: $Report"
if ($failed -gt 0) {
  Write-Warning "$failed check(s) failed. Logs are saved; no source code or database was modified by this runner."
  exit 1
}
if ($blocked -gt 0) { Write-Warning "Some checks were blocked. This is not a production approval."; exit 2 }
Write-Host "Executed checks passed. This is evidence collection, NOT proof of production readiness."
exit 0
