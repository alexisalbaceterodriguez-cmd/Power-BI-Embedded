#!/usr/bin/env python3
"""
Invoke an Azure AI Foundry agent from this repository.

Features:
- Reads settings from environment and optionally from .env.local
- Supports your current AZURE_EXISTING_AGENT_ID format (name:version)
- Uses ClientSecretCredential when service principal env vars are present
- Falls back to DefaultAzureCredential otherwise

Usage examples:
  python scripts/invoke_foundry_agent.py --message "Tell me what you can help with."
  python scripts/invoke_foundry_agent.py --message "Resume el informe" --verbose
  python scripts/invoke_foundry_agent.py --agent-name "Fabric-Webinar" --agent-version "1"
"""

from __future__ import annotations

import argparse
import json
import os
import sys
from pathlib import Path
from typing import Dict, Optional, Tuple
from urllib import error as urlerror
from urllib import request as urlrequest

from azure.ai.projects import AIProjectClient
from azure.identity import ClientSecretCredential, DefaultAzureCredential


DEFAULT_MESSAGE = "Tell me what you can help with."


def read_env_text(path: Path) -> str:
    raw = path.read_bytes()
    for encoding in ("utf-8-sig", "utf-16", "utf-16-le", "utf-16-be", "latin-1"):
        try:
            text = raw.decode(encoding)
        except UnicodeDecodeError:
            continue
        if "=" in text:
            return text
    return raw.decode("utf-8", errors="ignore")


def load_env_file(path: Path) -> None:
    """Lightweight .env parser to avoid external dependencies."""
    if not path.exists():
        return

    for raw_line in read_env_text(path).splitlines():
        line = raw_line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue

        key, value = line.split("=", 1)
        key = key.strip()
        value = value.strip()

        if not key:
            continue

        if (value.startswith('"') and value.endswith('"')) or (
            value.startswith("'") and value.endswith("'")
        ):
            value = value[1:-1]

        # Keep explicit non-empty process env values as source of truth.
        if key not in os.environ or not os.environ.get(key, "").strip():
            os.environ[key] = value


def env(*keys: str) -> Optional[str]:
    for key in keys:
        val = os.getenv(key)
        if val is not None and val.strip():
            return val.strip()
    return None


def parse_agent_id(agent_id: str) -> Tuple[str, str]:
    if ":" not in agent_id:
        raise ValueError(
            "AZURE_EXISTING_AGENT_ID must be in 'agentName:version' format."
        )
    name, version = agent_id.split(":", 1)
    name = name.strip()
    version = version.strip()
    if not name or not version:
        raise ValueError(
            "AZURE_EXISTING_AGENT_ID must include both agent name and version."
        )
    return name, version


def resolve_agent(args: argparse.Namespace) -> Tuple[str, str]:
    if args.agent_name and args.agent_version:
        return args.agent_name.strip(), args.agent_version.strip()

    from_env_name = env("AZURE_FOUNDRY_AGENT_NAME", "AZURE_EXISTING_AGENT_NAME")
    from_env_version = env("AZURE_FOUNDRY_AGENT_VERSION", "AZURE_EXISTING_AGENT_VERSION")
    if from_env_name and from_env_version:
        return from_env_name, from_env_version

    existing_agent_id = env("AZURE_EXISTING_AGENT_ID")
    if existing_agent_id:
        return parse_agent_id(existing_agent_id)

    raise ValueError(
        "Agent not configured. Set --agent-name/--agent-version or AZURE_EXISTING_AGENT_ID=name:version."
    )


def resolve_endpoint(args: argparse.Namespace) -> str:
    endpoint = args.endpoint or env(
        "AZURE_EXISTING_AIPROJECT_ENDPOINT",
        "AZURE_AI_PROJECT_ENDPOINT",
        "AZURE_AIPROJECT_ENDPOINT",
    )
    if not endpoint:
        raise ValueError(
            "Project endpoint not configured. Set --endpoint or AZURE_EXISTING_AIPROJECT_ENDPOINT."
        )
    return endpoint


def resolve_responses_endpoint(args: argparse.Namespace) -> Optional[str]:
    return args.responses_endpoint or env(
        "AZURE_FOUNDRY_RESPONSES_ENDPOINT",
        "AZURE_EXISTING_RESPONSES_ENDPOINT",
    )


def build_credential():
    auth_mode = (env("FOUNDRY_AUTH_MODE") or "").lower()
    if auth_mode in {"azure-cli", "azcli"}:
        return DefaultAzureCredential(
            exclude_environment_credential=True,
            exclude_managed_identity_credential=True,
        )

    tenant_id = env("AZURE_TENANT_ID", "TENANT_ID")
    client_id = env("AZURE_CLIENT_ID", "CLIENT_ID")
    client_secret = env("AZURE_CLIENT_SECRET", "CLIENT_SECRET")

    if tenant_id and client_id and client_secret:
        return ClientSecretCredential(
            tenant_id=tenant_id,
            client_id=client_id,
            client_secret=client_secret,
        )

    return DefaultAzureCredential()


