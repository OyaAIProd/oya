# Changelog

All notable changes to `oyadotai` and `oyadotai-server` are documented here.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

> **How releases work:** CI auto-publishes a patch release of both packages to npm
> on every merge to `main` (see `.github/workflows/ci.yml`), so version numbers
> increment quickly and a release commit follows the change that shipped in it.
> The two packages are versioned together. oya is pre-1.0 — minor versions may
> include breaking changes; they'll be called out here.

## [Unreleased]

### Added
- Markdown rendering in the Studio chat and answer panels (dependency-free
  renderer for headings, bold/italic, code, lists, links, blockquotes, and rules).
- Documentation links from the README to the `docs/` guide and concepts pages.
- Community project scaffolding: `CODE_OF_CONDUCT.md`, `SECURITY.md`,
  `GOVERNANCE.md`, a pull-request template, and structured issue forms.
- White-paper links and an [oya.ai](https://oya.ai) callout in both READMEs.

### Removed
- The legacy inline `STUDIO_HTML` fallback in the `oya dev` CLI. The built React
  Flow Studio SPA ships in the package (`dist/studio`), so the stale vanilla-JS
  copy was dead code; running from source without a build now returns a clear
  "run `bun run build`" message.

### Fixed
- Corrected `oya-labs/oya` → `OyaAIProd/oya` GitHub URLs in the docs.

## [0.1.7] — 2026-07-13

### Added
- Studio renders agent responses as Markdown; expanded docs.

## [0.1.6] — 2026-07-13

### Changed
- Oya brand refresh in Studio: ring logo, green (`#2ca01c`) palette, "Oya"
  wordmark.

## [0.1.5] — 2026-07-13

### Added
- `bunx oyadotai dev` now serves the full React Flow Studio SPA from the CLI,
  shipped inside the package.

## [0.1.4]

### Added
- Rebuilt the Studio/playground on React Flow with a Tailwind theme; added docs.

## [0.1.3]

### Added
- Ship a sample `oya.config.ts` so `bunx oyadotai dev` works out of the box in the
  repo.

## [0.1.2]

### Changed
- Readable benchmark output (banner + tables, no elision) and clearer README
  benchmark commands.

## [0.1.1]

### Added
- First public release of `oyadotai` (runtime, `Agent`, `createTool`, the
  `anthropic` / `openai` / `google` providers, `oyadotai/react` hooks, the
  `oya dev` Studio) and `oyadotai-server` (`toSSEResponse` / `toTextResponse`).

[Unreleased]: https://github.com/OyaAIProd/oya/compare/v0.1.7...HEAD
[0.1.7]: https://github.com/OyaAIProd/oya/compare/v0.1.6...v0.1.7
[0.1.6]: https://github.com/OyaAIProd/oya/compare/v0.1.5...v0.1.6
[0.1.5]: https://github.com/OyaAIProd/oya/compare/v0.1.4...v0.1.5
[0.1.4]: https://github.com/OyaAIProd/oya/compare/v0.1.3...v0.1.4
[0.1.3]: https://github.com/OyaAIProd/oya/compare/v0.1.2...v0.1.3
[0.1.2]: https://github.com/OyaAIProd/oya/compare/v0.1.1...v0.1.2
[0.1.1]: https://github.com/OyaAIProd/oya/releases/tag/v0.1.1
