import os
import sys

# Make the adapter module and the reference app tree importable when the suite is run from this
# directory, so `import dynamo_note_repository` and `from app.domain... import ...` resolve the same
# way they do once the adapter has dropped into a backend at app/infrastructure/repositories/.
sys.path.insert(0, os.path.dirname(__file__))

# DynamoDB Local accepts any credentials, but the AWS SDK still insists on finding some. These
# defaults let the suite run against the local container without a configured AWS profile; a real
# deployment overrides them from the environment.
os.environ.setdefault("AWS_DEFAULT_REGION", "us-east-1")
os.environ.setdefault("AWS_ACCESS_KEY_ID", "local")
os.environ.setdefault("AWS_SECRET_ACCESS_KEY", "local")
