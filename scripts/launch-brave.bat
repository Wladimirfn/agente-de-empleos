@echo off
REM ============================================================
REM Launch Brave with --remote-debugging-port=9222
REM
REM Double-click this file to run, or create a desktop shortcut
REM pointing to it. The agent will then be able to connect to
REM Brave via CDP.
REM
REM Idempotent: if Brave is already running with CDP, this is a no-op.
REM If Brave is running WITHOUT the debug port, close it first.
REM ============================================================

echo Launching Brave with remote debugging on port 9222...
echo.

node "%~dp0launch-brave.mjs" brave

if %ERRORLEVEL% NEQ 0 (
  echo.
  echo Failed to launch. See the error above.
  pause
)
