@echo off
setlocal
cd /d "%~dp0"
powershell.exe -NoLogo -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\cleanp2p-autopilot.ps1"
set "RESULT=%ERRORLEVEL%"
echo.
if "%RESULT%"=="0" (
  echo Autopilot checks passed. Review the report before deployment.
) else (
  echo Autopilot finished with status %RESULT%. Review local-audit-logs.
)
echo.
pause
exit /b %RESULT%
