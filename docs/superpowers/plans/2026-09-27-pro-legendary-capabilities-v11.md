# Pro & Legendary Capability Architecture v11 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implement the approved v11 entitlement, reasoning, token, guest-continuity, Pro/Legendary capability, UI, observability, and production-verification changes without trusting client-supplied plan claims.

**Architecture:** Keep `profiles.plan` as the source of truth and derive a server-owned policy in shared Supabase Edge Function code. Route all AI requests through one entitlement-aware request path that clamps reasoning/model/capabilities, reserves tokens before model execution, refunds on post-reservation failure, and records feature metadata. Keep browser controls progressive and cosmetic: they reflect the effective server policy but never authorize access.

**Tech Stack:** Vanilla JavaScript/HTML/CSS, Supabase PostgreSQL + Edge Functions, existing localStorage/cloud-sync flow, existing native model/router infrastructure, Node-based existing tests, Vercel deployment.

**Spec:** `docs/superpowers/specs/2026-09-27-pro-legendary-capabilities-v11-design.md`

## Global Constraints

- Guest: 1,000 tokens per session; reasoning off.
- Free: 500,000 tokens, 6h reset, basic reasoning only/off at the request-control level, `LegendaryLite-1` default.
- Pro: 2,000,000 tokens, 12h reset, `deep` reasoning, `LegendaryPro-1` default.
- Legendary: 6,000,000 tokens, 18h reset, `deep_plus` reasoning, `LegendaryUltra-1` default.
- `profiles.plan` is authoritative; client payloads cannot grant a higher plan, model, reasoning level, or capability.
- Token reservations cover input/output/reasoning budget and are refunded after post-reservation errors.
- Guest requests must not invoke privileged authenticated token RPCs.
- Agent mode is Legendary-only and bounded to plan → supported native capabilities → self-check → summary; no arbitrary shell/browser execution.
- Guest conversation state merges idempotently into the authenticated account on sign-in/sign-up without overwriting an existing account conversation with the same ID.
- Core chat does not gain a paid-provider dependency and billing prices do not change.

## Review Focus

- Crafted lower-tier requests asking for Legendary models/reasoning/capabilities must be clamped or rejected server-side; test the model/reasoning/capability matrices.
- Token reservation failures must prevent any model call; test reservation failure and post-reservation refund paths.
- Guest requests must remain isolated from privileged RPCs while authenticated requests continue through the account debit path; test both paths.
- Guest-to-account history merge must be idempotent and collision-safe; test repeated merge and same-ID collision behavior.
- Agent exhaustion/unavailable-model cases must stop safely without crossing the tier boundary; test partial execution and allowed fallback behavior.

---

### Task 1: Server-Owned Tier Policy and Model/Reasoning Entitlements

**Files:**
- Create: `supabase/functions/_shared/entitlements.ts`
- Create: `tests/entitlements.test.mjs`
- Modify: `supabase/functions/ai-chat-v10/index.ts`
- Modify: `js/ai-engine.js`

**Interfaces:**
- Produces `getTierPolicy(plan): TierPolicy`, `resolveReasoning(plan, requested): ReasoningLevel`, `isCapabilityAllowed(policy, capability): boolean`, and `resolveModel(policy, requestedModel, feature): string`.
- `TierPolicy` exposes exact token window/reset/model/reasoning/capability data used by the Edge Function and browser display layer.

- [ ] **Step 1: Write failing policy tests** covering Guest/Free/Pro/Legendary token windows, reset periods, default models, reasoning levels, and representative Pro/Legendary capabilities.
- [ ] **Step 2: Run `node --test tests/entitlements.test.mjs` and verify the new policy functions fail to import/return the expected matrix.**
- [ ] **Step 3: Implement `entitlements.ts` with server-owned constants and pure resolution functions.** Never read plan/capability authority from request JSON.
- [ ] **Step 4: Add tests for lower-tier model requests and `deep_plus`/Legendary-only capability requests.** Assert Pro cannot resolve Legendary models and non-Legendary cannot enable agent mode.
- [ ] **Step 5: Wire `ai-chat-v10` to resolve the authenticated profile plan and use the policy for model/reasoning/capability decisions.**
- [ ] **Step 6: Export an equivalent lightweight policy surface from `js/ai-engine.js` for UI state only; document that it is not authorization.**
- [ ] **Step 7: Run the entitlement tests and existing chat-routing tests.**
- [ ] **Step 8: Commit with `feat: add server-owned v11 tier policy`.**

