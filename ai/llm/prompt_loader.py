import json
from pathlib import Path

from ai.llm.errors import PromptLoadError


PROJECT_ROOT = Path(__file__).resolve().parents[2]
PERSONA_CONFIG_PATH = PROJECT_ROOT / "config" / "persona_config.json"


def _read_json_file(path: Path, error_message: str) -> dict:
    if not path.exists() or not path.is_file():
        raise PromptLoadError(error_message)
    try:
        parsed = json.loads(path.read_text(encoding="utf-8"))
    except Exception as err:
        raise PromptLoadError(f"Failed to parse JSON file: {path.name}") from err
    return parsed if isinstance(parsed, dict) else {}


def _resolve_project_path(relative_path: str) -> Path:
    path = (PROJECT_ROOT / relative_path).resolve()
    if PROJECT_ROOT not in path.parents and path != PROJECT_ROOT:
        raise PromptLoadError(f"Prompt path escapes project root: {relative_path}")
    return path


def _select_override(prompt_overrides, provider_prompt_overrides, model_prompt_overrides, *, provider: str | None, model: str | None) -> str | None:
    provider_key = str(provider or "").strip()
    model_key = str(model or "").strip()

    def _pick(mapping, candidates):
        if not mapping:
            return None
        if isinstance(mapping, str):
            return mapping.strip() or None
        if not isinstance(mapping, dict):
            return None
        for candidate in candidates:
            if not candidate:
                continue
            value = mapping.get(candidate)
            if isinstance(value, str) and value.strip():
                return value.strip()
            if isinstance(value, dict):
                for nested in (model_key, provider_key, "default"):
                    nested_value = value.get(nested)
                    if isinstance(nested_value, str) and nested_value.strip():
                        return nested_value.strip()
        return None

    candidates = []
    if provider_key and model_key:
        candidates.append(f"{provider_key}:{model_key}")
    if model_key:
        candidates.append(model_key)
    if provider_key:
        candidates.append(provider_key)
    candidates.append("default")

    return (
        _pick(model_prompt_overrides, candidates)
        or _pick(provider_prompt_overrides, candidates)
        or _pick(prompt_overrides, candidates)
    )


def resolve_prompt_file(
    prompt_file: str,
    *,
    provider: str | None = None,
    model: str | None = None,
    prompt_overrides=None,
    provider_prompt_overrides=None,
    model_prompt_overrides=None,
) -> dict:
    base_prompt_file = str(prompt_file or "").strip()
    if not base_prompt_file:
        raise PromptLoadError("LLM prompt_file is required")

    selected_prompt_file = _select_override(
        prompt_overrides,
        provider_prompt_overrides,
        model_prompt_overrides,
        provider=provider,
        model=model,
    )
    resolved_prompt_file = selected_prompt_file or base_prompt_file
    return {
        "prompt_file": resolved_prompt_file,
        "prompt_source": "local",
        "prompt_override_used": bool(selected_prompt_file),
        "base_prompt_file": base_prompt_file,
    }


def load_prompt(
    prompt_file: str,
    *,
    provider: str | None = None,
    model: str | None = None,
    prompt_overrides=None,
    provider_prompt_overrides=None,
    model_prompt_overrides=None,
) -> str:
    resolution = resolve_prompt_file(
        prompt_file,
        provider=provider,
        model=model,
        prompt_overrides=prompt_overrides,
        provider_prompt_overrides=provider_prompt_overrides,
        model_prompt_overrides=model_prompt_overrides,
    )
    path = _resolve_project_path(resolution["prompt_file"])
    if not path.exists() or not path.is_file():
        raise PromptLoadError(f"Prompt file not found: {resolution['prompt_file']}")

    content = path.read_text(encoding="utf-8").strip()
    if not content:
        raise PromptLoadError(f"Prompt file is empty: {resolution['prompt_file']}")
    return content


def load_persona_config() -> dict:
    return _read_json_file(PERSONA_CONFIG_PATH, "Persona config file not found: config/persona_config.json")


def resolve_persona(persona: str | None) -> dict:
    config = load_persona_config()
    requested = str(persona or "").strip().lower()
    resolved_name = requested if requested and requested in config else "default"
    persona_config = dict(config.get(resolved_name) or config.get("default") or {})
    persona_config.setdefault("name", resolved_name)
    persona_config.setdefault("description", "")
    persona_config.setdefault("tone", "neutral")
    persona_config["requestedPersona"] = requested or None
    persona_config["resolvedPersona"] = resolved_name
    persona_config["prompt_file"] = persona_config.get("prompt_file") or f"prompts/response/{resolved_name}.md"
    return persona_config


def load_response_prompt(
    persona: str | None = None,
    *,
    provider: str | None = None,
    model: str | None = None,
    prompt_overrides=None,
    provider_prompt_overrides=None,
    model_prompt_overrides=None,
) -> tuple[str, dict]:
    persona_config = resolve_persona(persona)
    resolution = resolve_prompt_file(
        persona_config["prompt_file"],
        provider=provider,
        model=model,
        prompt_overrides=prompt_overrides,
        provider_prompt_overrides=provider_prompt_overrides,
        model_prompt_overrides=model_prompt_overrides,
    )
    prompt = load_prompt(
        resolution["prompt_file"],
        provider=provider,
        model=model,
        prompt_overrides=None,
        provider_prompt_overrides=None,
        model_prompt_overrides=None,
    )
    return prompt, {
        **resolution,
        "persona": persona_config,
    }
