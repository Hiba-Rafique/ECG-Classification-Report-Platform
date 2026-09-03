from pydantic_settings import BaseSettings
from typing import List


class Settings(BaseSettings):
    """Application settings loaded from environment variables."""

    # Application
    app_name: str = "ECG Analysis Platform"
    debug: bool = True
    host: str = "0.0.0.0"
    port: int = 8000

    # Database
    database_url: str = "sqlite:///./ecg_results.db"

    # Model
    model_path: str = "./models/weights/best_model.pth"
    mock_inference: bool = True

    # Upload
    max_file_size_mb: int = 50
    allowed_extensions: str = "csv,dat,hea,edf"

    # AI report generation (OpenAI-compatible endpoint)
    ai_api_key: str = ""
    ai_base_url: str = "https://api.openai.com/v1"
    ai_model: str = "gpt-4o-mini"

    # RAG — retrieval-augmented generation over clinical guidelines
    # Set RAG_ENABLED=true and build the index (scripts/build_index.py) to
    # ground AI reports in AHA/ACCF/HRS guideline criteria.
    rag_enabled: bool = False
    rag_index_dir: str = "data/index"
    rag_embedding_model: str = "all-MiniLM-L6-v2"
    rag_max_queries: int = 5  # max search queries per report request

    @property
    def allowed_extensions_list(self) -> List[str]:
        return [ext.strip() for ext in self.allowed_extensions.split(",")]

    @property
    def max_file_size_bytes(self) -> int:
        return self.max_file_size_mb * 1024 * 1024

    class Config:
        env_file = ".env"
        env_file_encoding = "utf-8"


settings = Settings()
