param(
  [switch]$SkipInstall,
  [switch]$SkipBuild,
  [switch]$SkipDependencyAudit
)
$ErrorActionPreference = "Stop"
$ProgressPreference = "SilentlyContinue"
$RepoRoot = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path
$LogDir = Join-Path $RepoRoot "local-audit-logs"
New-Item -ItemType Directory -Force -Path $LogDir | Out-Null
$Stamp = Get-Date -Format "yyyyMMdd-HHmmss"
$SummaryPath = Join-Path $LogDir "summary-$Stamp.txt"
$Results = [System.Collections.Generic.List[object]]::new()
function Add-Result([string]$Name, [string]$Status, [int]$ExitCode, [string]$Log) {
  $Results.Add([pscustomobject]@{ Check=$Name; Status=$Status; ExitCode=$ExitCode; Log=$Log })
  Write-Host ("[{0}] {1} (exit {2})" -f $Status, $Name, $ExitCode)
}
function Run-Check([string]$Name, [string]$Command, [string[]]$Arguments) {
  $Log = Join-Path $LogDir ("{0}-{1}.log" -f $Stamp, ($Name -replace '[^a-zA-Z0-9_-]','-'))
  Write-Host ("=== {0} ===" -f $Name)
  Push-Location $RepoRoot
  $PreviousErrorActionPreference = $ErrorActionPreference
  try {
    # Windows PowerShell 5.1 can turn native stderr (for example npm warnings)
    # into terminating NativeCommandError records when ErrorActionPreference=Stop.
    # Temporarily allow stderr through so the real process exit code is captured.
    $ErrorActionPreference = "Continue"
    & $Command @Arguments 2>&1 | Tee-Object -FilePath $Log
    $Code = $LASTEXITCODE
  } catch {
    $_ | Out-File -FilePath $Log -Append
    $Code = 1
  } finally {
    $ErrorActionPreference = $PreviousErrorActionPreference
    Pop-Location
  }
  if ($Code -eq 0) { Add-Result $Name "PASS" $Code $Log } else { Add-Result $Name "FAIL" $Code $Log }
}
function Get-DirectorySizeBytes([string]$Path) {
  if (!(Test-Path $Path)) { return [int64]0 }
  $sum = (Get-ChildItem -LiteralPath $Path -Force -Recurse -File -ErrorAction SilentlyContinue | Measure-Object -Property Length -Sum).Sum
  if ($null -eq $sum) { return [int64]0 }; return [int64]$sum
}
Write-Host "CleanP2P local validation (uses no GitHub Actions minutes)"
Write-Host "Repository: $RepoRoot"
Write-Host "Logs: $LogDir"
$Node = (node --version 2>$null)
$Npm = (npm --version 2>$null)
if (!$Node -or !$Npm) { throw "Node.js and npm are required. Install the current Node.js LTS release, then reopen PowerShell." }
Write-Host "Node: $Node; npm: $Npm"
$DriveName = ([System.IO.Path]::GetPathRoot($RepoRoot).Substring(0,1))
$Disk = Get-PSDrive -Name $DriveName -ErrorAction SilentlyContinue
if ($Disk -and $Disk.Free -lt 5GB) { throw "Less than 5 GB free on the repository drive. Free space before installing dependencies." }
$Package = Get-Content (Join-Path $RepoRoot "package.json") -Raw | ConvertFrom-Json
if (!$Package.scripts.typecheck) { throw "package.json has no typecheck script; refusing to guess a command." }
if (!$SkipInstall -and !(Test-Path (Join-Path $RepoRoot "node_modules"))) {
  if (!(Test-Path (Join-Path $RepoRoot "package-lock.json"))) { throw "package-lock.json missing; cannot perform reproducible npm ci." }
  Run-Check "Install locked dependencies" "npm" @("ci","--no-audit","--no-fund")
} elseif ($SkipInstall) {
  Write-Host "Dependency install skipped by user flag."
} else {
  Write-Host "node_modules already exists; install skipped."
}
$NodeModulesSize = Get-DirectorySizeBytes (Join-Path $RepoRoot "node_modules")
Write-Host ("node_modules size: {0:N2} GB" -f ($NodeModulesSize / 1GB))
if ($NodeModulesSize -gt 10GB) { throw "node_modules exceeds 10 GB cap; stopping." }
Run-Check "TypeScript typecheck" "npm" @("run","typecheck")
Run-Check "ESLint" "npm" @("run","lint")
if (!$SkipDependencyAudit) {
  Run-Check "Production dependency audit (read-only)" "npm" @("audit","--omit=dev")
} else { Write-Host "Dependency audit skipped." }
if (!$SkipBuild) {
  Run-Check "Next.js production build" "npm" @("run","build")
} else { Write-Host "Production build skipped." }
$RepoSize = Get-DirectorySizeBytes $RepoRoot
Write-Host ("Repository working-folder size: {0:N2} GB" -f ($RepoSize / 1GB))
if ($RepoSize -gt 10GB) { Write-Warning "Working folder is over 10 GB including logs and generated build output." }
$Results | Format-Table -AutoSize | Out-String | Set-Content -Path $SummaryPath
("Summary saved to: {0}" -f $SummaryPath) | Add-Content -Path $SummaryPath
Write-Host "SUMMARY"
$Results | Format-Table -AutoSize
$Failed = @($Results | Where-Object Status -eq "FAIL").Count
if ($Failed -gt 0) {
  Write-Warning "$Failed check(s) failed. Review the logs. No application source, database, or production data is changed by this script."
  exit 1
}
Write-Host "All executed checks passed. This does not by itself prove wallet/escrow flows production-safe."
exit 0
