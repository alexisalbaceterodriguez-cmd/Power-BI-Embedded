# Power BI Embedded Next.js Viewer

This is a modern Next.js 15 application designed to securely embed Power BI reports using the **App Owns Data** strategy. It features a dual authentication system: local credentials for quick access and **Microsoft Entra ID (Azure AD)** for enterprise-grade security and B2B guest support.

## Features

- **Next.js 15 App Router**: Clean architecture supporting static rendering and Middleware protection.
- **Dual Authentication**: 
  - **Microsoft Entra ID**: Native integration for corporate accounts and invited guests.
  - **Credentials Flow**: Local user mapping for non-Azure users.
- **Strict Security Mapping**: Only users explicitly defined in `src/config/users.config.ts` can access the platform, even when using Microsoft login.
- **Edge Compatible API**: The `/api/get-embed-token` route is decoupled from heavyweight Node.js libraries, ensuring 100% compatibility with **Cloudflare Pages** and Vercel Edge.
- **Power BI Client React**: Seamless UI lifecycle integration with automatic token retrieval.
- **Premium Corporate UI**: Dark-themed, responsive interface tailored for Seidor corporate identity.

---

## 🚀 Setup Instructions

### 1. Azure Active Directory (Entra ID) Requirements
You must prepare an **App Registration** and grant it access to your Power BI Workspace:

1. Portal de Azure -> **App Registrations** -> **New registration**.
2. **Redirect URI**: Add `http://localhost:3000/api/auth/callback/microsoft-entra-id` (for local testing) and your production URL.
3. Copy **Application (client) ID** and **Directory (tenant) ID**.
4. Create a **Client Secret** and copy its value.
5. **Power BI Setup**: Enable *Allow service principals to use Power BI APIs* in the Admin Portal and add the App as **Member/Admin** in your Workspace.

### 2. Local Environment Variables
Create a `.env.local` file based on `.env.local.example`:

```env
TENANT_ID="your_tenant_id"
CLIENT_ID="your_client_id"
CLIENT_SECRET="your_client_secret"
WORKSPACE_ID="your_workspace_id"
REPORT_ID="your_report_id"

# NextAuth Configuration
NEXTAUTH_SECRET="random_32_char_string"
NEXTAUTH_URL="http://localhost:3000"

# Microsoft Entra ID variables (reuse the same client/tenant IDs)
AUTH_MICROSOFT_ENTRA_ID_ID="your_client_id"
AUTH_MICROSOFT_ENTRA_ID_SECRET="your_client_secret"
AUTH_MICROSOFT_ENTRA_ID_ISSUER="https://login.microsoftonline.com/your_tenant_id/v2.0"
```

### 3. Running Locally
```bash
npm run dev
```

---

## 📖 Documentation
Detailed configuration for Users, Reports, and RLS can be found in [MANUAL_CONFIGURACION.md](file:///c:/Users/alexi/Desktop/Proyectos/Power%20BI%20Embedded/MANUAL_CONFIGURACION.md).
