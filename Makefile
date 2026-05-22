# oya — monorepo tasks. Requires Bun (https://bun.sh).
.DEFAULT_GOAL := help
.PHONY: help install dev build build-libs example test typecheck check bench docs clean deploy

help: ## Show available targets
	@grep -E '^[a-zA-Z_-]+:.*?## .*$$' $(MAKEFILE_LIST) | \
		awk 'BEGIN{FS=":.*?## "}{printf "  \033[36m%-11s\033[0m %s\n", $$1, $$2}'

install: ## Install all workspace dependencies
	bun install

build-libs: ## Build the publishable libraries (oya + @oya/server)
	cd packages/core && bun run build
	cd packages/server && bun run build

build: build-libs ## Build everything (libs + playground)
	cd apps/playground && bun run build

dev: build-libs ## Start oya Studio (the Next.js playground) at http://localhost:4000
	cd apps/playground && { [ -f ../../.env ] && set -a && . ../../.env && set +a || true; } && bun run dev

example: ## Run the weather example end-to-end (no network)
	cd packages/core && bun run example

demo: ## Play the paced terminal demo (for a GIF capture; no key)
	cd packages/core && bun run demo

test: ## Run the core test suite
	cd packages/core && bun test

typecheck: build-libs ## Typecheck every package
	cd packages/core && bun run typecheck
	cd packages/server && bun run typecheck
	cd benchmarks && bun run typecheck
	cd apps/playground && bun run typecheck

check: typecheck test ## Typecheck + test (what CI runs)

bench: build-libs ## Live benchmark vs Vercel AI SDK + Mastra (needs ANTHROPIC_API_KEY)
	cd benchmarks && { [ -f ../.env ] && set -a && . ../.env && set +a || true; } && bun run bench

docs: ## Serve the docs site
	bun run docs:dev

clean: ## Remove build output and caches
	rm -rf packages/*/dist apps/playground/.next docs/.vitepress/cache docs/.vitepress/dist
	find . -name node_modules -maxdepth 3 -type d -prune -exec rm -rf {} +

deploy: ## Deploy agents to Oya Cloud (Phase 2 — not yet available)
	@echo "Oya Cloud deployment is Phase 2 — coming soon."
	@echo "Today, oya runs anywhere as a library: 'bun add oya' and ship it in any Node/Bun/edge runtime."
