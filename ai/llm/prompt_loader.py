from pathlib import Path

from ai.llm.errors import PromptLoadError


PROJECT_ROOT = Path(__file__).resolve().parents[2]


def load_prompt(prompt_file: str) -> str:
    relative = str(prompt_file or "").strip()
    if not relative:
        raise PromptLoadError("LLM prompt_file is required")

    path = (PROJECT_ROOT / relative).resolve()
    if PROJECT_ROOT not in path.parents and path != PROJECT_ROOT:
        raise PromptLoadError(f"Prompt path escapes project root: {relative}")
    if not path.exists() or not path.is_file():
        raise PromptLoadError(f"Prompt file not found: {relative}")

    content = path.read_text(encoding="utf-8").strip()
    if not content:
        raise PromptLoadError(f"Prompt file is empty: {relative}")
    return content
