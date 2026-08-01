.PHONY: setup test verify run
setup:
	uv sync
	uv run pre-commit install
test:
	uv run pytest --cov=app --cov-fail-under=85 -q
verify:
	eep verify
run:
	uv run uvicorn app.main:app --reload