### Task 2: Token Reservation, Refund, and Usage Observability

**Files:**
- Create: `supabase/migrations/20260927_pro_legendary_usage_policy.sql`
- Modify: `supabase/schema.sql`
- Modify: `supabase/functions/_shared/entitlements.ts`
- Modify: `supabase/functions/ai-chat-v10/index.ts`
- Create: `tests/token-accounting-v11.test.mjs`

**Interfaces:**
- Produces an authenticated reservation/refund flow that returns a reservation ID and reserved amount before model execution, plus an idempotent refund operation.
- Usage metadata records reasoning level, capability set, selected route, and agent/workflow marker without prompt content.

- [ ] **Step 1: Write failing SQL-policy/unit tests for exact token limits/reset windows and reservation/refund invariants.**
- [ ] **Step 2: Run the tests and verify failure against the current accounting behavior.**
- [ ] **Step 3: Add the migration to extend usage metadata and implement the smallest server-side reservation/refund helpers required by the existing schema/RPC conventions.**
- [ ] **Step 4: Update `supabase/schema.sql` to mirror the migration.**
- [ ] **Step 5: Integrate reservation-before-model-call into `ai-chat-v10`; on reservation failure return a structured error without calling the model; on post-reservation error refund exactly once.**
- [ ] **Step 6: Add tests proving a reservation failure prevents model execution and a post-reservation failure restores the reserved balance.**
- [ ] **Step 7: Run token/accounting tests plus existing tests.**
- [ ] **Step 8: Commit with `feat: harden v11 token accounting`.**

### Task 3: Guest 1K Limit and Guest-to-Account Conversation Merge

**Files:**
- Modify: `js/chat.js`
- Modify: `js/cloud-sync.js`
- Modify: `js/account.js`
- Create: `tests/guest-continuity.test.mjs`
- Modify: `supabase/functions/ai-chat-v10/index.ts`

**Interfaces:**
- Produces `getGuestTokenBudget()`/equivalent local budget state capped at 1,000 tokens per session.
- Produces an idempotent guest-history merge invoked after successful authentication, preserving existing account conversations on ID collision.

- [ ] **Step 1: Write failing tests for guest 1K enforcement, no privileged RPC for guests, idempotent merge, and collision-safe account history.**
- [ ] **Step 2: Run `node --test tests/guest-continuity.test.mjs` and verify failure.**
- [ ] **Step 3: Implement the local guest budget guard and reset-on-new-session semantics in `js/chat.js`.**
- [ ] **Step 4: Implement the merge operation in `js/cloud-sync.js` and invoke it once after authenticated session restoration in `js/account.js`.**
- [ ] **Step 5: Add the server-side guest branch so unauthenticated calls cannot reach authenticated token RPCs.**
- [ ] **Step 6: Run guest continuity tests and existing chat-routing tests.**
- [ ] **Step 7: Commit with `feat: enforce guest budget and merge history`.**

### Task 4: Pro Capability Surfaces and Reasoning Control

**Files:**
- Modify: `js/chat.js`
- Modify: `js/power-suite.js`
- Modify: `js/ai-engine.js`
- Modify: `index.html`
- Modify: `css/*.css` (only the existing chat/composer stylesheet that owns these controls)
- Create: `tests/capability-ui.test.mjs`

**Interfaces:**
- Produces one visible `Suy luận` control with effective-state rendering: Free/Guest disabled/upgrade, Pro `deep`, Legendary `deep_plus`.
- Produces progressive Pro controls for project workspace, file/image analysis, memory, code review/refactor/test generation, Prompt Studio, advanced export, priority routing, and context optimizer.

- [ ] **Step 1: Write failing DOM/state tests for reasoning labels, disabled Free/Guest state, Pro feature visibility, and non-authoritative client behavior.**
- [ ] **Step 2: Run the UI tests and verify failure.**
- [ ] **Step 3: Add the reasoning control beside the composer and bind it to effective policy state rather than a freely editable plan string.**
- [ ] **Step 4: Add progressive Pro capability controls and upgrade affordances without changing the existing chat layout/visual identity.**
- [ ] **Step 5: Ensure the client request includes only the requested feature/mode; server resolution remains authoritative.**
- [ ] **Step 6: Run capability UI tests plus existing browser/chat routing tests.**
- [ ] **Step 7: Commit with `feat: add progressive Pro reasoning and capability UI`.**

### Task 5: Legendary Agent, Project Brain, Multimodal, and Expert Workflows

