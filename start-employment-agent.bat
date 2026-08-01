@echo off
setlocal

cd /d "%~dp0"

where node >nul 2>&1
if errorlevel 1 (
  echo Error: Node.js is not installed or is not available in PATH.
  echo Install Node.js, then run this launcher again.
  pause
  exit /b 1
)

where npm >nul 2>&1
if errorlevel 1 (
  echo Error: npm is not installed or is not available in PATH.
  echo Install npm, then run this launcher again.
  pause
  exit /b 1
)

if not exist "node_modules\" (
  echo Installing project dependencies...
  call npm install
  if errorlevel 1 (
    echo Error: npm install failed.
    pause
    exit /b 1
  )
)

if not exist "data\" mkdir "data"
if not exist "storage\curriculum\" mkdir "storage\curriculum"
if not exist "storage\generated\" mkdir "storage\generated"
if not exist "storage\screenshots\" mkdir "storage\screenshots"
if not exist "storage\logs\" mkdir "storage\logs"

set "DATABASE_PATH=%~dp0data\employment-agent.db"
set "STORAGE_PATH=%~dp0storage"

echo Starting Employment Agent at http://localhost:3000
echo Press Ctrl+C to stop the web and worker processes.
start "" /b cmd /d /c "timeout /t 3 /nobreak >nul & start http://localhost:3000"
call npm run dev

endlocal
