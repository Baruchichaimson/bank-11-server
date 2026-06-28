from pathlib import Path

import pytest

from ai.llm.errors import PromptLoadError
from ai.llm import prompt_loader
from ai.llm.prompt_loader import load_prompt, resolve_persona, resolve_prompt_file


def test_exact_prompt_file_still_loads():
    prompt = load_prompt("prompts/user_intent.md")

    assert "Return JSON only" in prompt
    assert "currentUserMessage is authoritative" in prompt


def test_provider_model_override_prefers_model_specific_override(tmp_path, monkeypatch):
    root = tmp_path / "repo"
    (root / "prompts").mkdir(parents=True)
    (root / "prompts" / "base.md").write_text("base", encoding="utf-8")
    (root / "prompts" / "provider.md").write_text("provider", encoding="utf-8")
    (root / "prompts" / "model.md").write_text("model", encoding="utf-8")
    monkeypatch.setattr(prompt_loader, "PROJECT_ROOT", root)

    prompt = load_prompt(
        "prompts/base.md",
        provider="openai",
        model="gpt-4o",
        prompt_overrides={"default": "prompts/base.md"},
        provider_prompt_overrides={"openai": "prompts/provider.md"},
        model_prompt_overrides={"gpt-4o": "prompts/model.md"},
    )

    assert prompt == "model"


def test_provider_model_override_falls_back_to_base_prompt_when_missing(tmp_path, monkeypatch):
    root = tmp_path / "repo"
    (root / "prompts").mkdir(parents=True)
    (root / "prompts" / "base.md").write_text("base", encoding="utf-8")
    monkeypatch.setattr(prompt_loader, "PROJECT_ROOT", root)

    prompt = load_prompt(
        "prompts/base.md",
        provider="openai",
        model="gpt-4o",
        prompt_overrides={},
        provider_prompt_overrides={},
        model_prompt_overrides={},
    )

    assert prompt == "base"


def test_missing_prompt_raises_clear_error():
    with pytest.raises(PromptLoadError, match="Prompt file not found"):
        load_prompt("prompts/does-not-exist.md")


def test_prompt_paths_are_rejected_when_escaping_project_root():
    with pytest.raises(PromptLoadError, match="escapes project root"):
        load_prompt("../outside.md")


def test_known_persona_loads_from_config():
    persona = resolve_persona("young")

    assert persona["resolvedPersona"] == "young"
    assert persona["prompt_file"] == "prompts/response/young.md"
    assert persona["tone"] == "casual"


def test_unknown_persona_falls_back_to_default():
    persona = resolve_persona("not-a-persona")

    assert persona["resolvedPersona"] == "default"
    assert persona["prompt_file"] == "prompts/response/default.md"


def test_missing_persona_falls_back_to_default():
    persona = resolve_persona(None)

    assert persona["resolvedPersona"] == "default"
    assert persona["prompt_file"] == "prompts/response/default.md"


def test_resolve_prompt_file_reports_override_usage():
    resolved = resolve_prompt_file(
        "prompts/base.md",
        provider="openai",
        model="gpt-4o",
        model_prompt_overrides={"gpt-4o": "prompts/model.md"},
    )

    assert resolved["prompt_file"] == "prompts/model.md"
    assert resolved["prompt_override_used"] is True
    assert resolved["prompt_source"] == "local"
