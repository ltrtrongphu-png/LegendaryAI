# Legendary Brain System Audit & Upgrade Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make LegendaryAI's native AI path truthful, task-oriented, faster, safer, and ready to use a real local model when one is configured, without exposing internal routing/self-check text to users.

**Architecture:** Keep the existing `ai-chat` Edge Function as the single text-AI gateway, but separate intent/routing from user-visible answer generation. The gateway will use a strict final-answer system prompt for configured local models and a deterministic native fallback for supported tasks; unsupported deep-generation requests will be reported honestly instead of fabricating reasoning. Preserve Shield, token accounting, caching, and model entitlements.

**Tech Stack:** Supabase Edge Functions (Deno/TypeScript), vanilla JavaScript frontend, GitHub Actions, PostgreSQL/Supabase.

**Spec:** User request in chat: audit and upgrade the entire AI system; local AI models may remain disabled; automatically deploy when Vercel rate limit clears through the existing GitHub→Vercel integration.

## Global Constraints

- Do not invent a text-model capability when no local/external text model is configured.
- Never expose chain-of-thought, internal intent/keyword/constraint analysis, or backend implementation details as the AI's answer.
- Preserve authentication, plan entitlements, token accounting, rate limiting, caching, and image-generation routing.
- Local AI remains optional; if configured, it must fail fast and fall back safely.
- No secrets may be committed to GitHub.
- Vercel deployment is not manually forced; pushes to `main` remain the source of truth and Vercel will deploy automatically when its rate limit clears.

## Review Focus

- Image prompts must not fall through to text reasoning.
- Normal greetings must be short and natural rather than a system-status dump.
- Code/writing/research requests must not receive fake "analysis" templates when no text model is active.
- Local-model timeouts must not stall a request for 90+ seconds.
- Token reservation/refund and entitlement checks must remain correct on cache hits, local-model failures, and native fallback.

---

### Task 1: Replace fake native answers with a truthful task router

**Files:**
- Create: `supabase/functions/ai-chat/brain.ts`
- Modify: `supabase/functions/ai-chat/index.ts`
- Test: `tests/brain-native-core.test.js`

**Interfaces:**
- Produces `detectIntent(text)`, `nativeAnswer(text, messages)`, and `buildModelSystemPrompt(basePrompt)` for the gateway.
- The gateway continues returning the existing JSON shape (`text`, model metadata, usage, performance, brain metadata).

- [ ] **Step 1: Write failing regression tests** for greeting, image, math, code, writing, and unsupported deep-generation requests.
- [ ] **Step 2: Run `node tests/brain-native-core.test.js` and verify it fails against the current fake-response behavior.
- [ ] **Step 3: Implement the new native core with direct user-facing answers and no internal-analysis text.
- [ ] **Step 4: Wire `ai-chat/index.ts` to the new core while preserving auth, Shield, cache, quotas, and model access.
- [ ] **Step 5: Run the routing regression and frontend syntax suite.
- [ ] **Step 6: Commit `feat: upgrade legendary native brain routing`.

### Task 2: Harden model execution and response quality

**Files:**
- Modify: `supabase/functions/ai-chat/index.ts`
- Modify: `js/ai-engine.js`
- Test: `tests/ai-engine-contract.test.js`

**Interfaces:**
- Local AI remains optional through `LEGENDARY_LOCAL_AI_URL`.
- Local inference uses a bounded timeout and a final-answer system prompt.
- Client retry behavior continues to avoid retrying 429/4xx errors.

- [ ] **Step 1: Add a regression test for timeout/retry contract and error payload handling.
- [ ] **Step 2: Run it and verify the current long-timeout contract fails the intended bound.
- [ ] **Step 3: Reduce local-model timeout to a bounded fast-fail window and keep one short retry only for transient 5xx/408/network failures.
- [ ] **Step 4: Add output budgets by intent and prevent internal-analysis leakage in the system prompt.
- [ ] **Step 5: Run all frontend and backend contract tests.
- [ ] **Step 6: Commit `perf: harden model execution and output budgets`.

### Task 3: Secure token RPCs and verify the AI database path

**Files:**
- Create: `supabase/migrations/20260927_harden_ai_token_rpc_grants.sql`

**Interfaces:**
- `ai-chat` Edge Function remains able to call `consume_tokens`, `finalize_tokens`, and `refund_tokens` through the privileged service role.
- Direct execution by `authenticated` users is removed.

- [ ] **Step 1: Verify current grants and function security-definer state.
- [ ] **Step 2: Apply a migration revoking public/authenticated execution and granting only the service role.
- [ ] **Step 3: Re-query grants and verify the Edge Function service-role path remains executable.
- [ ] **Step 4: Run Supabase security/performance advisors and record remaining findings.
- [ ] **Step 5: Commit `fix: harden AI token RPC permissions`.

### Task 4: CI and deployment readiness

**Files:**
- Modify: `.github/workflows/quality.yml`
- Modify: `tests/chat-routing.test.js`
- Create: `tests/brain-native-core.test.js`
- Create: `tests/ai-engine-contract.test.js`

- [ ] **Step 1: Add the new regression tests to CI.
- [ ] **Step 2: Run the complete local CI command set.
- [ ] **Step 3: Verify `main` contains the final changes and no temporary repair workflow remains.
- [ ] **Step 4: Commit `test: cover legendary brain contracts`.

### Task 5: Final verification

- [ ] **Step 1:** Re-check latest GitHub commit and status checks.
- [ ] **Step 2:** Re-check deployed Supabase `ai-chat` version and function health.
- [ ] **Step 3:** Verify Vercel rate-limit status if available; do not create a duplicate deployment while rate-limited.
- [ ] **Step 4:** Confirm that the GitHub→Vercel connection will automatically deploy the current `main` commit once Vercel accepts builds again.
