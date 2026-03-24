# 📊 Informe de Entrega: Power BI Embedded Integration

Este documento resume la arquitectura técnica, las decisiones de diseño y las guías de implementación para el proyecto de integración de Power BI en una aplicación web moderna.

---

## 1. El Problema y la Solución Seleccionada

El objetivo era integrar un informe de Power BI en una página web asegurando:
1.  **Seguridad Total:** Los datos no deben ser públicos.
2.  **Interacción de Datos:** Los usuarios deben poder exportar datos desde los visuales.
3.  **Eficiencia en Licencias:** Evitar que cada usuario final necesite una licencia Pro/Premium individual.

**Solución aplicada:** Modelo de autenticación **"App Owns Data"** asistido por una **Capacidad de Power BI Embedded**.

---

## 2. Arquitectura Técnica

Se ha desarrollado una aplicación **Next.js 15** optimizada para el **Edge Runtime** de Cloudflare. Las piezas clave son:

- **Backend (Seguridad):** Una API segura que se comunica con Microsoft Azure AD (Entra ID) mediante un **Service Principal** para generar "Embed Tokens" temporales de un solo uso.
- **Frontend (Visualización):** Un componente de React que utiliza el **Power BI Client SDK** para incrustar el informe en un iframe dinámico con control total sobre los menús, filtros y navegación.
- **Despliegue:** Configurado en **Cloudflare Pages** para garantizar latencia mínima en cualquier parte del mundo.

---

## 3. Guía para el Cliente (Perfil Desarrollador)

Para integrar este sistema en la web final del cliente, el desarrollador solo necesita tres elementos de este repositorio:

1.  **`README.md`**: Lista las 5 variables de entorno obligatorias necesarias para la conexión.
2.  **`src/services/powerbi.ts`**: El código que gestiona el intercambio de tokens de forma segura.
3.  **`src/components/PowerBIEmbed.tsx`**: El componente React "pintar" el informe en pantalla.

---

## 4. Preguntas y Respuestas (FAQ para Clientes)

- **¿Es seguro?**: Sí, las credenciales (Azure Client Secret) se quedan en el servidor. El usuario solo ve un token temporal de 60 minutos.
- **¿Qué necesito de Azure?**: Un "Client ID" y un "Client Secret" de una App Registration con permisos en el Workspace de Power BI.
- **¿El diseño es fijo?**: No, mediante CSS (archivo `globals.css`) se ha configurado un diseño "full-screen" que permite que el reporte parezca una funcionalidad nativa del portal del cliente.
- **¿Puedo filtrar datos por usuario (RLS)?**: Sí, la arquitectura soporta pasar la identidad del usuario durante la petición del token para que los datos aparezcan ya filtrados.

---

**Informe generado el:** 20 de marzo de 2026
**Tecnologías:** Next.js 15, Cloudflare Pages, Power BI Embedded SDK, Azure Entra ID.
