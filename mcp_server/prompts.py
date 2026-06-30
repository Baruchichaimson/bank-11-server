"""MCP prompt registration (Stage 7B)."""

from pathlib import Path

from mcp.server.fastmcp import FastMCP

PROJECT_ROOT = Path(__file__).resolve().parents[1]

PROMPT_DEFINITIONS: dict[str, str] = {
    "user_intent": "prompts/user_intent.md",
    "risk_analysis": "prompts/risk_analysis.md",
    "risk_judge": "prompts/risk_judge.md",
    "assistant_response": "prompts/response/default.md",
}


def _read_prompt_file(relative_path: str) -> str:
    path = PROJECT_ROOT / relative_path
    content = path.read_text(encoding="utf-8").strip()
    if not content:
        raise RuntimeError(f"Prompt file is empty: {relative_path}")
    return content


def register_prompts(mcp: FastMCP) -> None:
    """Expose banking prompts over MCP using the same content as local files."""

    @mcp.prompt(name="user_intent")
    def user_intent_prompt() -> str:
        """User intent routing prompt."""
        return _read_prompt_file(PROMPT_DEFINITIONS["user_intent"])

    @mcp.prompt(name="risk_analysis")
    def risk_analysis_prompt() -> str:
        """Transfer risk analysis prompt."""
        return _read_prompt_file(PROMPT_DEFINITIONS["risk_analysis"])

    @mcp.prompt(name="risk_judge")
    def risk_judge_prompt() -> str:
        """Transfer risk judge prompt."""
        return _read_prompt_file(PROMPT_DEFINITIONS["risk_judge"])

    @mcp.prompt(name="assistant_response")
    def assistant_response_prompt() -> str:
        """Default assistant response prompt."""
        return _read_prompt_file(PROMPT_DEFINITIONS["assistant_response"])
