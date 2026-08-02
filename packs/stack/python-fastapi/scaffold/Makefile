.PHONY: setup test verify run
setup:
	uv sync
	uv run pre-commit install
test:
	uv run pytest --cov=app --cov-fail-under=85 -q
verify:
	if command -v eep >/dev/null 2>&1; then eep verify; \
	else npx -y engineering-excellence verify; fi
run:
	uv run uvicorn app.main:app --reload
