param(
  [string]$MigrationDirectory = (Join-Path $PSScriptRoot '..\supabase\migrations')
)
$ErrorActionPreference = 'Stop'
$resolved = (Resolve-Path $MigrationDirectory).Path
$files = @(Get-ChildItem -LiteralPath $resolved -File -Filter '*.sql')
$issues = [System.Collections.Generic.List[string]]::new()
$versionMap = @{}
foreach ($file in $files) {
  if ($file.BaseName -notmatch '^([0-9]{14})_(.+)$') {
    $issues.Add("INVALID_FILENAME: $($file.Name) — expected 14-digit version followed by underscore and name.")
    continue
  }
  $version = $Matches[1]
  if ($versionMap.ContainsKey($version)) {
    $issues.Add("DUPLICATE_VERSION: $version — '$($versionMap[$version])' and '$($file.Name)'.")
  } else {
    $versionMap[$version] = $file.Name
  }
}
Write-Output "Migration files scanned: $($files.Count)"
Write-Output "Unique valid version prefixes: $($versionMap.Count)"
if ($issues.Count -gt 0) {
  Write-Output "PREFLIGHT BLOCKED: $($issues.Count) naming/version issue(s). Do not apply this migration directory to a shared database."
  $issues | ForEach-Object { Write-Output " - $_" }
  exit 1
}
Write-Output 'PREFLIGHT PASSED: migration version prefixes are valid and unique.'
exit 0
