@echo off
cd /d "%~dp0"
call npm run author
if errorlevel 1 pause
