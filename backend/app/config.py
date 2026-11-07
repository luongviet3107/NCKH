from __future__ import annotations

from pathlib import Path

from pydantic import AliasChoices, Field
from pydantic_settings import BaseSettings, SettingsConfigDict

BACKEND_DIR = Path(__file__).resolve().parent.parent
PROJECT_ROOT = BACKEND_DIR.parent
DATA_DIR = BACKEND_DIR / "data"
UPLOAD_DIR = DATA_DIR / "uploads"
EXPORT_DIR = DATA_DIR / "exports"
DEMO_DIR = PROJECT_ROOT / "datasets"
REPORTS_DIR = PROJECT_ROOT / "reports"


class Settings(BaseSettings):
    app_name: str = "AutoDS"
    app_version: str = "1.0.0"
    api_prefix: str = "/api"
    environment: str = "development"
    database_url: str = f"sqlite:///{(BACKEND_DIR / 'autods.db').as_posix()}"
    cors_origins: str = "http://localhost:5173,http://127.0.0.1:5173,http://localhost:4173"
    api_key: str = Field(default="", validation_alias=AliasChoices("AUTODS_API_KEY", "API_KEY"))
    max_upload_mb: int = 50
    max_agent_runtime_seconds: int = 300
    llm_api_key: str = ""
    llm_base_url: str = "https://api.openai.com/v1"
    llm_model: str = "gpt-4o-mini"
    langsmith_api_key: str = ""
    langsmith_tracing: bool = False
    langsmith_project: str = "autods"
    seed_demo_data: bool = True

    model_config = SettingsConfigDict(
        env_file=(str(PROJECT_ROOT / ".env"), str(BACKEND_DIR / ".env")),
        env_file_encoding="utf-8",
        extra="ignore",
        case_sensitive=False,
    )

    @property
    def cors_origin_list(self) -> list[str]:
        return [origin.strip() for origin in self.cors_origins.split(",") if origin.strip()]

    @property
    def llm_configured(self) -> bool:
        return bool(self.llm_api_key.strip())


settings = Settings()

for directory in (DATA_DIR, UPLOAD_DIR, EXPORT_DIR, DEMO_DIR, REPORTS_DIR):
    directory.mkdir(parents=True, exist_ok=True)
