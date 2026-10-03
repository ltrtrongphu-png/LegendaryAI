# LegendaryAI Reliability & Local Model Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Stabilize LegendaryAI chat, conversation synchronization, attachment/privacy behavior, product claims, and the local-model integration path without enabling a placeholder inference backend.

**Architecture:** Keep `ai-chat-v10` as the authenticated server boundary. The browser builds bounded, canonical chat requests; Supabase resolves plan/model configuration server-side; a private OpenAI-compatible model gateway provides local inference through Ollama or llama.cpp when a real provider is configured. Conversation state becomes per-user and incrementally synchronized, while binary attachments move to Supabase Storage.

**Tech Stack:** Vanilla JavaScript frontend, Supabase Auth/Postgres/Storage/Edge Functions, GitHub-managed source, OpenAI-compatible local model gateway, Ollama or llama.cpp, existing Vercel deployment.

**Spec:** `docs/superpowers/specs/2026-10-03-legendaryai-reliability-local-model-design.md`

## Global Constraints

- Remove the capture-phase image-routing hotfix from `main.js` and keep one canonical image-intent classifier.
- Chat requests must use bounded recent context and must not resend historical base64 images during normal text chat.
- Client payloads must remain below the Edge Function request limit and expose stable error codes rather than raw transport errors.
- Conversation storage must be namespaced per authenticated user and must not allow one account to inherit another account's browser cache.
- Cloud sync must be incremental and must not use delete-all-then-reinsert as its normal synchronization strategy.
- `crypto.randomUUID()` is the preferred ID generator for new conversations/messages, with compatibility for existing IDs.
- Attachments belong in Supabase Storage; message JSON stores metadata/object paths rather than large base64 blobs.
- Do not enable placeholder models such as `CHANGE_ME`; the Local capability is advertised only when a real local provider is configured and healthy.
- Keep secrets and model-provider credentials server-side; the browser never receives private gateway credentials.
- Do not claim Vision, Agent, web search, or a token allowance as an implemented capability unless the backend actually supports it.
- Image generation remains paid/explicitly unavailable for plans without an enabled provider; no zero-cost provider is invented.
- Every implementation task must include a focused regression test or an equivalent reproducible verification before commit.

## Review Focus

- Image-like words embedded in ordinary words (`smart`, `particles`, `start`) and ordinary phrases containing `hình` must not trigger image mode — covered by Task 1 classifier tests.
- A long conversation containing old base64 images must remain chat-able under the request-size limit — covered by Task 2 payload-builder tests.
- A failed incremental sync must not delete the cloud copy or leak data between two users sharing a browser — covered by Task 4 sync/isolation tests.
- Concurrent updates from two clients must not silently overwrite a newer conversation version — covered by Task 5 optimistic-concurrency tests.
- A missing, unhealthy, or placeholder local model must produce `MODEL_UNAVAILABLE`/`MODEL_TIMEOUT` behavior instead of a fake successful AI response — covered by Task 7 gateway tests and Task 8 end-to-end verification.

---

### Task 1: Canonical Chat Intent Routing

**Files:**
- Modify: `js/main.js` — remove the capture-phase image submit handler and its duplicate image classifier/routing path.
- Modify: `js/chat.js` — own the canonical image-intent classifier and expose the request-routing decision used by chat submission.
- Test: `tests/chat/image-intent.test.js` (create if the repository has no equivalent frontend test location).

**Interfaces:**
- Consumes: existing chat submit flow and `LegendaryAIEngine.image/chat` APIs.
- Produces: one canonical `isImageGenerationPrompt(text)` decision with token-boundary-safe matching; ordinary chat questions continue through the normal chat path.

- [ ] **Step 1: Write failing regression tests** for `smart contract`, `particles`, `start`, `hình thành`, `hình thức`, Mermaid architecture diagrams, Matplotlib code, explicit image prompts, and explicit `vẽ` prompts.
- [ ] **Step 2: Run the focused tests** and confirm the existing duplicate/capture routing fails at least the false-positive cases.
- [ ] **Step 3: Implement the canonical classifier** in `js/chat.js` using token boundaries and explicit image terms; remove the capture-phase routing from `js/main.js` so submit handling has one owner.
- [ ] **Step 4: Run the focused tests** and verify all positive and negative routing cases pass.
- [ ] **Step 5: Commit** `fix: centralize image intent routing`.

