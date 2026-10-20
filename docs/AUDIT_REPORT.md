# LegendaryAI — Audit Report

- Repository: `ltrtrongphu-png/LegendaryAI`
- Baseline branch: `main`
- Audit date: 2026-10-20
- Baseline declared by prompt: 1.2.0
- Baseline `VERSION` observed on main: `1.1.3`
- Status: Phase 0 preliminary report; full audit and runtime verification remain in progress.

## 1. Executive summary

The repository contains a vanilla HTML/CSS/JavaScript frontend, Supabase Auth/Postgres/Storage, Supabase Edge Functions, a model registry, and MoMo payment functions. The code includes a native deterministic engine and conditional routing toward a configured local inference gateway. The existence of model-routing branches does not prove that a production local model is reachable or enabled.

No secret value is reproduced in this report. The browser Supabase publishable/anon key is present in `js/supabase-config.js`; this is intended to be public and must rely on RLS and least-privilege grants. Server-role and MoMo credentials must remain exclusively in server-side secrets.

This report records findings supported by the inspected files. Items marked “verify” require full repository/runtime/CI inspection and are not represented as proven vulnerabilities.

## 2. Actual flow (confirmed / partially confirmed)

1. **Authentication:** `js/account.js` initializes Supabase client from `js/supabase-config.js`, exposes session/user/profile helpers and calls Edge Functions for token reset, Owner actions and payments.
2. **Chat request:** `js/ai-engine.js` obtains an access token and posts chat payloads to `/functions/v1/ai-chat-v10`. The matching implementation exists at `supabase/functions/ai-chat-v10/index.ts`. A separate legacy-looking implementation also exists at `supabase/functions/ai-chat/index.ts`; verify whether that function is deployed or referenced anywhere before removing it.
3. **Routing:** `supabase/functions/ai-chat-v10/index.ts` loads the plan/model registry, routes to local or optional Hugging Face runtime, and has a Native Core path. `supabase/functions/local-model-health/index.ts` checks the configured Ollama-compatible gateway with a four-second timeout. Runtime availability remains unverified without the production secret and a live gateway test.
4. **Quota:** `supabase/schema.sql` defines `public.consume_tokens(integer, uuid, boolean)`, performs a conditional update and grants execution to `service_role`. The RPC uses a row update for atomic quota reservation; the guest semantics, refund path, concurrency behavior and service-role call sites require adversarial tests.
5. **Conversation sync:** `js/cloud-sync.js` on main uploads conversations, deletes message rows and inserts a replacement message set in separate requests. This is not atomic and can lose/temporarily remove cloud messages on interruption. PR #17 contains a different implementation using `sync_conversation` RPC and user-scoped local cache; review and test that change before merging.
6. **Payments:** `supabase/functions/momo-create-payment/index.ts` loads plan price from the server-side `plans` table, inserts a pending order, signs a MoMo create request and calls the configured endpoint. `supabase/functions/momo-ipn/index.ts` validates the partner code, required fields, HMAC signature, order and amount, then calls `finalize_momo_payment`. RPC definition, transaction/idempotency guarantees and current MoMo protocol compliance still need verification.
7. **Storage:** `supabase/schema.sql` creates a private `chat-attachments` bucket and user-folder policies. Retention/deletion jobs and export/account-deletion paths were not confirmed in the inspected snippets.

## 3. Findings by severity

### High — must resolve before claiming production-ready

- **Local model availability is conditional, not established.** `supabase/functions/local-model-health/index.ts` exists and checks `/api/tags`, but production gateway reachability and required model presence have not been tested. The function returns model names and uses a fixed fallback CORS origin for disallowed origins. The chat runtime in `supabase/functions/ai-chat-v10/index.ts` can fall back to Native Core after a local runtime failure; for requests that explicitly require model generation, this risks returning a native answer that users may mistake for model output. Add/verify model-presence checks, explicit unavailable/fallback UI state, gateway authentication where supported, CORS rejection and tests. Never describe the model as active until a live authenticated request succeeds.
- **Cloud sync can lose data during interruption or overlapping updates.** `js/cloud-sync.js` deletes a conversation's cloud messages and inserts the replacement set in separate requests. A failure between them can leave an incomplete conversation. Replace with a server-side atomic RPC or equivalent transaction and add concurrency/regression tests.
- **Owner provisioning has a legacy hard-coded email migration path.** An early section of `supabase/schema.sql` promotes a matching email to Owner, but a later `handle_new_user()` definition replaces the trigger function and creates new profiles with role `user`. The later definition appears to supersede the email-based behavior for future signups, while the earlier one-time update remains in the migration text. Simplify this only after verifying the production Owner account and recovery path; do not lock out the legitimate Owner.
- **CORS fallback may mask disallowed origins.** `supabase/functions/ai-chat/index.ts` responds with the production origin when a request Origin is not allowlisted rather than explicitly rejecting it. Browsers normally block the mismatched response, but explicit allowlist rejection is clearer and safer. Apply consistently across privileged Edge Functions and test configured `SITE_URL` behavior.

### Medium — correctness, consistency, or audit gaps

