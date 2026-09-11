# Resumen del Salón — instalación en la PC de escritorio

Genera un archivo **`Resumen del Salon.html`** en el escritorio, con cuatro bloques:
resumen del mes, rentabilidad por evento, en qué se va la plata, y quién debe plata.

El archivo se abre con doble click. No necesita internet para abrirse: los datos
quedan guardados adentro del propio archivo. Internet hace falta solo cuando se
actualiza.

---

## Qué copiar a la PC

Copiá la carpeta `dashboard` completa a un lugar fijo de la PC. Recomendado:

```
C:\ResumenSalon\
```

No la dejes en el escritorio ni en Descargas: si alguien la mueve o la borra,
la actualización automática deja de funcionar.

Archivos que tienen que estar:

| Archivo | Para qué |
|---|---|
| `actualizar-resumen.ps1` | el script que baja los datos y arma el HTML |
| `plantilla.html` | el diseño del resumen |
| `Actualizar resumen.bat` | para actualizar a mano cuando se quiera |
| `config.json` | la configuración — **hay que crearlo, ver abajo** |

---

## Paso 1 — Crear el `config.json`

Copiá `config.json.example` y renombralo a `config.json`. Abrilo con el Bloc de
notas y completá la contraseña:

```json
{
  "url": "https://salon-eventos.onrender.com",
  "usuario": "superadmin",
  "password": "LA-CONTRASENA-DE-SUPERADMIN",
  "destino": "",
  "abrirAlTerminar": false
}
```

- **`destino`** vacío = lo guarda en el escritorio del usuario de esa PC.
  Si querés otra ubicación, poné la ruta completa, con doble barra invertida:
  `"C:\\ResumenSalon\\Resumen del Salon.html"`
- **`abrirAlTerminar`**: poné `true` si querés que el resumen se abra solo
  apenas termina de actualizarse.

> **Este archivo tiene la contraseña de superadmin en texto plano.** Está
> asumido que esa PC es de uso personal de Fabio. Si en algún momento la usa
> otra persona, conviene sacarlo de ahí. Por eso `config.json` está en el
> `.gitignore` del proyecto: nunca se sube al repositorio.

---

## Paso 2 — Probar a mano

Doble click en **`Actualizar resumen.bat`**.

Se abre una ventana negra con el progreso. Si todo sale bien, termina con
`Listo. Resumen actualizado en: ...` y aparece el archivo en el escritorio.

**La primera vez puede tardar hasta un minuto.** El servidor del CRM está en un
plan gratuito que se "duerme" cuando nadie lo usa, y tarda en despertar. El
script espera y reintenta hasta 4 veces; no hay que hacer nada.

Si falla, la ventana queda abierta con el motivo, y además queda escrito en
`ultima-ejecucion.log`, al lado del script.

---

## Paso 3 — Programar los lunes a la mañana

Abrí **PowerShell como administrador** y pegá esto, ajustando la ruta si la
carpeta no está en `C:\ResumenSalon`:

```powershell
$carpeta = "C:\ResumenSalon"

$accion = New-ScheduledTaskAction -Execute "powershell.exe" `
  -Argument "-NoProfile -WindowStyle Hidden -ExecutionPolicy Bypass -File `"$carpeta\actualizar-resumen.ps1`"" `
  -WorkingDirectory $carpeta

$disparador = New-ScheduledTaskTrigger -Weekly -DaysOfWeek Monday -At 8:00am

$opciones = New-ScheduledTaskSettingsSet `
  -StartWhenAvailable `
  -RunOnlyIfNetworkAvailable `
  -ExecutionTimeLimit (New-TimeSpan -Minutes 15)

Register-ScheduledTask -TaskName "Resumen del Salon" `
  -Action $accion -Trigger $disparador -Settings $opciones `
  -Description "Actualiza el resumen economico del salon en el escritorio."
```

`-StartWhenAvailable` es importante: si la PC estaba apagada el lunes a las 8,
la tarea corre igual la próxima vez que se prenda.

Para comprobar que quedó bien, sin esperar al lunes:

```powershell
Start-ScheduledTask -TaskName "Resumen del Salon"
```

---

## Cambiar la frecuencia

Todo se maneja desde **Programador de tareas** (buscalo en el menú Inicio) →
`Biblioteca del Programador de tareas` → **Resumen del Salon** → *Propiedades*
→ pestaña *Desencadenadores*.

Para pasarlo a **una vez por mes**, borrá el disparador semanal y creá uno nuevo
de tipo *Mensual*, día 1, a las 8:00.

Desde PowerShell, el equivalente es:

```powershell
# pasar a mensual (dia 1 de cada mes)
$t = New-ScheduledTaskTrigger -Weekly -DaysOfWeek Monday -At 8:00am   # <- reemplazar
Set-ScheduledTask -TaskName "Resumen del Salon" -Trigger $t
```

> Windows no tiene un disparador mensual nativo en PowerShell. Para mensual
> conviene usar la interfaz gráfica del Programador de tareas — son tres clicks
> y no se rompe nada.

---

## Acceso directo en el escritorio

Para que Fabio pueda actualizar en el momento sin buscar la carpeta:

1. Click derecho en `Actualizar resumen.bat` → **Mostrar más opciones** →
   *Enviar a* → *Escritorio (crear acceso directo)*
2. Renombrá el acceso directo a **Actualizar resumen**

---

## Si algo falla

| Síntoma | Qué pasa |
|---|---|
| "Falta el archivo config.json" | No se creó el `config.json`. Ver Paso 1. |
| "No se pudo conectar al CRM" | Sin internet, o el CRM caído. El resumen viejo sigue intacto en el escritorio. |
| "El CRM no devolvio un token" | Usuario o contraseña mal en `config.json`. |
| "respondio sin ningun dato" | Protección a propósito: antes que pisar el resumen con una pantalla vacía, no lo toca. |
| La ventana se cierra sola y no pasa nada | Mirá `ultima-ejecucion.log` en la carpeta del script. |

En todos los casos **el resumen anterior queda intacto**: el archivo nuevo se
escribe primero en un temporal y recién al final reemplaza al viejo.

---

## Nota sobre los números

- **Los montos en dólares no se suman a los pesos.** No hay tipo de cambio
  cargado en el sistema, así que inventar una conversión daría un número falso.
  Los movimientos en USD se muestran aparte, abajo del resumen.
- **El margen por evento es "lo cobrado menos lo gastado hasta hoy"**, no el
  margen final. Un evento que todavía no se terminó de cobrar se ve peor de lo
  que va a terminar siendo.
- **Los cobros sin confirmar no se suman.** Si un empleado carga un cobro, entra
  como pendiente hasta que un admin lo confirma. El resumen avisa cuántos hay.
- **"Quién debe plata"** compara el `montoPresupuesto` del evento contra lo
  cobrado. Si un evento no tiene presupuesto cargado, no aparece en esa lista.