### Task 2: Bounded Chat Request Builder and Stable Errors

**Files:**
- Modify: `js/chat.js` — replace full-history request construction with bounded context and attachment filtering.
- Modify: `js/ai-engine.js` — centralize request defaults, enforce/recognize stable error codes, and normalize Edge Function failures.
- Test: `tests/chat/request-builder.test.js`.

**Interfaces:**
- Consumes: conversation messages, model settings, and existing `LegendaryAIEngine.chat` contract.
- Produces: a deterministic request builder that selects only recent context, excludes historical base64 attachments from ordinary text chat, and rejects oversized serialized payloads before network dispatch.

- [ ] **Step 1: Write failing tests** for recent-message bounding, old image exclusion, current-message attachment handling, payload-budget rejection, 429 normalization, 413 normalization, and auth errors.
- [ ] **Step 2: Run the focused tests** and confirm current full-history behavior violates the expected bounded payload contract.
- [ ] **Step 3: Implement the request builder** with a named context limit and serialized payload budget below the backend limit; centralize temperature/max-token defaults instead of hard-coding them at the call site.
- [ ] **Step 4: Implement stable error mapping** with `RATE_LIMITED`, `PAYLOAD_TOO_LARGE`, `AUTH_REQUIRED`, `MODEL_UNAVAILABLE`, `MODEL_TIMEOUT`, `INVALID_REQUEST`, and `INTERNAL_ERROR`, while retaining useful server detail only where safe.
- [ ] **Step 5: Run the focused tests** and verify no request can exceed the configured client budget.
- [ ] **Step 6: Commit** `fix: bound chat context and normalize engine errors`.

### Task 3: Usage-Failure Observability

**Files:**
- Modify: the deployed `ai-chat-v10` Edge Function source file identified in the repository during implementation.
- Modify: the usage-log schema/migration only if the existing table cannot represent failure status/code safely.
- Test: Edge Function request/error-path tests or a deterministic SQL/function verification script matching the repository's existing test conventions.

**Interfaces:**
- Consumes: normalized request/error contract from Task 2.
- Produces: usage records for both successful model calls and failed calls, without storing secrets or raw sensitive payloads.

- [ ] **Step 1: Write a failing verification** showing a rejected/failed model invocation currently leaves no corresponding usage log.
- [ ] **Step 2: Run it** and record the current missing failure-log behavior.
- [ ] **Step 3: Add failure logging** with status/error code and safe metadata while preserving successful-call accounting.
- [ ] **Step 4: Verify** success, 429, validation, timeout, and model-unavailable paths are represented correctly.
- [ ] **Step 5: Commit** `fix: record failed ai usage attempts`.

### Task 4: Per-User Browser Storage Isolation

**Files:**
- Modify: `js/cloud-sync.js` — derive conversation/active keys from the authenticated user ID and isolate guest state.
- Modify: `js/account.js` — flush/clear the outgoing user's local conversation/draft cache during sign-out and emit the auth change after cleanup.
- Modify: `js/chat.js` and/or shared storage helpers only where they currently reference the fixed conversation/draft keys directly.
- Test: `tests/storage/account-isolation.test.js`.

**Interfaces:**
- Consumes: `supabase.auth.getUser()`/current user identity and existing conversation persistence APIs.
- Produces: `getConversationStorageKey(userId)`, `getActiveConversationStorageKey(userId)`, and user-scoped draft keys; guest data never becomes another user's authenticated data.

- [ ] **Step 1: Write failing tests** that sign user A out, sign user B in, and verify B cannot read A's conversation/draft cache; also test a guest-to-user transition.
- [ ] **Step 2: Run the tests** and confirm the fixed global keys reproduce the leak.
- [ ] **Step 3: Implement namespaced keys** and migrate/clear legacy fixed-key state safely rather than copying it into a different account.
- [ ] **Step 4: Update sign-out cleanup** so outgoing user state is flushed/cleared before the auth-changed event exposes the next account.
- [ ] **Step 5: Run tests** including reload and empty-cloud cases.
- [ ] **Step 6: Commit** `fix: isolate browser conversation state per user`.

### Task 5: Incremental Cloud Sync with Optimistic Concurrency

