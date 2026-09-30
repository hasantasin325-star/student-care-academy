@echo off
setlocal
cd /d "%~dp0"
echo.
echo =============================================
echo   Student Care Academy - Setup and Run
echo =============================================
echo.
echo Checking Node.js...
node -v >nul 2>&1
if errorlevel 1 (
  echo Node.js is not installed or not in PATH.
  echo Install Node.js LTS, then run this file again.
  pause
  exit /b 1
)
echo Installing required packages...
npm install
if errorlevel 1 (
  echo.
  echo npm install failed. Check your internet connection or npm error above.
  pause
  exit /b 1
)
echo.
echo Starting Student Care Academy...
start "Student Care Academy Server" cmd /k "npm start"
timeout /t 3 >nul
start "" http://localhost:3000
echo.
echo The website should now open at http://localhost:3000
pause