def extract_output_text(payload: Dict[str, object]) -> str:
    output_text = payload.get("output_text")
    if isinstance(output_text, str) and output_text.strip():
        return output_text

    output = payload.get("output")
    if isinstance(output, list):
        for item in output:
            if not isinstance(item, dict):
                continue
            content = item.get("content")
            if not isinstance(content, list):
                continue
            for fragment in content:
                if not isinstance(fragment, dict):
                    continue
                text = fragment.get("text")
                if isinstance(text, str) and text.strip():
                    return text

    return ""


def invoke_published_responses_endpoint(
    responses_endpoint: str,
    message: str,
    verbose: bool,
) -> int:
    credential = build_credential()
    token = credential.get_token("https://ai.azure.com/.default").token

    payload = {
        "input": [
            {
                "role": "user",
                "content": message,
            }
        ]
    }

    req = urlrequest.Request(
        responses_endpoint,
        data=json.dumps(payload).encode("utf-8"),
        headers={
            "Authorization": f"Bearer {token}",
            "Content-Type": "application/json",
        },
        method="POST",
    )

    try:
        with urlrequest.urlopen(req, timeout=60) as resp:
            body = resp.read().decode("utf-8", errors="ignore")
    except urlerror.HTTPError as exc:
        detail = exc.read().decode("utf-8", errors="ignore") if exc.fp else ""
        raise RuntimeError(
            f"Published responses endpoint failed ({exc.code}): {detail}"
        ) from exc

    parsed = json.loads(body)
    text = extract_output_text(parsed)
    print(text if text else "(empty output_text)")

    if verbose:
        safe_meta: Dict[str, str] = {
            "mode": "published-responses-endpoint",
            "responsesEndpoint": responses_endpoint,
        }
        print("\n--- debug ---")
        print(json.dumps(safe_meta, indent=2, ensure_ascii=False))

    return 0


def invoke_agent(
    endpoint: str,
    agent_name: str,
    agent_version: str,
    message: str,
    verbose: bool,
) -> int:
    credential = build_credential()

    project_client = AIProjectClient(
        endpoint=endpoint,
        credential=credential,
    )

    openai_client = project_client.get_openai_client()

    response = openai_client.responses.create(
        input=[{"role": "user", "content": message}],
        extra_body={
            "agent_reference": {
                "name": agent_name,
                "version": agent_version,
                "type": "agent_reference",
            }
        },
    )

    output_text = getattr(response, "output_text", None) or ""
    print(output_text if output_text else "(empty output_text)")

    if verbose:
        safe_meta: Dict[str, str] = {
            "endpoint": endpoint,
            "agentName": agent_name,
            "agentVersion": agent_version,
        }
        print("\n--- debug ---")
        print(json.dumps(safe_meta, indent=2, ensure_ascii=False))

    return 0


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Invoke a deployed Azure AI Foundry agent."
    )
    parser.add_argument(
        "--message",
        default=DEFAULT_MESSAGE,
        help="User message to send to the Foundry agent.",
    )
    parser.add_argument(
        "--responses-endpoint",
        default=None,
        help=(
            "Published Foundry Responses endpoint (applications/.../protocols/openai/responses). "
            "If provided, script uses this mode and skips agent_reference mode."
        ),
    )
    parser.add_argument(
        "--endpoint",
        default=None,
        help="Foundry project endpoint. If omitted, reads from environment.",
    )
    parser.add_argument(
        "--agent-name",
        default=None,
        help="Foundry agent name. If omitted, reads from environment.",
    )
    parser.add_argument(
        "--agent-version",
        default=None,
        help="Foundry agent version. If omitted, reads from environment.",
    )
    parser.add_argument(
        "--env-file",
        default=".env.local",
        help="Environment file to load before resolving settings (default: .env.local).",
    )
    parser.add_argument(
        "--verbose",
        action="store_true",
        help="Print debug metadata (non-sensitive).",
    )
    return parser.parse_args()


def main() -> int:
    args = parse_args()

    env_file = Path(args.env_file)
    if not env_file.is_absolute():
        env_file = Path.cwd() / env_file

    load_env_file(env_file)

    try:
        responses_endpoint = resolve_responses_endpoint(args)
        if responses_endpoint:
            return invoke_published_responses_endpoint(
                responses_endpoint=responses_endpoint,
                message=args.message,
                verbose=args.verbose,
            )

        endpoint = resolve_endpoint(args)
        agent_name, agent_version = resolve_agent(args)
        return invoke_agent(
            endpoint=endpoint,
            agent_name=agent_name,
            agent_version=agent_version,
            message=args.message,
            verbose=args.verbose,
        )
    except Exception as exc:  # noqa: BLE001
        print(f"ERROR: {exc}", file=sys.stderr)
        print(
            "Hint: Ensure azure-ai-projects is installed and credentials are valid. "
            "You can use service principal env vars or run az login.",
            file=sys.stderr,
        )
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