**Files:**
- Create: `js/legendary-workflows.js`
- Modify: `js/chat.js`
- Modify: `js/power-suite.js`
- Modify: `index.html`
- Modify: `css/*.css` (existing chat/composer stylesheet)
- Modify: `supabase/functions/ai-chat-v10/index.ts`
- Create: `tests/legendary-workflows.test.mjs`

**Interfaces:**
- Produces `runLegendaryWorkflow(request, policy)` as a bounded orchestration helper returning `{status, summary, answer, steps}`.
- Produces Legendary-only UI for Agent Mode, Project Brain, long-context synthesis, batch tasks, expert modes, self-check, and custom workflow controls.

- [ ] **Step 1: Write failing tests for Legendary-only agent access, bounded plan/execute/verify sequencing, expert-mode mapping, self-check activation, and safe exhaustion behavior.**
- [ ] **Step 2: Run `node --test tests/legendary-workflows.test.mjs` and verify failure.**
- [ ] **Step 3: Implement `js/legendary-workflows.js` as a deterministic orchestration layer over supported native capabilities; do not expose shell/browser execution.**
- [ ] **Step 4: Integrate server-side capability validation and workflow metadata into `ai-chat-v10`.**
- [ ] **Step 5: Add Legendary UI controls and compact execution summary rendering.**
- [ ] **Step 6: Add tests for unavailable-model fallback restricted to allowed models and for token exhaustion producing a partial summary.**
- [ ] **Step 7: Run Legendary workflow tests and all existing tests.**
- [ ] **Step 8: Commit with `feat: add Legendary bounded workflows`.**

### Task 6: End-to-End Tier Integration and Regression Coverage

**Files:**
- Modify: `tests/chat-routing.test.js`
- Modify: `tests/brain-native-core.test.mjs`
- Create: `tests/v11-integration.test.mjs`
- Modify: `README.md` (only if current documented limits are stale)

**Interfaces:**
- Produces a deterministic integration matrix covering Guest/Free/Pro/Legendary request routing, reasoning clamping, model authorization, token policy, guest continuity, and capability rejection.

- [ ] **Step 1: Write failing integration tests for one valid request per tier plus crafted cross-tier requests.**
- [ ] **Step 2: Run the integration suite and record the expected failures.**
- [ ] **Step 3: Update routing/core tests to assert the new effective model and reasoning behavior.**
- [ ] **Step 4: Implement only integration glue needed to make all v11 tests pass; do not add duplicate authorization logic outside the shared policy.**
- [ ] **Step 5: Run the complete Node test suite and static syntax checks.**
- [ ] **Step 6: Commit with `test: cover v11 tier integration`.**

### Task 7: Supabase Migration and Production Deployment Verification

**Files:**
- Modify: `supabase/migrations/20260927_pro_legendary_usage_policy.sql` if verification requires a safe correction.
- Modify: `vercel.json` only if deployment configuration must expose the existing frontend correctly.
- Modify: `CHANGELOG.md` with the shipped v11 capability summary.

**Interfaces:**
- Produces a production-ready branch with schema/function/frontend changes deployed in dependency order and verified through Vercel/Supabase health checks.

- [ ] **Step 1: Apply the migration to the connected Supabase project using the migration tooling; verify the target columns/functions exist and existing data is preserved.**
- [ ] **Step 2: Deploy the updated Edge Function(s) and verify their health with authenticated and unauthenticated smoke requests.**
- [ ] **Step 3: Deploy the Vercel frontend from the implementation branch and wait for a Ready production deployment.**
- [ ] **Step 4: Run browser verification against the production URL: composer `Suy luận`, tier-gated controls, guest 1K behavior, account history merge UI, Pro/Legendary controls, and normal Free chat.**
- [ ] **Step 5: Inspect Supabase/Vercel logs for RPC ambiguity, permission-denied errors, failed reservations, or model-routing violations.**
- [ ] **Step 6: Run final test suite and compare production behavior against the v11 spec.**
- [ ] **Step 7: Commit any verification-only corrections and update `CHANGELOG.md`.**
- [ ] **Step 8: Push the branch and create/merge the production change according to the connected Vercel/GitHub project workflow.**

## Execution Order

Tasks 1 → 2 → 3 → 4 → 5 → 6 → 7. Tasks 1 and 2 establish the security/accounting contract used by every later task; UI work must not precede those contracts. Production deployment happens only after the full local test matrix passes.
