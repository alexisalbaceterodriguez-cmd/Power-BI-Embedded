# Foundry Python Invocation Script

This project now includes a Python script to invoke your Azure AI Foundry agent.

## Files

- `scripts/invoke_foundry_agent.py`
- `requirements-foundry.txt`

## Install dependencies

```powershell
npm run foundry:py:install
```

## Invoke with current `.env.local`

```powershell
npm run foundry:py:invoke
```

When `AZURE_FOUNDRY_RESPONSES_ENDPOINT` is present, the script uses the published
Responses endpoint mode automatically.

## Invoke directly with published endpoint

```powershell
python scripts/invoke_foundry_agent.py --responses-endpoint "https://.../protocols/openai/responses?api-version=2025-11-15-preview" --message "Tell me what you can help with."
```

## Invoke with custom prompt

```powershell
python scripts/invoke_foundry_agent.py --env-file .env.local --message "Resume what you can do"
```

## Verbose mode

```powershell
npm run foundry:py:invoke:verbose
```

## Supported environment variables

- `AZURE_EXISTING_AIPROJECT_ENDPOINT`
- `AZURE_EXISTING_AGENT_ID` (format: `agentName:version`)
- `AZURE_FOUNDRY_RESPONSES_ENDPOINT` (published app endpoint)

Optional alternatives:

- `AZURE_FOUNDRY_AGENT_NAME`
- `AZURE_FOUNDRY_AGENT_VERSION`
- `AZURE_AI_PROJECT_ENDPOINT`

Authentication variables (service principal):

- `AZURE_TENANT_ID` or `TENANT_ID`
- `AZURE_CLIENT_ID` or `CLIENT_ID`
- `AZURE_CLIENT_SECRET` or `CLIENT_SECRET`

Optional auth mode override:

- `FOUNDRY_AUTH_MODE=azure-cli` to force user-delegated token from local `az login`
	instead of service principal environment credentials.

If service principal vars are not available, script falls back to `DefaultAzureCredential` (for example, `az login`).
