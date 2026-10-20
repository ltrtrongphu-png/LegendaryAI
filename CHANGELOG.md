# LegendaryAI Changelog

## 1.3.1 — Runtime verification hardening (2026-10-20)
- Centralized the MoMo payment-init and captureWallet IPN canonical signature strings in shared helpers used by both Edge Functions.
- Added deterministic HMAC test vectors and case/tampering/length checks for hexadecimal signature comparison.
- Reduced background WebGL particle/line counts on reduced-motion and low-resource devices, disabled continuous animation in those modes, paused animation on hidden tabs, and released GPU resources on pagehide.
- Added Playwright smoke coverage for the application shell, /new and /chat/:slug deep links, and all legal routes; CI installs a pinned Playwright release for the browser check.

## 1.3.0 — Security, payment, privacy and legal consolidation (2026-10-20)
- Hardened CORS allowlists across active and legacy chat, model health, Owner, token reset and payment endpoints; allow SITE_URL explicitly and reject unapproved browser origins.
- Required a server-side bearer secret for the Ollama-compatible gateway; disabled retries on HTTP 429 and prevented silent fallback for an explicitly selected local model.
- Capped local model generation by remaining token budget and added request-scoped idempotent refund accounting through a migration.
- Fixed the Vietnamese image-intent regression for “hình thành”; disabled the old external image-generation route until a self-hosted provider is verified.
- Added the missing transactional/idempotent finalize_momo_payment RPC, request/transaction binding, provider timeout handling and a server-verified payment result page.
- Added policy consent storage, authenticated user-data export/account deletion, a support request inbox and configurable—but disabled-by-default—retention cleanup.
- Added Vietnamese draft policy pages, routes, footer links, sitemap entries, audit/legal checklists and security/contribution docs.
- Removed email-based Owner bootstrap from the schema snapshot; existing Owner assignments are preserved and new Owner grants must be performed by a trusted database administrator.
- Added regression/secret-scan checks and operational guidance. Production deployment, live MoMo tests, live local-model tests and legal approval remain manual.

## 1.2.2 — CORS origin allowlist hardening
- Reject browser requests with an unapproved Origin at the active `ai-chat-v10` and `local-model-health` Edge Function boundaries.
- Add the configured `SITE_URL` to the explicit allowlist while preserving localhost development origins.
- Add a CI regression check for the origin rejection boundary.

## 1.2.1 — Repository audit baseline
- Added `docs/AUDIT_REPORT.md` with verified Phase 0 findings, current documentation drift, preliminary data map, and explicit follow-up verification items.
- No production configuration, database migration, or runtime behavior changed in this documentation-only phase.

## 1.2.0 — Legendary Brain V12
- Added bounded **Planner → Executor → Verifier → Finalizer** pipeline to Native Core.
- Added an explicit native-tool allowlist for math, unit conversion, JSON formatting, extractive summary, code diagnostics and safe templates.
- Added verification gates so unresolved native tasks fall back cleanly instead of fabricating an answer.
- Added V12 agent-plan telemetry to the ai-chat-v10 response.
- Kept local inference optional; no external AI provider is enabled by this release.
- Preserved Guest 1K/session and existing plan-aware token windows.

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
