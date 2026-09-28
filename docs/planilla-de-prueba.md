# Planilla de prueba

Todo cambio que toque cómo se guardan los datos se prueba primero en la copia
**"CRM PRUEBA - no usar"**, nunca en la planilla real.

| Dónde corre el CRM | Planilla que usa |
|---|---|
| Render (producción) | Real — `1ijCN27RaLLYUG0a6hEYwwC9rQJKrYV_KdsBEGAHULgY` |
| Esta PC (`npm start` / `start.bat`) | Prueba — `1gr_NRmfgbfgjOTQ8CqHPaoPtbGmEqC6TIvpXc5et20E` |

- El id se define en `SPREADSHEET_ID` de `backend/.env` (no se sube a Git).
- Seguro: fuera de Render, si `SPREADSHEET_ID` es el de la real, el servidor no
  arranca (`backend/server.js`, arriba de todo).
- La llave de Google para correr local va en `backend/credentials.json` (no se
  sube a Git): es el mismo contenido que `GOOGLE_CREDENTIALS_JSON` en Render. La
  copia tiene que estar compartida como Editor con la cuenta de servicio
  (la dirección que termina en `.iam.gserviceaccount.com`).
- La copia se puede tirar y rehacer cuando se quiera (Archivo → Hacer una copia
  de la real, "Compartir con las mismas personas") y actualizar el id acá y en `.env`.
