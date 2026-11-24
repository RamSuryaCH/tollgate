"""Chat provider implementations and the factory that picks one from settings."""

from tollgate.config import Settings
from tollgate.providers.base import (
    ChatProvider,
    ProviderChunk,
    ProviderError,
    ProviderMessage,
    ProviderRequest,
    ProviderResponse,
    ProviderUnavailable,
)
from tollgate.providers.mock import MockProvider
from tollgate.providers.ollama import OllamaProvider
from tollgate.providers.openai_compat import OpenAICompatProvider

__all__ = [
    "ChatProvider",
    "MockProvider",
    "OllamaProvider",
    "OpenAICompatProvider",
    "ProviderChunk",
    "ProviderError",
    "ProviderMessage",
    "ProviderRequest",
    "ProviderResponse",
    "ProviderUnavailable",
    "get_provider",
]


def get_provider(settings: Settings) -> ChatProvider:
    """Build the provider named by DEFAULT_PROVIDER. Raises ProviderUnavailable if misconfigured."""
    match settings.default_provider:
        case "mock":
            return MockProvider()
        case "ollama":
            return OllamaProvider(settings.ollama_base_url)
        case "openai":
            key = settings.openai_api_key.get_secret_value()
            if not settings.openai_base_url or not key:
                raise ProviderUnavailable(
                    "openai provider needs OPENAI_BASE_URL and OPENAI_API_KEY"
                )
            return OpenAICompatProvider(settings.openai_base_url, key)
    raise ProviderUnavailable(f"unknown provider {settings.default_provider!r}")
