# Manual Operativo de Usuarios, Permisos y RLS

Este manual explica, paso a paso, como administrar el portal:

1. Crear usuarios.
2. Borrar usuarios.
3. Dar o quitar permisos de informes.
4. Configurar RLS.
5. Resolver incidencias frecuentes.

La fuente de verdad es la base SQLite definida en `APP_DB_PATH` (por defecto `./data/security.db`).

---

## 1) Requisitos previos

1. Arranca la aplicacion:
   - `npm run dev`
2. Entra con un usuario `admin`.
3. Abre el panel de administracion:
   - `http://localhost:3000/admin`

Tablas principales de seguridad:
- `users`
- `reports`
- `user_report_access`
- `user_rls_roles`
- `audit_log`

---

## 2) Crear un usuario (metodo recomendado: panel /admin)

En `/admin`, bloque **Alta de usuario Microsoft**:

1. `username`: nombre de usuario (ej. `cliente_finance`).
2. `email`: correo del usuario (obligatorio si usara Microsoft Entra ID).
3. `role`: `client` o `admin`.
4. No se usa password local. El acceso se valida solo con Microsoft Entra ID.
5. `reportIds (csv)`: IDs internos de informes, separados por coma.
   - Ejemplo: `finance-controlling,informe-webinar`
6. `rlsRoles (csv)`: roles RLS permitidos para ese usuario.
   - Ejemplo: `Empresa 01,Permisos`
7. Pulsa **Crear usuario**.

Comprobacion:
1. Debe aparecer en el bloque **Usuarios**.
2. El usuario ya puede iniciar sesion con Microsoft Entra ID.
3. El usuario puede iniciar sesion si el `email` coincide con sus claims de Entra ID.

---

## 3) Dar permisos a un usuario existente

Actualmente el panel crea usuarios, pero no edita permisos existentes en la UI.  
Para cambios de permisos en usuarios ya creados, usa SQL.

### 3.1 Dar acceso a un informe

```sql
INSERT OR IGNORE INTO user_report_access (user_id, report_id, created_at)
VALUES ('ID_USUARIO', 'ID_REPORTE', datetime('now'));
```

### 3.2 Quitar acceso a un informe

```sql
DELETE FROM user_report_access
WHERE user_id = 'ID_USUARIO' AND report_id = 'ID_REPORTE';
```

### 3.3 Ver permisos actuales

```sql
SELECT u.username, ura.report_id
FROM user_report_access ura
JOIN users u ON u.id = ura.user_id
ORDER BY u.username, ura.report_id;
```

---

## 4) Configurar RLS por usuario

Regla actual del sistema:
- Si el informe tiene RLS, el usuario debe tener interseccion entre sus roles y los del informe.
- Si no hay interseccion, devuelve `403`.

### 4.1 Asignar roles RLS al usuario

```sql
INSERT OR IGNORE INTO user_rls_roles (user_id, role_name, created_at)
VALUES ('ID_USUARIO', 'Empresa 01', datetime('now'));
```

### 4.2 Quitar un rol RLS al usuario

```sql
DELETE FROM user_rls_roles
WHERE user_id = 'ID_USUARIO' AND role_name = 'Empresa 01';
```

### 4.3 Ver roles RLS actuales por usuario

```sql
SELECT u.username, urr.role_name
FROM user_rls_roles urr
JOIN users u ON u.id = urr.user_id
ORDER BY u.username, urr.role_name;
```

---

## 5) Borrar un usuario

Al borrar en `users`, se eliminan automaticamente permisos y roles RLS asociados por `ON DELETE CASCADE`.

```sql
DELETE FROM users
WHERE id = 'ID_USUARIO';
```

Recomendacion: nunca borres el unico admin.

Consulta previa sugerida:

```sql
SELECT id, username, email, role, is_active
FROM users
ORDER BY username;
```

---

## 6) Crear o borrar informes

### 6.1 Crear informe (UI)

En `/admin`, bloque **Alta de reporte**:
1. `id`: identificador interno (ej. `informe-webinar`).
2. `displayName`: nombre visible.
3. `workspaceId`: GUID del workspace Power BI.
4. `reportId`: GUID del informe Power BI.
5. `rlsRoles (csv)`: roles permitidos en ese informe.
6. `adminRlsRoles (csv)` y `adminRlsUsername` (opcionales).
7. Pulsa **Crear reporte**.

### 6.2 Borrar informe (SQL)

```sql
DELETE FROM reports
WHERE id = 'ID_REPORTE';
```

Esto elimina tambien accesos asociados en `user_report_access`.

---

## 7) Gestion de cuentas Microsoft Entra ID

Para login Microsoft, el usuario de BD debe tener `email` que coincida con alguno de estos claims de Entra:
- `email`
- `preferred_username`
- `upn`
- `unique_name`

Si un usuario Microsoft recibe `AccessDenied`:
1. Comprueba que existe en `users`.
2. Comprueba que `email` en BD coincide exactamente con su cuenta Entra.
3. Verifica que `is_active = 1`.

---

## 8) Operativa recomendada (flujo diario)

1. Crear informe nuevo (si aplica).
2. Crear usuario.
3. Asignar `reportIds`.
4. Asignar `rlsRoles`.
5. Probar login con ese usuario.
6. Revisar `audit_log` si hay incidencias.

---

## 9) Troubleshooting rapido

### 9.1 `Forbidden` al cargar informe
- El usuario no tiene permiso en `user_report_access`, o
- No tiene interseccion de `rlsRoles` con el informe.

### 9.2 Usuario entra pero no ve informes
- No tiene filas en `user_report_access`, o
- Los informes estan inactivos.

### 9.3 Login Microsoft no deja cambiar cuenta
- El sistema ya fuerza selector de cuenta (`prompt=select_account`).
- Si persiste, cerrar sesion de Microsoft en el navegador y reintentar.

---

## 10) Seguridad minima obligatoria

1. Rotar secretos expuestos y no compartir `.env.local`.
2. Cambiar `NEXTAUTH_SECRET` por uno robusto.
3. En Azure: usar Key Vault + Managed Identity.
4. Mantener Microsoft Entra como login principal.
5. Revisar `audit_log` periodicamente.
