from __future__ import annotations

from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    gateway_name: str = "Aight Gateway"
    gateway_env: str = "local"
    registry_address: str | None = None
    base_sepolia_rpc_url: str = "https://sepolia.base.org"

    model_config = SettingsConfigDict(
        env_prefix="AIGHT_",
        env_file=(".env", ".env.local", "gateway/.env", "gateway/.env.local"),
        extra="ignore",
    )


settings = Settings()
