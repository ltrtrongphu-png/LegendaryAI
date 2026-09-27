# LegendaryAI Changelog

## 1.1.3
- Hardened client retry behavior: **429 rate-limit responses are no longer automatically retried**, preventing retry amplification.
- Added bounded client request retry/backoff behavior for transient server failures.
- Hardened local conversation persistence against browser storage quotas.
- Large base64 image attachments are no longer allowed to silently break the entire local chat history.
- Truncated oversized persisted attachment text while keeping the active in-memory conversation intact.
- Fixed attachment context formatting so file contents are sent with real line breaks.
- Hardened **Legendary Shield** memory by pruning stale rate-limit buckets.
- Added explicit chat-context validation.
- Hardened image generation with prompt-size limits, per-user request limits, bounded rate-limit memory and upstream timeout protection.
- Keeps **Adaptive Intelligence 1.1.2**, **Legendary Brain 9.0**, and **Legendary Shield 1.1.0**.

## 1.1.2
- Added Resilient Adaptive Intelligence.
- Added intent-aware output budgets.
- Added Local AI → Native Core fallback.
- Added route/fallback observability and request IDs.
- Separated Local AI and Native Core cache routes.

## 1.1.1
- Added Adaptive Intelligence Layer.
- Compacted long conversations to a bounded recent context window.
- Added short-lived response caching and performance telemetry.

## 1.1.0
- Legendary Brain 9.0 structured reasoning.
- Legendary Shield 1.1.0 application-layer abuse/rate protection.
- Versioning baseline and changelog.

### Versioning policy
- Patch: 1.1.x -> 1.1.x+1 for fixes/optimizations.
- Minor: 1.1.x -> 1.2.0 for substantial new features.
- Major: 1.x.x -> 2.0.0 for breaking changes.
