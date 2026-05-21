# oya — common tasks. Requires Bun (https://bun.sh).
.DEFAULT_GOAL := help
.PHONY: help install dev example test typecheck build check bench docs clean deploy

help: ## Show available targets
	@grep -E '^[a-zA-Z_-]+:.*?## .*$$' $(MAKEFILE_LIST) | \
		awk 'BEGIN{FS=":.*?## "}{printf "  \033[36m%-11s\033[0m %s\n", $$1, $$2}'

install: ## Install dependencies
	bun install

dev: ## Start the local dev server + live trace viewer (http://localhost:4000)
	bun examples/dev.ts

example: ## Run the weather example end-to-end (no network)
	bun run example

test: ## Run the test suite
	bun test

typecheck: ## Typecheck the library and benchmarks
	bun run typecheck && bun run typecheck:bench

build: ## Build dist (ESM + CJS + d.ts)
	bun run build

check: typecheck test build ## Typecheck + test + build (what CI runs)

bench: ## Live benchmark vs Vercel AI SDK + Mastra (needs ANTHROPIC_API_KEY)
	bun run bench

docs: ## Serve the docs site
	bun run docs:dev

clean: ## Remove build output and caches
	rm -rf dist node_modules docs/.vitepress/cache docs/.vitepress/dist

deploy: ## Deploy agents to Oya Cloud (Phase 2 — not yet available)
	@echo "Oya Cloud deployment is Phase 2 — coming soon."
	@echo "Today, oya runs anywhere as a library: 'bun add oya' and ship it in any Node/Bun/edge runtime."
