# Power BI Embedded Next.js Viewer

This is a modern Next.js 15 application designed to securely embed a Power BI report using the **App Owns Data** authentication strategy (Service Principal). It acts as a full-screen, native-feeling portal for your visualizations while keeping all Azure AD credentials strictly server-side.

## Features

- **Next.js 15 App Router**: Clean architecture supporting static rendering.
- **Edge Compatible API**: The `/api/get-embed-token` route is completely decoupled from heavyweight Node.js libraries, relying entirely on native `fetch` over OAuth 2.0. This guarantees 100% compatibility with **Cloudflare Pages** and Vercel Edge.
- **Power BI Client React**: Seamless UI lifecycle integration with automatic token retrieval and loading states.
- **Full Screen Native Theme**: The frontend utilizes pure CSS (`globals.css`) mapped strictly to `100vw`/`100vh` to seamlessly blend the iframe as a standalone web app.

---

## 🚀 Setup Instructions

### 1. Azure Active Directory (Entra ID) Requirements
Before deploying, you must prepare a **Service Principal** in Azure and grant it access to your Power BI Workspace:

1. Go to the Azure Portal -> **App Registrations** -> **New registration**.
2. Copy the **Application (client) ID** and the **Directory (tenant) ID**.
3. Go to **Certificates & secrets** and create a New client secret. Copy the **Value** immediately.
4. In your Power BI Admin portal (Tenant Settings), ensure that *Allow service principals to use Power BI APIs* is enabled.
5. In your Power BI Workspace -> **Manage Access** -> Add your App Registration as an **Admin** or **Member**.

### 2. Local Environment Variables
Populate the 5 secrets in the `.env.local` file:

```env
TENANT_ID="your_azure_tenant_id_here"
CLIENT_ID="your_azure_client_id_here"
CLIENT_SECRET="your_azure_client_secret_here"
WORKSPACE_ID="your_power_bi_workspace_id_here"
REPORT_ID="your_power_bi_report_id_here"
```

### 3. Running Locally
Double-click `run_server.bat` on Windows, or execute manually:
```bash
npm run dev
```

---

## ☁️ Cloudflare Pages Deployment Guide

Because the application is optimized for Edge Networks via `wrangler.json`, it deploys flawlessly to Cloudflare Pages:

1. Navigate to **Workers & Pages** in your Cloudflare dashboard.
2. Click **Create** and strictly select the **PAGES** tab (do not use the Workers tab).
3. Connect your GitHub repository.
4. Cloudflare will request your project configuration:
   - **Framework preset**: `Next.js`
   - **Build command**: `npx @cloudflare/next-on-pages@1`
   - **Build output directory**: `.vercel/output/static`
5. Input your 5 Power BI environment variables in the variables section.
6. Click **Save and Deploy**.

*(Note: The required `nodejs_compat` parameter is auto-injected thanks to the `wrangler.json` manifest mapped inside).*