**Files:**
- Modify: `js/cloud-sync.js` — replace delete-all/reinsert sync with per-conversation/message incremental upsert/delete, no-op detection, and version-aware writes.
- Create/Modify: `supabase/migrations/<timestamp>_conversation_sync_concurrency.sql` — add the minimum version/updated-at concurrency support required by the existing schema.
- Test: `tests/storage/cloud-sync.test.js` plus SQL/RLS verification for conflict behavior.

**Interfaces:**
- Consumes: per-user storage keys and existing conversation/message schema.
- Produces: incremental synchronization that preserves remote history on partial failure, does not rewrite `updated_at` for unchanged records, and rejects stale writes instead of silently overwriting newer versions.

- [ ] **Step 1: Write failing sync tests** for unchanged conversations, changed conversations, message additions/removals, partial network failure, and stale-client updates.
- [ ] **Step 2: Run the tests** and confirm the current delete-then-insert strategy can empty cloud history on insert failure.
- [ ] **Step 3: Add the minimum database-side concurrency primitive** needed for conditional upserts/version checks, with RLS scoped to `auth.uid()`.
- [ ] **Step 4: Implement incremental sync** so only changed rows are written and deletes target explicit IDs owned by the current user.
- [ ] **Step 5: Remove the unconditional 15-second full-upload loop**; retain debounced change-triggered sync and an explicit/manual retry path.
- [ ] **Step 6: Verify two-client conflict behavior** and confirm stale writes cannot replace newer versions silently.
- [ ] **Step 7: Commit** `fix: make conversation sync incremental and versioned`.

### Task 6: Attachment Storage Migration and Data Lifecycle

**Files:**
- Modify: `js/cloud-sync.js` — upload attachments to Supabase Storage and persist object metadata/path in messages.
- Modify: `js/chat.js` — consume attachment metadata without embedding old base64 data in normal chat requests.
- Create/Modify: `supabase/migrations/<timestamp>_chat_attachment_policies.sql` — add/adjust Storage object policies and any message metadata constraints required by the implementation.
- Test: `tests/storage/attachments.test.js` and SQL/RLS verification.

**Interfaces:**
- Consumes: existing `chat-attachments` bucket and message attachment fields.
- Produces: stable attachment metadata (`bucket`, object path, MIME/size where needed) with authenticated ownership enforcement and cleanup on conversation deletion.

- [ ] **Step 1: Write failing tests** for upload, metadata persistence, old-base64 exclusion, unauthorized object access, and conversation deletion cleanup.
- [ ] **Step 2: Run them** to document current base64-only behavior and missing Storage usage/policies.
- [ ] **Step 3: Implement Storage upload/metadata persistence** and keep compatibility for existing small legacy attachments.
- [ ] **Step 4: Implement deletion cleanup** for objects associated with deleted conversations, without deleting another user's object.
- [ ] **Step 5: Verify RLS/Storage policies** and attachment access with two different users.
- [ ] **Step 6: Commit** `feat: move chat attachments to storage`.

### Task 7: Product Truth, Privacy, Accessibility, and Site Assets

**Files:**
- Modify: `index.html` — correct product/capability copy, JSON-LD, footer destinations, accessibility labels/live regions, and metadata.
- Create: `privacy.html`.
- Create/Modify: `terms.html` and `contact.html` according to existing site structure.
- Create: `robots.txt`.
- Create: `sitemap.xml`.
- Create/replace: `og-image.png` using the approved 1200×630 social-preview asset when available in the repository; otherwise document the exact missing asset dependency rather than fabricating one.
- Modify: `js/power-suite.js` and related shared-storage code if required to remove duplicate localStorage ownership.
- Test: static validation script/checklist covering links, metadata, accessibility counts, and capability claims.

**Interfaces:**
- Consumes: the actual capabilities left enabled by Tasks 1–6 and the existing pricing/payment configuration.
- Produces: truthful public-facing copy and working legal/contact navigation, plus crawlable site metadata and reduced duplicated storage logic.

- [ ] **Step 1: Write failing static checks** for broken `#top` legal/contact links, absent `og-image.png`, missing robots/sitemap, and unsupported web-search/Vision/Agent claims.
- [ ] **Step 2: Implement the minimum content/link changes** so every advertised capability maps to an implemented backend or is explicitly marked unavailable.
- [ ] **Step 3: Add privacy/data-lifecycle UI** for viewing/deleting supported `ai_memories` and account/conversation data, using authenticated server-side authorization.
- [ ] **Step 4: Consolidate direct localStorage ownership** so `power-suite.js` cannot silently diverge from the canonical conversation storage implementation.
- [ ] **Step 5: Add accessibility improvements** for key controls, status/live feedback, and keyboard navigation without changing visual behavior unnecessarily.
- [ ] **Step 6: Run static checks** and manually verify all public links and metadata targets.
- [ ] **Step 7: Commit** `fix: align product claims privacy and site metadata`.

