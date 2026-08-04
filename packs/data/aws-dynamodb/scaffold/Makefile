.PHONY: setup test verify
setup:
	npm ci
	cd wiring/python && uv sync --all-extras
test:
	npm test
verify:
	if command -v eep >/dev/null 2>&1; then eep verify; \
	else npx -y engineering-excellence verify; fi
