import os
import sys
from pathlib import Path

# Make the reference app tree importable when the suite runs from this directory, so that
# `from app.api.auth import ...` and `from app.core.config import settings` resolve the same way they
# do once auth.py has dropped into a backend at app/api/auth.py.
sys.path.insert(0, str(Path(__file__).parent))

# Deterministic defaults so importing app.core.config never depends on the developer's environment.
# The auth-guard test overrides these per test with the values that match the token it mints.
os.environ.setdefault("AWS_REGION", "us-east-1")
os.environ.setdefault("COGNITO_USER_POOL_ID", "us-east-1_referencepool")
os.environ.setdefault("COGNITO_CLIENT_ID", "reference-client-id")
