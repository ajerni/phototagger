from __future__ import annotations

import base64
from dataclasses import dataclass
from typing import Any, Mapping, Protocol, Sequence, TypeVar

import httpx
from pydantic import BaseModel

from backend.app.core.config import Settings, get_settings


SchemaT = TypeVar("SchemaT", bound=BaseModel)


@dataclass(frozen=True)
class ModelStatus:
    model_available: bool
    model_status: str
    model_error: str | None = None


class GemmaClient(Protocol):
    def complete_json(
        self,
        *,
        messages: Sequence[Mapping[str, Any]],
        schema: type[SchemaT],
        options: Mapping[str, Any],
    ) -> str:
        """Return the model's raw JSON string for the supplied schema."""


class OpenRouterClient:
    def __init__(self, settings: Settings | None = None) -> None:
        self.settings = settings or get_settings()

    def complete_json(
        self,
        *,
        messages: Sequence[Mapping[str, Any]],
        schema: type[SchemaT],
        options: Mapping[str, Any],
    ) -> str:
        openai_messages = [_convert_message(m) for m in messages]
        response = httpx.post(
            f"{self.settings.openrouter_base_url}/chat/completions",
            headers={
                "Authorization": f"Bearer {self.settings.openrouter_api_key}",
                "Content-Type": "application/json",
            },
            json={
                "model": self.settings.openrouter_model,
                "messages": openai_messages,
                "temperature": options.get("temperature", 0),
                "response_format": {
                    "type": "json_schema",
                    "json_schema": {
                        "name": schema.__name__,
                        "schema": schema.model_json_schema(),
                        "strict": False,
                    },
                },
            },
            timeout=120.0,
        )
        response.raise_for_status()
        data = response.json()
        content = data["choices"][0]["message"]["content"]
        return content.strip() if content else ""


def _convert_message(msg: Mapping[str, Any]) -> dict[str, Any]:
    """Convert Ollama-style message (with bytes images) to OpenAI vision format."""
    role = msg["role"]
    text = msg.get("content", "")
    images: list[bytes] = list(msg.get("images", []))

    if not images:
        return {"role": role, "content": text}

    content: list[dict[str, Any]] = []
    if text:
        content.append({"type": "text", "text": text})
    for img_bytes in images:
        b64 = base64.b64encode(img_bytes).decode()
        content.append({
            "type": "image_url",
            "image_url": {"url": f"data:image/jpeg;base64,{b64}"},
        })
    return {"role": role, "content": content}


def check_openrouter_model(settings: Settings | None = None) -> ModelStatus:
    settings = settings or get_settings()
    if not settings.openrouter_api_key:
        return ModelStatus(
            model_available=False,
            model_status="api_key_missing",
            model_error="OPENROUTER_API_KEY is not set",
        )
    try:
        response = httpx.get(
            f"{settings.openrouter_base_url}/models",
            headers={"Authorization": f"Bearer {settings.openrouter_api_key}"},
            timeout=5.0,
        )
        response.raise_for_status()
        return ModelStatus(model_available=True, model_status="ready")
    except Exception as exc:
        return ModelStatus(
            model_available=False,
            model_status="unreachable",
            model_error=str(exc),
        )
