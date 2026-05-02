from __future__ import annotations

from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    gateway_name: str = "Aight Gateway"
    gateway_env: str = "local"
    registry_address: str | None = None
    base_sepolia_rpc_url: str = "https://sepolia.base.org"
    allowed_origins: str = "http://localhost:3000,http://127.0.0.1:3000"
    state_path: str | None = None
    settlement_keeper_enabled: bool = False
    settlement_keeper_private_key: str | None = None
    settlement_keeper_interval_seconds: int = 60

    @property
    def cors_origins(self) -> list[str]:
        return [origin.strip() for origin in self.allowed_origins.split(",") if origin.strip()]

    @property
    def configured_state_path(self) -> str | None:
        if self.state_path is None or not self.state_path.strip():
            return None
        return self.state_path.strip()

    model_config = SettingsConfigDict(
        env_prefix="AIGHT_",
        env_file=(".env", ".env.local", "gateway/.env", "gateway/.env.local"),
        extra="ignore",
    )


settings = Settings()