### Task 8: Local Model Gateway Contract

**Files:**
- Modify: `supabase/functions/ai-chat-v10/index.ts` — resolve enabled model/provider server-side and call the configured private gateway using an OpenAI-compatible chat-completions contract.
- Create: `supabase/functions/_shared/model-gateway.ts` — provider resolution, timeout, response normalization, and stable model errors.
- Modify: model/provider migration or seed data only where necessary to represent a real local provider safely.
- Test: `tests/edge/model-gateway.test.ts` plus gateway contract tests.

**Interfaces:**
- Consumes: authenticated user/plan, model configuration, server-side gateway URL/secret, and request contract from Task 2.
- Produces: normalized `{ text, usage, model }` success or stable `MODEL_UNAVAILABLE` / `MODEL_TIMEOUT` / `INTERNAL_ERROR` failures; placeholder `CHANGE_ME` providers are rejected.

- [ ] **Step 1: Write failing gateway tests** for OpenAI-compatible success, malformed provider response, missing gateway configuration, `CHANGE_ME`, HTTP 429/5xx, and timeout.
- [ ] **Step 2: Run tests** and confirm the repository has no real local inference path.
- [ ] **Step 3: Implement provider resolution** so plans map to enabled model records and the gateway URL/credential is read only from server-side configuration.
- [ ] **Step 4: Implement the OpenAI-compatible adapter** with bounded timeout and stable error mapping; support Ollama/llama.cpp through the same gateway contract rather than browser-specific code.
- [ ] **Step 5: Keep Local disabled until a real endpoint/model passes health verification**; never fall back silently to a fake placeholder.
- [ ] **Step 6: Verify** authenticated requests, model selection, timeout, unavailable-provider, and successful completion behavior.
- [ ] **Step 7: Commit** `feat: add local model gateway contract`.

### Task 9: End-to-End Local Inference Enablement and Final Verification

**Files:**
- Modify: deployment/configuration documentation and model seed/config only after a real gateway endpoint and model are available.
- Modify: frontend capability/status rendering if necessary so Local is shown only when the backend reports it as enabled/healthy.
- Test: end-to-end smoke test against the actual configured local gateway.

**Interfaces:**
- Consumes: Task 8 gateway contract and an externally hosted/self-hosted Ollama or llama.cpp endpoint with a concrete model.
- Produces: a real authenticated prompt -> `ai-chat-v10` -> local gateway -> model -> response path, with no placeholder provider.

- [ ] **Step 1: Provision or identify the real local model gateway** and record its model identifier, health endpoint, and private network/secret configuration. If no gateway exists, stop this task at the documented infrastructure prerequisite rather than claiming completion.
- [ ] **Step 2: Configure the model record/plan mapping** to the concrete provider/model and keep all credentials server-side.
- [ ] **Step 3: Run an authenticated end-to-end smoke test** covering a normal chat prompt, bounded context, usage logging, and a forced timeout/unavailable case.
- [ ] **Step 4: Verify the UI reports the real model capability only after health/config checks pass.**
- [ ] **Step 5: Run the complete frontend, SQL/RLS, Edge Function, and static verification suite.
- [ ] **Step 6: Run a final security review** for auth boundaries, Storage ownership, request size, model secrets, and account-isolation behavior.
- [ ] **Step 7: Commit** `feat: enable verified local inference` only if the real gateway is provisioned and the smoke test passes; otherwise commit the gateway-ready implementation separately and document the remaining infrastructure prerequisite.

---

## Execution Notes

- Before implementation, inspect the repository's existing test/build setup and adapt test commands to its actual tooling; do not invent a package manager or test runner if none exists.
- Before any Supabase change, use the Supabase skill and existing migration conventions.
- Use TDD for each implementation task: failing regression first, minimal implementation second, focused verification third.
- Use the verification-before-completion skill before claiming any task or the overall project is complete.
- Do not claim the local model is "running real" until Task 9 has a concrete model gateway and a successful end-to-end authenticated response.
