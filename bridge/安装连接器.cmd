@echo off
cd /d "%~dp0.."
call npm ci --omit=dev --no-audit --no-fund
if errorlevel 1 goto failed
node bridge/setup.mjs --install
if errorlevel 1 goto failed
echo.
echo Setup complete. Import .moji\connection.json in the extension.
pause
exit /b 0
:failed
echo.
echo Setup failed. Please copy the error message above.
pause
exit /b 1
