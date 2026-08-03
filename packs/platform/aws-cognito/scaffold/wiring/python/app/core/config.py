import os

from pydantic import BaseModel


class Settings(BaseModel):
    service_name: str = "{{project_name}}"
    log_level: str = "INFO"
    # The Cognito coordinates the auth guard validates access tokens against. They are read from the
    # environment the infrastructure passes into the service (COGNITO_USER_POOL_ID, COGNITO_CLIENT_ID,
    # AWS_REGION), so the same pool the CDK stack provisions is the pool the guard trusts.
    aws_region: str = os.environ.get("AWS_REGION", "us-east-1")
    cognito_user_pool_id: str = os.environ.get("COGNITO_USER_POOL_ID", "")
    cognito_client_id: str = os.environ.get("COGNITO_CLIENT_ID", "")


settings = Settings()
