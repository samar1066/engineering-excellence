.PHONY: setup test synth verify
setup:
	npm ci
test:
	npm test
synth:
	npm run synth
verify:
	if command -v eep >/dev/null 2>&1; then eep verify; \
	else npx -y engineering-excellence verify; fi
