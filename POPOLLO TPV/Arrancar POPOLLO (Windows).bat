@echo off
cd /d "%~dp0"
where node >nul 2>nul || (echo Falta Node.js. Descargalo (version LTS) en https://nodejs.org & pause & exit /b)
start "" http://localhost:8080
node --no-warnings server.js
pause
