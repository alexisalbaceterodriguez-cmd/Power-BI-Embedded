# Handoff Easy Auth - Power BI Embedded

Fecha: 2026-04-02

## Estado actual (dejado a peticion del usuario)

- Easy Auth en Azure Web App desactivado para volver al flujo anterior.
- Flujo activo ahora: login por NextAuth en /login + backend con token de aplicacion para Foundry.
- Passthrough de token de usuario desactivado temporalmente en runtime:
  - FOUNDRY_ENABLE_USER_TOKEN_PASSTHROUGH=false

## Recursos objetivo

- Suscripcion: 8055904e-17d9-48aa-b03d-7958fba37af7
- Resource Group: rg-powerbi-embedded-web
- Web App: pbi-embedded-web-sdma
- Tenant: a348b16e-e6ff-4880-b56a-71326827aec5
- App Registration (Easy Auth / login):
  - Nombre: Power BI Embedded App
  - Client ID: f39584f0-25b2-4927-8520-b2e4ddbb333c

## Bloqueo encontrado

- Error de consentimiento de administrador al pedir acceso delegado a Azure AI:
  - AADSTS650057 y luego pantalla de aprobacion de administrador.
- Causa: falta consentimiento admin para el permiso delegado en la app registration.

## Configuracion que ya se preparo

- Auth v2 fue configurado y probado previamente.
- Se dejo documentado el permiso delegado objetivo para Azure AI (user_impersonation) en el recurso:
  - 18a66f5f-dbdf-4c17-9dd7-1634712a9cbe (Azure Machine Learning Services)

## Que debe hacer el siguiente agente (cuando haya admin)

1. Reautenticar con una cuenta administrador del tenant.
2. Conceder consentimiento admin a la app registration:
   - az ad app permission admin-consent --id f39584f0-25b2-4927-8520-b2e4ddbb333c
3. Validar que el login de Easy Auth no muestra pantalla de aprobacion admin:
   - https://pbi-embedded-web-sdma.azurewebsites.net/.auth/login/aad?post_login_redirect_uri=/
4. Reactivar Easy Auth en la Web App:
   - az webapp auth update -g rg-powerbi-embedded-web -n pbi-embedded-web-sdma --enabled true
   - az webapp auth update -g rg-powerbi-embedded-web -n pbi-embedded-web-sdma --set globalValidation.requireAuthentication=true
   - az webapp auth update -g rg-powerbi-embedded-web -n pbi-embedded-web-sdma --unauthenticated-client-action RedirectToLoginPage --redirect-provider AzureActiveDirectory
5. Reactivar passthrough en app settings:
   - az webapp config appsettings set -g rg-powerbi-embedded-web -n pbi-embedded-web-sdma --settings FOUNDRY_ENABLE_USER_TOKEN_PASSTHROUGH=true
6. Verificar headers/token de plataforma:
   - /.auth/me responde con identidad tras login
   - /api/ai-agents/chat recibe contexto de usuario y no falla por permisos
7. Si se mantiene NextAuth junto con Easy Auth, confirmar que las rutas /.auth no son interceptadas por middleware de la app.

## Comprobaciones rapidas utiles

- Estado auth v2:
  - az webapp auth show -g rg-powerbi-embedded-web -n pbi-embedded-web-sdma -o json
- Estado config version:
  - az webapp auth config-version show -g rg-powerbi-embedded-web -n pbi-embedded-web-sdma
- App settings passthrough:
  - az webapp config appsettings list -g rg-powerbi-embedded-web -n pbi-embedded-web-sdma --query "[?name=='FOUNDRY_ENABLE_USER_TOKEN_PASSTHROUGH'].{name:name,value:value}" -o table

## Nota

Mientras no haya consentimiento admin, mantener el modo actual (sin Easy Auth) evita el bloqueo de login y permite seguir operando con el flujo anterior.
