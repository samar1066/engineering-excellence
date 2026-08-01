from pydantic import BaseModel


class Settings(BaseModel):
    service_name: str = "{{project_name}}"
    log_level: str = "INFO"


settings = Settings()
