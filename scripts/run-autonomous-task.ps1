[CmdletBinding()]
param(
    [Parameter(Position = 0)]
    [string]$Task
)

$ErrorActionPreference = 'Stop'
$repoRoot = Split-Path -Parent $PSScriptRoot
Set-Location $repoRoot
if ([string]::IsNullOrWhiteSpace($Task)) {
    $masterTaskPath = Join-Path $repoRoot 'docs\AUTONOMOUS-MASTER-TASK.md'
    if (-not (Test-Path $masterTaskPath)) { throw "Default task file missing: $masterTaskPath" }
    $Task = Get-Content $masterTaskPath -Raw
    Write-Host 'No custom task supplied; using docs/AUTONOMOUS-MASTER-TASK.md' -ForegroundColor Cyan
}

# Find Codex even if the WinGet links directory is not in this PowerShell session's PATH.
$codexCommand = Get-Command codex -ErrorAction SilentlyContinue
if ($codexCommand) {
    $codexPath = $codexCommand.Source
} else {
    $codexPath = Join-Path $env:LOCALAPPDATA 'Microsoft\WinGet\Links\codex.exe'
}
if (-not (Test-Path $codexPath)) {
    throw 'Codex CLI was not found. Install it and open a new terminal.'
}

# Native CLI tools write status text to stderr; keep it non-terminating so we can inspect the exit code.
$oldErrorActionPreference = $ErrorActionPreference
$ErrorActionPreference = 'Continue'
$authOutput = & $codexPath login status 2>&1
$authExitCode = $LASTEXITCODE
$ErrorActionPreference = $oldErrorActionPreference
if ($authExitCode -ne 0 -or (($authOutput | Out-String) -match 'Not logged in')) {
    Write-Host 'One-time setup required: run the Codex login command in a terminal and complete sign-in.' -ForegroundColor Yellow
    Write-Host "Codex executable: $codexPath"
    exit 2
}

$reportDir = Join-Path $repoRoot 'local-audit-logs'
New-Item -ItemType Directory -Path $reportDir -Force | Out-Null
$stamp = Get-Date -Format 'yyyyMMdd-HHmmss'
$transcript = Join-Path $reportDir "autonomous-task-$stamp.log"
$lastMessage = Join-Path $reportDir "autonomous-task-$stamp-result.md"

$guardrails = @'
Follow AGENTS.md and docs/AUTONOMOUS-AGENT.md. Work only in this repository and current branch. Inspect git status before editing and preserve all pre-existing user changes. Make small reversible code changes, add regression tests, run relevant checks, diagnose failures and retry at most three times per failure class. Never commit, push, merge, deploy, or modify production infrastructure or Supabase. Never perform live wallet/withdrawal/sweep/broadcast/trade actions, access production funds, expose secrets, exploit third-party sites, or disable security checks to get a green result. Use test fixtures and local/staging resources only. If blocked by missing credentials, unsafe environment, or an action requiring authorization, stop that part and report the blocker. Finish with a factual summary of files changed, tests and exact outcomes, unresolved risks, and git status.
'@
$fullPrompt = "USER TASK:`n$Task`n`nMANDATORY OPERATING RULES:`n$guardrails"

Write-Host "Starting Codex with requested workspace-write sandbox for: $Task" -ForegroundColor Cyan
Write-Host 'The agent may edit repository files, but this wrapper does not commit, push, deploy, or touch production services.'
$fullPrompt | Out-File -FilePath (Join-Path $reportDir "autonomous-task-$stamp-prompt.txt") -Encoding utf8
$oldErrorActionPreference = $ErrorActionPreference
$ErrorActionPreference = 'Continue'
# Pass the prompt through a closed pipeline so Codex does not wait on inherited stdin.
$fullPrompt | & $codexPath exec --sandbox workspace-write --cd $repoRoot --output-last-message $lastMessage - 2>&1 | Tee-Object -FilePath $transcript
$agentExitCode = $LASTEXITCODE
$ErrorActionPreference = $oldErrorActionPreference
Write-Host "`nCodex exit code: $agentExitCode"
Write-Host "Transcript: $transcript"
if (Test-Path $lastMessage) { Write-Host "Final response: $lastMessage" }

# Codex can return exit code 0 after reporting that policy/sandbox blocked the task.
# Treat that as a blocked run, not a successful automation cycle.
$combinedOutput = ''
if (Test-Path $transcript) { $combinedOutput += Get-Content $transcript -Raw }
if (Test-Path $lastMessage) { $combinedOutput += [Environment]::NewLine + (Get-Content $lastMessage -Raw) }
if ($combinedOutput -match '(?i)(workspace (?:is|was) (?:mounted )?read-only|sandbox:\s*read-only|rejected by policy|blocked by policy|blocked by execution policy|execution policy.*rejected|approval:\s*never|cannot create.*(?:file|progress)|can.t .*implement fixes)') {
    Write-Error "Codex reported a read-only/policy blocker. This run is NOT successful; see $transcript"
    exit 3
}
exit $agentExitCode
