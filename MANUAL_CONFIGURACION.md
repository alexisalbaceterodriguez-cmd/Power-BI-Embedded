# Manual de Configuración: Usuarios, Informes y Row-Level Security (RLS)

Este proyecto está diseñado para funcionar **sin necesidad de una base de datos externa**. Toda la configuración de clientes, informes a los que tienen acceso, y políticas de seguridad (RLS) se define en un único lugar: el archivo `src/config/users.config.ts`.

---

## 🔒 1. Cómo añadir un Nuevo Usuario

Para añadir un usuario que pueda iniciar sesión en la plataforma, debes editar el array `USERS` en el archivo `src/config/users.config.ts`.

### Pasos:

1. **Generar la contraseña encriptada (Hash):**
   Por seguridad, las contraseñas no se guardan en texto plano. Se usa el algoritmo `bcrypt`. 
   Para generar el hash de una nueva contraseña, abre una terminal cualquiera con Node.js instalado y ejecuta:
   ```bash
   node -e "console.log(require('bcryptjs').hashSync('LA_CONTRASENA_AQUI', 10))"
   ```
   Copia el resultado (empezará por `$2b$10$...`).

2. **Añadir el objeto al array `USERS`:**
   Abre `src/config/users.config.ts` y añade una entrada como esta al array `USERS`:

   ```typescript
   {
     id: '3', // Un ID único (puede ser numérico o texto corto)
     username: 'cliente_nuevo', // Nombre que usará para hacer login
     passwordHash: '$2b$10$TU_HASH_PEGADO_AQUI...', // El hash que generaste en el paso 1
     role: 'client', // 'client' (cliente normal) o 'admin' (superusuario)
     reportIds: ['report-ventas-2026', 'report-marketing-2026'], // IDs de los informes que este usuario puede ver
   }
   ```

> **💡 Sobre el Rol `admin`:** Si cambias `role` a `'admin'` y pones `reportIds: ['*']`, ese usuario tendrá acceso automáticamente a **todos** los informes definidos, y **se ignorarán las reglas RLS** (verá los datos completos de todos los clientes sin filtros).

---

## 📊 2. Cómo añadir un Nuevo Informe de Power BI

Cuando publicas un informe en el Servicio de Power BI y quieres que aparezca en esta plataforma, debes registrarlo en el array `REPORTS` dentro de `src/config/users.config.ts`.

### Pasos:

1. **Obtener los IDs de Power BI:**
   Ve a la web de Power BI, entra a tu Área de Trabajo (Workspace) y luego abre el Informe. Fíjate en la URL de tu navegador:
   `https://app.powerbi.com/groups/TU_WORKSPACE_ID_AQUI/reports/TU_REPORT_ID_AQUI/ReportSection`

2. **Añadir el objeto al array `REPORTS`:**

   ```typescript
   {
     id: 'report-ventas-2026', // ID interno para usar en la lista de reportIds de los usuarios
     displayName: 'Ventas Globales 2026', // Nombre bonito que aparecerá en el menú lateral amarillo de la web
     workspaceId: 'TU_WORKSPACE_ID_AQUI', // El GUID largo sacado de la URL
     reportId: 'TU_REPORT_ID_AQUI', // El GUID largo sacado de la URL
   }
   ```

3. **Asignarlo al usuario:**
   Asegúrate de que el `id` interno que definiste arriba (`report-ventas-2026`) esté incluido en el array `reportIds` de los usuarios que quieras que puedan hacer click en él.

---

## 🛡️ 3. Cómo configurar RLS (Row-Level Security)

La **RLS** permite que un único informe de Power BI filtre los datos dinámicamente dependiendo de quién lo está mirando.

### Requisitos Previos en Power BI Desktop:
1. En Power BI Desktop, debes crear un **Rol** (por ejemplo, "Vendedor" o "Empresa").
2. En las reglas DAX de ese rol, debes usar la función `USERPRINCIPALNAME()` para filtrar la tabla. (Ejemplo: `[Email_Cliente] = USERPRINCIPALNAME()`).
3. Publica el informe al Servicio de Power BI.

### Cómo vincular el RLS en el código:

En el array `REPORTS`, al configurar el informe, añade dos propiedades opcionales: `rlsUsername` y `rlsRoles`.

```typescript
{
  id: 'report-acme-ventas',
  displayName: 'ACME Corp - Ventas',
  workspaceId: 'xxxx-xxxx-xxxx',
  reportId: 'yyyy-yyyy-yyyy',
  
  // CONFIGURACIÓN RLS:
  rlsUsername: 'acme@empresa.com', // El valor exacto que pasará al DAX USERPRINCIPALNAME()
  rlsRoles: ['Empresa'], // El nombre exacto del Rol que creaste en PBI Desktop
}
```

**¿Cómo funciona esto internamente?**
- Si el usuario que entra hace login como `cliente_acme` (cuyo rol es `client`), el backend generará un Embed Token seguro en Microsoft Azure pasándole a Power BI explícitamente la orden: *"Genera el token bajo la identidad de acme@empresa.com usando el rol Empresa"*.
- Si el usuario que hace login tiene el rol `admin`, la plataforma **ignorará** la configuración RLS y pedirá el token sin filtros, viendo la información de `acme@empresa.com` y la de todos los demás.

---

## 📝 Resumen del Flujo de Trabajo

1. **Publicas** el informe desde PBI Desktop (con roles si quieres RLS).
2. **Copias** de la URL el WorkspaceID y el ReportID.
3. Vas a `users.config.ts`.
4. Añades un bloque nuevo en `REPORTS` con esos IDs (y añades `rlsUsername/rlsRoles` si filtra por usuario).
5. En ese mismo archivo, buscas al usuario en `USERS` y le añades el `id` que le pusiste al informe a su lista `reportIds`.
6. ¡Listo! Al refrescar la web el usuario verá su nuevo menú en la barra lateral.
