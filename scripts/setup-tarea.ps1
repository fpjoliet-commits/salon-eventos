# setup-tarea.ps1
# Instala la tarea semanal de generacion de informes en el Programador de Tareas de Windows.
# Ejecutar con boton derecho -> "Ejecutar con PowerShell" (o como administrador).

$ErrorActionPreference = "Stop"

$scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Definition
$batPath   = Join-Path $scriptDir "generate-report.bat"
$taskName  = "InformeSemanalSalon"

Write-Host ""
Write-Host "========================================" -ForegroundColor Cyan
Write-Host "  Instalador - Informe Semanal Salon    " -ForegroundColor Cyan
Write-Host "========================================" -ForegroundColor Cyan
Write-Host ""

# Verificar que los archivos necesarios existen
if (-not (Test-Path $batPath)) {
    Write-Host "ERROR: No se encontro generate-report.bat en $scriptDir" -ForegroundColor Red
    Read-Host "Presiona Enter para salir"
    exit 1
}
if (-not (Test-Path (Join-Path $scriptDir "credentials.json"))) {
    Write-Host "ATENCION: No se encontro credentials.json en $scriptDir" -ForegroundColor Yellow
    Write-Host "Acordate de copiarlo antes de que la tarea se ejecute." -ForegroundColor Yellow
    Write-Host ""
}

# Verificar que Node.js esta instalado
try {
    $nodeVer = (node --version 2>&1)
    Write-Host "Node.js encontrado: $nodeVer" -ForegroundColor Green
} catch {
    Write-Host "ERROR: Node.js no esta instalado. Instalalo desde https://nodejs.org (version LTS)." -ForegroundColor Red
    Read-Host "Presiona Enter para salir"
    exit 1
}

# Instalar dependencias si no estan
$nodeModules = Join-Path $scriptDir "node_modules"
if (-not (Test-Path $nodeModules)) {
    Write-Host "Instalando dependencias (npm install)..." -ForegroundColor Yellow
    Push-Location $scriptDir
    npm install
    Pop-Location
    Write-Host "Dependencias instaladas." -ForegroundColor Green
} else {
    Write-Host "Dependencias ya instaladas." -ForegroundColor Green
}

# Eliminar tarea anterior si existe
$existingTask = Get-ScheduledTask -TaskName $taskName -ErrorAction SilentlyContinue
if ($existingTask) {
    Unregister-ScheduledTask -TaskName $taskName -Confirm:$false
    Write-Host "Tarea anterior eliminada." -ForegroundColor Yellow
}

# Crear la tarea programada
# Corre cada lunes a las 8:00 AM
$action  = New-ScheduledTaskAction -Execute "cmd.exe" -Argument "/c `"$batPath`""
$trigger = New-ScheduledTaskTrigger -Weekly -DaysOfWeek Monday -At "08:00"
$settings = New-ScheduledTaskSettingsSet -StartWhenAvailable -RunOnlyIfNetworkAvailable

Register-ScheduledTask `
    -TaskName $taskName `
    -Action $action `
    -Trigger $trigger `
    -Settings $settings `
    -Description "Genera el informe semanal del salon de eventos todos los lunes a las 8am." `
    -RunLevel Highest | Out-Null

Write-Host ""
Write-Host "Tarea programada creada exitosamente." -ForegroundColor Green
Write-Host "  Nombre:   $taskName" -ForegroundColor White
Write-Host "  Horario:  Lunes a las 8:00 AM" -ForegroundColor White
Write-Host "  Script:   $batPath" -ForegroundColor White
Write-Host ""

# Ofrecer ejecucion de prueba
$resp = Read-Host "Ejecutar el informe AHORA para probar? (S/N)"
if ($resp -match "^[Ss]") {
    Write-Host ""
    Write-Host "Ejecutando informe de prueba..." -ForegroundColor Cyan
    Push-Location $scriptDir
    node generate-report.js
    Pop-Location
    Write-Host ""
}

Write-Host "Listo. El informe se generara automaticamente cada lunes a las 8am." -ForegroundColor Green
Write-Host "Los archivos quedan en la carpeta configurada en config.json." -ForegroundColor White
Write-Host ""
Read-Host "Presiona Enter para cerrar"
