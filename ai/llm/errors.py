class LLMRoutingError(Exception):
    """Base error for LLM routing failures."""


class UnknownOperationError(LLMRoutingError):
    """Raised when an operation is missing from llm_routing.json."""


class PromptLoadError(LLMRoutingError):
    """Raised when a configured prompt cannot be loaded."""


class ProviderNotConfiguredError(LLMRoutingError):
    """Raised when a provider cannot be called safely."""


class LLMResponseError(LLMRoutingError):
    """Raised when an LLM response cannot be parsed as expected."""
