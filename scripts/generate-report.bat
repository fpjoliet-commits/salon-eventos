@echo off
cd /d "%~dp0"
node generate-report.js >> "%~dp0log.txt" 2>&1
