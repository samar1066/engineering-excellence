.PHONY: setup test verify run
setup:
	npm ci
test:
	npm run test:cov
	npm run test:a11y
verify:
	if command -v eep >/dev/null 2>&1; then eep verify; \
	else npx -y engineering-excellence verify; fi
run:
	npm run dev
