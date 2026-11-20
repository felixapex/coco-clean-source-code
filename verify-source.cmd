@echo off
setlocal
cd /d "%~dp0"
node tools\verify-clean-source-package.mjs "%~dp0"
if errorlevel 1 (
  echo.
  echo SOURCE PACKAGE VERIFICATION FAILED
  exit /b 1
)
echo.
echo SOURCE PACKAGE VERIFICATION PASSED
exit /b 0
