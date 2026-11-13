@echo off
cd /d "%~dp0app"
if not exist node_modules call npm install --no-audit --no-fund
if not exist data\republica.db call npm run demo
start "" http://localhost:3000
call npm start
pause
