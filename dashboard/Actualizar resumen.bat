@echo off
REM Doble click para actualizar el resumen del escritorio ahora mismo.
cd /d "%~dp0"
powershell -NoProfile -ExecutionPolicy Bypass -File "actualizar-resumen.ps1"
