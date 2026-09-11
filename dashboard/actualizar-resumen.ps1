# =============================================================================
#  Salon Joliet - Generador del resumen de escritorio
# =============================================================================
#  Baja los datos del CRM y escribe un unico archivo HTML autocontenido en el
#  escritorio. No necesita Node ni ninguna instalacion: PowerShell ya viene con
#  Windows. El HTML resultante abre con doble click y funciona sin internet,
#  porque los datos quedan incrustados adentro del propio archivo.
#
#  Configuracion: config.json, al lado de este script.
#  Uso manual:    click derecho -> "Ejecutar con PowerShell"
#  Automatico:    ver INSTALAR.md (Tarea Programada de Windows)
# =============================================================================

$ErrorActionPreference = 'Stop'
[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12

$base    = Split-Path -Parent $MyInvocation.MyCommand.Path
$logPath = Join-Path $base 'ultima-ejecucion.log'

function Escribir($msg) {
    $linea = "[{0}] {1}" -f (Get-Date -Format 'yyyy-MM-dd HH:mm:ss'), $msg
    Write-Host $linea
    Add-Content -Path $logPath -Value $linea -Encoding utf8
}

try {
    Set-Content -Path $logPath -Value '' -Encoding utf8
    Escribir 'Iniciando actualizacion del resumen.'

    # ---- Configuracion ------------------------------------------------------
    $cfgPath = Join-Path $base 'config.json'
    if (-not (Test-Path $cfgPath)) {
        throw "Falta el archivo config.json. Copia config.json.example a config.json y completalo."
    }
    $cfg = Get-Content $cfgPath -Raw -Encoding utf8 | ConvertFrom-Json

    $destino = $cfg.destino
    if ([string]::IsNullOrWhiteSpace($destino)) {
        $destino = Join-Path ([Environment]::GetFolderPath('Desktop')) 'Resumen del Salon.html'
    }
    $plantilla = Join-Path $base 'plantilla.html'
    if (-not (Test-Path $plantilla)) { throw "No se encontro plantilla.html en $base" }

    # ---- Login --------------------------------------------------------------
    # Render duerme el servicio gratuito: el primer request puede tardar ~50s.
    # Por eso el timeout largo y los reintentos, en vez de fallar de una.
    $login = @{ usuario = $cfg.usuario; password = $cfg.password } | ConvertTo-Json -Compress
    $token = $null
    for ($i = 1; $i -le 4; $i++) {
        try {
            Escribir "Conectando al CRM (intento $i de 4). Puede tardar hasta un minuto..."
            $r = Invoke-RestMethod -Uri "$($cfg.url)/api/login" -Method Post `
                                   -Body $login -ContentType 'application/json' -TimeoutSec 120
            $token = $r.token
            break
        } catch {
            if ($i -eq 4) { throw "No se pudo conectar al CRM: $($_.Exception.Message)" }
            Escribir "Sin respuesta todavia, reintentando en 20 segundos..."
            Start-Sleep -Seconds 20
        }
    }
    if (-not $token) { throw 'El CRM no devolvio un token. Revisa usuario y contrasena en config.json.' }
    Escribir 'Sesion iniciada correctamente.'

    # ---- Datos --------------------------------------------------------------
    Escribir 'Descargando datos...'
    $datos = Invoke-RestMethod -Uri "$($cfg.url)/api/dashboard-data" -Method Get `
                               -Headers @{ Authorization = "Bearer $token" } -TimeoutSec 180

    $nCli = @($datos.clientes).Count
    $nIng = @($datos.ingresos).Count
    $nEgr = @($datos.egresos).Count
    Escribir "Recibido: $nCli evento(s), $nIng ingreso(s), $nEgr egreso(s)."

    if ($nCli -eq 0 -and $nIng -eq 0 -and $nEgr -eq 0) {
        throw 'El CRM respondio sin ningun dato. No se sobrescribe el resumen anterior.'
    }

    # ---- Armado del HTML ----------------------------------------------------
    # Depth alto: los objetos anidados se truncan con el valor por defecto (2).
    $json = $datos | ConvertTo-Json -Depth 12 -Compress
    # </script> dentro de una cadena JSON cerraria el bloque antes de tiempo.
    $json = $json -replace '</script', '<\/script'

    $html = Get-Content $plantilla -Raw -Encoding utf8
    $marcaIni = '/*__DATOS__*/'
    $marcaFin = '/*__FIN__*/'
    $ini = $html.IndexOf($marcaIni)
    $fin = $html.IndexOf($marcaFin)
    if ($ini -lt 0 -or $fin -lt 0) { throw 'La plantilla no tiene las marcas /*__DATOS__*/ y /*__FIN__*/.' }

    $html = $html.Substring(0, $ini + $marcaIni.Length) + $json + $html.Substring($fin)

    # Se escribe primero a un temporal: si algo falla a mitad de camino, el
    # resumen viejo del escritorio queda intacto en vez de quedar a medias.
    $tmp = "$destino.tmp"
    $utf8 = New-Object System.Text.UTF8Encoding($false)
    [IO.File]::WriteAllText($tmp, $html, $utf8)
    Move-Item -Path $tmp -Destination $destino -Force

    Escribir "Listo. Resumen actualizado en: $destino"
    if ($cfg.abrirAlTerminar -eq $true) { Start-Process $destino }
    exit 0

} catch {
    Escribir "ERROR: $($_.Exception.Message)"
    # Si se ejecuto a mano, que el error quede visible y no se cierre la ventana.
    if ($Host.Name -eq 'ConsoleHost' -and -not $env:TAREA_PROGRAMADA) {
        Write-Host ''
        Write-Host 'No se pudo actualizar el resumen.' -ForegroundColor Red
        Write-Host 'El resumen anterior sigue estando disponible en el escritorio.'
        Write-Host ''
        Read-Host 'Presiona Enter para cerrar'
    }
    exit 1
}
