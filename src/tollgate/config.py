"""Application settings loaded from environment variables and an optional .env file."""

from functools import lru_cache
from typing import Literal

from pydantic import Field, SecretStr
from pydantic_settings import BaseSettings, SettingsConfigDict

DEFAULT_ADMIN_API_KEY = "change-me-admin"


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", env_file_encoding="utf-8", extra="ignore")

    app_env: str = "development"
    database_url: str = "postgresql+asyncpg://tollgate:tollgate@127.0.0.1:5432/tollgate"
    redis_url: str = "redis://127.0.0.1:6379/0"

    default_provider: Literal["ollama", "mock", "openai"] = "ollama"
    ollama_base_url: str = "http://127.0.0.1:11434"
    default_model: str = "llama3.2:3b"
    openai_base_url: str = ""
    openai_api_key: SecretStr = SecretStr("")

    admin_api_key: SecretStr = SecretStr(DEFAULT_ADMIN_API_KEY)
    cache_ttl_seconds: int = Field(default=3600, ge=1)
    default_rate_limit_rpm: int = Field(default=60, ge=1)

    api_host: str = "0.0.0.0"
    api_port: int = 8000


@lru_cache
def get_settings() -> Settings:
    return Settings()
