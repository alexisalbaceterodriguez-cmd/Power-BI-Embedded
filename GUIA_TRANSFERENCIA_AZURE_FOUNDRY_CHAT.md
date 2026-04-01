# Guia de transferencia: POC Power BI Embed + Chat con Azure AI Foundry

Este documento resume exactamente lo que se hizo para que la POC terminara funcionando en un entorno Node.js + Express + HTML simple.

Objetivo final logrado:
- Embebido de informe Power BI funcionando.
- Chat simple funcionando contra Agent Application publicado en Azure AI Foundry.
- Arquitectura minima: backend proxy + frontend HTML, sin exponer secretos al navegador.

---

## 1) Contexto de partida

Se partia de una POC minima con:
- Backend Node + Express.
- Frontend HTML servido por el backend.
- Endpoint para embed de Power BI.

Se agrego un chat nuevo sin romper el embed existente.

---

## 2) Leccion critica que desbloqueo todo

El Agent Application publicado en Azure AI Foundry (endpoint services.ai.azure.com) devolvia 401 con token AAD generado para el recurso equivocado.

Resultado correcto:
- Para este tipo de endpoint, el token AAD debe pedirse con scope:
  https://ai.azure.com/.default

Resultado incorrecto (causaba 401):
- https://cognitiveservices.azure.com/.default

Esta fue la causa principal del fallo.

---

## 3) Variables de entorno necesarias

Agregar estas variables en el archivo de entorno local (no versionar secretos):

TENANT_ID=<tu-tenant-id>
CLIENT_ID=<tu-client-id>
CLIENT_SECRET=<tu-client-secret>
WORKSPACE_ID=<workspace-powerbi>
REPORT_ID=<report-powerbi>
DATASET_ID=<dataset-powerbi>
FOUNDRY_ACTIVITY_ENDPOINT=https://.../protocols/activityprotocol?api-version=2025-11-15-preview
FOUNDRY_RESPONSES_ENDPOINT=https://.../protocols/openai/responses?api-version=2025-11-15-preview
PORT=3000

Nota:
- En esta iteracion solo se usa el endpoint de responses para chat stateless.
- El endpoint activityprotocol se deja preparado para futuras mejoras.

---

## 4) Backend: cambios exactos

### 4.1 Activar JSON en Express

En la configuracion de Express se agrego:

app.use(express.json());

### 4.2 Mantener token para Power BI

Se dejo la funcion de token AAD para Power BI como estaba, con scope:
- https://analysis.windows.net/powerbi/api/.default

### 4.3 Crear funcion de token para Foundry

Funcion separada para el chat, usando scope correcto:

async function getFoundryAccessToken() {
  const tokenUrl = `https://login.microsoftonline.com/${process.env.TENANT_ID}/oauth2/v2.0/token`;
  const params = new URLSearchParams({
    grant_type: "client_credentials",
    client_id: process.env.CLIENT_ID,
    client_secret: process.env.CLIENT_SECRET,
    scope: "https://ai.azure.com/.default"
  });

  const response = await fetch(tokenUrl, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: params
  });

  const data = await response.json();
  return data.access_token;
}

### 4.4 Crear endpoint de chat minimo

Se agrego un endpoint POST /api/chat que:
1) Recibe message.
2) Pide token AAD para Foundry.
3) Llama al endpoint responses.
4) Extrae texto de respuesta y lo devuelve.

Implementacion usada:

app.post("/api/chat", async (req, res) => {
  try {
    const token = await getFoundryAccessToken();
    const response = await fetch(process.env.FOUNDRY_RESPONSES_ENDPOINT, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        input: req.body.message
      })
    });

    const raw = await response.text();
    const data = raw ? JSON.parse(raw) : {};

    const messageItem = Array.isArray(data.output)
      ? data.output.find((item) => item.type === "message")
      : null;

    const messageText =
      messageItem &&
      Array.isArray(messageItem.content) &&
      messageItem.content[0] &&
      messageItem.content[0].text;

    const text = data.output_text || messageText || raw;

    res.json({ text });
  } catch {
    res.json({ text: "" });
  }
});

---

## 5) Frontend: cambios exactos

Se mantuvo el embed y se agrego un chat simple debajo:
- Contenedor de mensajes.
- Input de texto.
- Boton Enviar.

Logica:
1) Mostrar mensaje del usuario.
2) POST a /api/chat.
3) Pintar respuesta del agente.

Codigo usado:

async function sendMessage() {
  const input = document.getElementById("messageInput");
  const messages = document.getElementById("messages");
  const message = input.value.trim();
  if (!message) return;

  messages.innerHTML += `<div><b>Tú:</b> ${message}</div>`;
  input.value = "";

  const response = await fetch("/api/chat", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ message })
  });

  const data = await response.json();
  messages.innerHTML += `<div><b>Agente:</b> ${data.text || ""}</div>`;
  messages.scrollTop = messages.scrollHeight;
}

---

## 6) Errores reales encontrados y como se resolvieron

### Error A: conexion cerrada al llamar /api/chat
Sintoma:
- El backend se caia con Unexpected end of JSON input.

Causa:
- Se estaba usando response.json() y Foundry podia devolver body vacio o formato no esperado en ese intento.

Solucion:
- Cambiar a response.text() y parsear de forma segura.

### Error B: 401 Unauthorized en llamada directa a Foundry
Sintoma:
- Endpoint responses devolvia 401.

Causa:
- Scope AAD equivocado.

Solucion:
- Cambiar scope a https://ai.azure.com/.default para Agent Application endpoint en services.ai.azure.com.

### Error C: EADDRINUSE en puerto 3000
Sintoma:
- Al arrancar servidor aparecia puerto ocupado.

Solucion:
- Detener proceso previo y reiniciar.

---

## 7) Pruebas de verificacion que se ejecutaron

1. Verificar embed:
- GET /api/embed-config devolvio reportId, embedUrl y embedToken.

2. Verificar chat:
- POST /api/chat con mensaje de prueba devolvio texto no vacio.

Ejemplo de respuesta final valida obtenida:
- text: Integración validada correctamente y lista para su uso...

---

## 8) Secuencia recomendada para reproducir en otro entorno

1. Configurar variables de entorno completas.
2. Confirmar permisos del service principal sobre:
   - Workspace Power BI.
   - Agent Application en Foundry (Azure AI User al menos para invocacion).
3. Implementar backend con dos funciones de token separadas:
   - Power BI scope.
   - Foundry scope ai.azure.com.
4. Implementar /api/chat contra endpoint responses.
5. Extraer texto desde output_text o desde output[type=message].content[0].text.
6. Validar primero por API (curl/Postman) y luego por UI.

---

## 9) Recomendaciones operativas

- Rotar el client secret despues de pruebas compartidas por chat.
- No exponer secretos ni tokens en frontend.
- Si luego se necesita contexto conversacional persistente, extender con Activity Protocol y manejo de conversation/thread id.

---

## 10) Resumen corto para otra IA

Si no funciona el agente publicado en services.ai.azure.com:
1) Revisa el scope del token: debe ser https://ai.azure.com/.default.
2) Llama al endpoint protocols/openai/responses con input simple.
3) No asumas schema fijo, parsea output_text y fallback a output message content.
4) Evita caida por JSON vacio leyendo response.text() y parseando de forma segura.
