# Entrega tecnica (version endurecida)

## Objetivo
Portal de Power BI Embedded multi-workspace con seguridad reforzada y escalabilidad operativa para Azure App Service.

## Cambios implementados
- Migracion de identidad/autorizacion a BD SQLite + DAL server-only.
- Panel admin basico (`/admin`) para altas de usuarios/reportes.
- Login Microsoft-only con mapeo de usuario por email/claims Entra ID.
- Eliminado el flujo de password local en runtime y panel de alta de usuarios.
- API `/api/get-embed-token` con autorizacion centralizada y errores sanitizados.
- RLS estricto (sin fallback permisivo).
- Migracion Next.js `middleware.ts` -> `proxy.ts`.
- Cabeceras de seguridad globales (CSP, HSTS, Referrer-Policy, etc.).

## Pendientes operativos (fuera de codigo)
- Rotacion completa de secretos historicos.
- Mover secretos a Azure Key Vault con Managed Identity.
- Alta de monitorizacion/alertas sobre `audit_log` y App Insights.