- **Version metadata is inconsistent.** `VERSION` on main is `1.1.3`, while `CHANGELOG.md` contains a `1.2.0` section. Reconcile versioning before publishing another release.
- **Duplicate chat function implementations create deployment ambiguity.** `js/ai-engine.js` calls `ai-chat-v10`, and `supabase/functions/ai-chat-v10/index.ts` exists; a separate `supabase/functions/ai-chat/index.ts` also exists. Establish whether the latter is deployed or used, and keep documentation aligned without changing the active frontend contract.
- **Plan limits are duplicated.** `supabase/schema.sql` has a default profile limit of 500,000 and a six-hour reset; `ai-chat/index.ts` declares Free 500,000/6h, Pro 2,000,000/12h and Legendary 6,000,000/18h. These values must be compared with the live `plans` table, Owner reset policy and UI catalog; there is no basis yet to silently replace the intended policy.
- **MoMo timeout and network failure handling need hardening.** The inspected create-payment flow calls `fetch` without an explicit timeout/abort signal and parses the response as JSON. Add bounded timeout, safe upstream error handling and tests while preserving the documented MoMo signing contract.
- **Policy and privacy artifacts were not confirmed.** The checked paths did not establish the existence of complete `/legal` pages, consent recording, data export/deletion or retention jobs. Search the full tree and add only features that are actually absent.
- **Tests and CI coverage not yet verified.** The attempted path `tests/ai-chat.test.js` was not found. This does not prove there are no tests; enumerate the repository tree and workflow files before making that claim.

### Low / maintainability

- Model marketing labels and plan feature flags are declared separately from the model registry and plan catalog. A single source of truth or contract tests would reduce drift.
- CORS, error responses and upstream fetch behavior differ across functions; consolidate shared safe helpers where compatible.
- Some client-side persistence operations catch and ignore sync errors. Preserve offline UX but surface sync status and avoid silent data-loss scenarios.

## 4. Documentation/code drift checklist

| Check | Evidence from inspected files | Status |
|---|---|---|
| `ai-chat` vs `ai-chat-v10` | Frontend calls `ai-chat-v10`; both `supabase/functions/ai-chat-v10/index.ts` and `supabase/functions/ai-chat/index.ts` exist | Verify whether legacy function is deployed/used |
| Version | `VERSION=1.1.3`; changelog includes 1.2.0 | Confirmed mismatch |
| Free quota | schema default 500,000 / 6h; Edge Function Free 500,000 / 6h | Partially aligned |
| Pro / Legendary windows | Edge Function declares 2M/12h and 6M/18h | Verify DB plans, UI and reset RPC |
| Secret handling | frontend config contains a publishable/anon key; MoMo and service-role secrets referenced in Edge Functions | Verify git history and deployed secrets; no secret rotation performed |
| Local model | `local-model-health` checks gateway `/api/tags`; chat can fall back to Native Core | Runtime readiness and fallback UX unverified |
| Payment idempotency | IPN calls `finalize_momo_payment` RPC | Must inspect RPC implementation and constraints |
| Policies / consent / deletion | not established by inspected files | Full-tree verification required |

## 5. Personal-data map (based on inspected code; retention/access must be verified)

| Data | Observed location / processing | Access and retention status |
|---|---|---|
| Email and auth identity | Supabase Auth; referenced by `profiles` trigger | Supabase Auth policies/configuration and retention not inspected |
| Display name/avatar | `profiles`, sourced from auth metadata | User profile select policy exists; write permissions need full grant review |
| Chat content and titles | `conversations`, `messages`; local browser storage in `js/cloud-sync.js` | User-scoped RLS policies exist; retention/deletion schedule not confirmed |
| Attachment names/content | message JSON and private Supabase Storage bucket | Folder-based storage policies exist; size/retention/deletion needs verification |
| Plan/token usage | `profiles`, plan catalog and token RPC | Service-role RPC path exists; usage log schema/retention needs verification |
| Payment order metadata | `orders`, MoMo create/IPN flow | User can select own orders per inspected policy; audit/refund lifecycle needs verification |
| IP / security logs | Not established by inspected snippets | Must inspect Edge Functions, Vercel/Supabase logs and retention settings |
| Memory | profile feature flag exists; actual memory storage/processing not yet traced | Do not claim retention or training behavior until verified |
| Third parties | Supabase; Vercel hosting; MoMo payment; Google/GitHub OAuth if enabled; optional self-hosted local inference gateway | Actual enabled providers and cross-border processing need configuration review |

## 6. Immediate next steps

1. Inspect the open PR #17 diff, CI results and migration/RPC changes before deciding whether to merge.
2. Enumerate all repository files and workflows; trace the full chat, quota/refund, payment and account lifecycle.
3. Add tests for token race/refund idempotency, MoMo signature/idempotency, RLS isolation, local-model health/fallback and atomic conversation sync.
4. Inspect current Vietnamese personal-data, consumer-protection, e-commerce and MoMo requirements from primary sources before drafting final legal language.
5. Produce a final `docs/AUDIT_REPORT.md` with verified line numbers, completed fixes, test results and manual actions after the audit and implementation phases.

## 7. Manual actions not performed

- No production secrets were changed or rotated.
- No database migration was applied to the production Supabase project by this report.
- No claim is made that a local model gateway is online.
- No legal placeholder (operator identity, tax/business number, address, support email or hotline) was invented.
- No force-push or history rewrite was performed.
