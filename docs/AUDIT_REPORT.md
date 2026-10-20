# LegendaryAI — Audit report (consolidated)

**Audit date:** 2026-10-20  
**Release candidate:** 1.3.3  
**Repository:** `ltrtrongphu-png/LegendaryAI`  
**Status:** automated code, database-fixture and browser checks have been added across the hardening series; this report does not claim production readiness. Hosted production deployment/configuration, live secrets, migration on the connected Supabase project, MoMo merchant sandbox, and live inference remain unverified.

## 1. Executive summary

This report consolidates the repo-level findings and later follow-up phases. PR #20–#22 have been merged; each phase adds verification while separating disposable CI evidence from hosted production validation. Material code issues discovered and addressed include:

- CORS helpers on chat, payment, model-health and privileged endpoints emitted a production origin for callers whose `Origin` was not allowlisted. The affected handlers now reject a supplied non-allowlisted origin and only return `Access-Control-Allow-Origin` for configured origins.
- The deprecated `ai-chat-v9` endpoint retained a weaker CORS implementation. It now returns HTTP 410 and does not invoke a model provider or mutate quota.
- Local inference did not require a gateway bearer token and a caller selecting a local model could get a Native Core fallback under the wrong selected-model label. The new active route requires `LEGENDARY_LOCAL_AI_TOKEN`; an explicitly selected local model fails closed on unavailability. Paid checkout also checks the selected model’s authenticated `/api/tags` readiness before creating an order.
- The MoMo IPN called a missing `finalize_momo_payment` RPC; that meant a signed callback could fail to transition an order to paid. A forward migration now defines a row-locked/idempotent finalizer and the missing order expiry column, binding the stored order to request ID, transaction ID and plan/user data.
- Token refunds did not have request-scoped idempotency. The new migration adds a refund ledger and a service-role-only overload; the legacy chat settlement path also uses an explicit-user service-role RPC.
- The schema contained email-based Owner bootstrap logic. New schema installs no longer grant Owner by matching an email; existing role assignments are preserved. Granting Owner must be an explicit trusted database administration action using a verified UUID.
- The image flow used an external OpenAI image route, contrary to the product’s stated deployment invariant. Image generation is now explicitly disabled until a supported self-hosted provider is configured and tested.
- Added policy consent persistence, account-data export/deletion endpoint, a support-ticket intake endpoint, a configurable retention cleanup function (disabled by default), policy pages/routes and operator-facing checklists.

**Important limitation:** source-level checks and CI have been added, but the repository connector did not provide a confirmed green CI run for the latest PR head during this pass. A live Supabase environment, RLS adversarial tests with different database roles, MoMo sandbox, a real local model request and production deployment have not been verified. Do not merge or deploy until the latest PR checks are demonstrably green and the migration has been reviewed.

## 2. Actual request / data flows

### 2.1 Chat and quota

1. Browser modules (`js/chat.js`, `js/account.js`, `js/supabase-config.js`) prepare the message and the current Supabase Auth access token.
2. The active endpoint is `supabase/functions/ai-chat-v10/index.ts`; `js/chat.js` calls `/functions/v1/ai-chat-v10`. It checks origin, verifies the user, reads the user profile and plan, applies reset-window/plan rules, and reads the model registry.
3. The token reserve is made via the server-side `consume_tokens` RPC using a service-role client. The active path calculates a request budget and caps local generation to the remaining budget.
4. Routing can use Native Core (`supabase/functions/ai-chat-v10/brain-core.js` and `cognitive-core.js`), an Ollama-compatible private gateway, or the configured Hugging Face Space adapter (`huggingface-space.ts`, `model-runtime.ts`). Native Core is orchestration/logic and is not proof that a foundation LLM ran.
5. For a caller who explicitly selected an Ollama-compatible model, gateway failures now fail closed and trigger request-scoped refund instead of being presented as a response from the selected model. General routing/fallback still must be verified by a live model/runtime contract test.
6. Token usage and route/failure details are stored in the existing profile/usage structures. Request-scoped refund calls now use the new RPC overload and ledger in `20261020120000_legal_payment_retention_hardening.sql`.
7. Cloud conversation sync uses the existing conversation sync RPC/migration and user ownership rules; local cache remains in the browser storage keys documented in `/cookies`.

The old `supabase/functions/ai-chat/index.ts` remains as a compatibility path but its quota finalization was changed to `finalize_tokens_for_user`, with explicit user ID and service-role-only execute privilege. The old `ai-chat-v9` endpoint returns 410.

### 2.2 MoMo payment

1. `momo-create-payment/index.ts` validates the caller, fetches the plan and amount from the server-side `plans` row, checks that the plan’s model is enabled, checks self-hosted gateway readiness where applicable, generates an order/request ID, and stores a pending order before calling MoMo.
2. It requires an explicitly configured `MOMO_ENDPOINT`; it no longer silently falls back to the MoMo test endpoint. Provider calls have a timeout. A timeout keeps the order pending for reconciliation because the provider may have accepted the request.
3. `momo-ipn/index.ts` validates HMAC-SHA256, partner/order/amount/request ID and binds a successful callback to the stored user/plan metadata and transaction ID.
4. `finalize_momo_payment` in the new migration locks the order row, checks the request and transaction identifiers, handles duplicate callbacks idempotently, updates the order and plan/expiry in one database transaction, and is executable only by `service_role`.
5. `/payment-result` does not trust URL parameters as proof of payment; it requires the user’s session and queries `account-data` for the order owned by that user. The page does not sign the user out.

The actual MoMo merchant account, live endpoint, callback URL reachability, signature test vectors, transaction reconciliation and production configuration still need operator verification.

### 2.3 Auth, consent, export and deletion

- Email signup stores `legal_consent` metadata; a Supabase Auth trigger records terms/privacy policy versions in `user_consents`. OAuth flow stores a pending version in sessionStorage and writes consent after login.
- `account-data` verifies the current Supabase user from the bearer token. It supports policy-consent writes, owner-scoped payment-status lookup, JSON export of core user data and private-attachment signed URLs, plus password-reauthenticated account deletion.
- Deletion refuses while an order is pending, removes the Auth user, then attempts storage cleanup. A cleanup error is explicitly returned for manual follow-up. Orders/consent evidence can be retained without a direct user link only where the deployed schema/migration and law allow it.
- `support-request` validates input and saves an inquiry to `support_requests`; it does **not** send an email. Rate limiting on this endpoint is in-memory and is not a distributed rate limiter.

## 3. Findings and disposition

Effort: S = small, M = medium, L = large. “Fixed in PR” means the code path was changed in this branch; it does not mean the change has been deployed to production.

| Severity | Finding | Disposition | Effort |
|---|---|---|---|
| High | CORS fallback could return a fixed production `Access-Control-Allow-Origin` for unapproved origins. | Fixed across active/legacy chat, model health, Owner, token reset, payment create and image endpoint; supplied disallowed origins return 403. MoMo IPN is server-to-server and uses signature verification. | M |
| High | Selected local model could be unavailable or unauthenticated while the route reported a fallback answer as though the selected model ran. | Active path now requires gateway bearer token, no retry on HTTP 429, fails closed for explicit local selection; payment creation checks gateway/model readiness. Live request still required. | M |
| High | `momo-ipn` called a missing `finalize_momo_payment` database RPC, and finalizer required an `orders.expires_at` column that was absent from the schema snapshot. | Added idempotent/row-locked finalizer and idempotent `expires_at` column in forward migration; needs staging application and callback tests. | L |
| High | Token refund RPC lacked request-scoped idempotency. The legacy `ai-chat` quota-finalization RPC relied on `auth.uid()` despite using a service-role client. | Added `token_refunds` ledger, service-role-only four-argument `refund_tokens`, and explicit-user `finalize_tokens_for_user`; updated Edge Functions. Needs concurrent tests on PostgreSQL. | L |
| High | Owner bootstrap was based on a hard-coded email value in the schema. | Removed email-matching escalation from schema snapshot. Existing production roles are untouched; verify the intended Owner UUID before applying schema/migrations. | S |
| High | External OpenAI image route contradicted the self-hosted/no-external-provider requirement. | Browser flow and `image-generate` endpoint fail closed with a clear disabled status until a self-hosted provider is approved/tested. | S |
| Medium | No first-party user data export/deletion, versioned consent ledger, ticket intake or configurable retention mechanism was confirmed in the earlier baseline. | Added `account-data`, `user_consents`, `support_requests`, `retention_settings`, export/delete UI and cleanup function. Retention is disabled by default; scheduler is not configured. | L |
| Medium | Policy claims could overstate current inference, image, web search, payment renewal or data retention. | README/policy drafts document current limitations and avoid claiming automatic renewal, automatic refunds, verified model readiness or active retention without proof. | M |
| Medium | Legacy chat v9 could remain directly callable. | Endpoint retired with HTTP 410; its JWT config and Deno check are included. | S |
| Medium | Repository instructions did not describe local environment setup, security reporting or contribution workflow. | Added `.env.example`, `.gitignore`, `SECURITY.md`, `CONTRIBUTING.md`, operational README sections and secret scanning CI. | M |
| Medium | AI image intent incorrectly classified Vietnamese “hình thành” as image generation. | Fixed classifier and regression coverage in `js/chat.js` and `tests/image-intent.test.js`. | S |
| Medium | RLS policy expressions could repeatedly evaluate `auth.uid()`; schema had overly broad Owner initialization behavior. | Converted ownership conditions to `(select auth.uid())` where updated and restated key RLS policies. Must still be verified under real anon/user A/user B/Owner/service_role sessions. | M |
| Low | Local browser cache may contain conversation metadata and stale unsynced messages. | Documented storage keys and deletion behavior; existing sync/cache behavior still needs realistic multi-tab/offline conflict tests. | M |
| Low | Support endpoint rate limiting is instance-local and there is no automated response email. | Clearly disclosed; use a distributed limiter/email provider only after an operator chooses and configures one. | M |
| Low | Live streaming, comprehensive Playwright e2e and external service smoke tests are not provided by this change. | Recorded as outstanding; not claimed as implemented. | L |

## 4. Documentation vs. code

| Topic | Code/source of truth | Public wording in this branch |
|---|---|---|
| Active chat function | `js/chat.js` → `ai-chat-v10`; `ai-chat` is legacy compatibility; `ai-chat-v9` returns 410. | README names all three statuses. |
| Guest quota | Guest session handling in active chat and schema defaults; intended 1,000 tokens/session. | Token policy calls this a session quota rather than a six-hour user window. |
| Free | Schema defaults to 500,000 tokens / 6h. | README and token policy use 500,000 / 6h. |
| Pro | Schema defaults to 2,000,000 tokens / 12h; seeded price 149,000 VND/month. | Documented as seeded defaults; production `plans` row may differ. |
| Legendary | Schema defaults to 6,000,000 tokens / 18h; seeded price 399,000 VND/month. | Documented as seeded defaults; production `plans` row may differ. |
| Manual reset | RPC logic: Pro once/month; Legendary/Owner once/7 days. | Documented with that cadence. |
| Inference provider | Native Core + configured self-hosted Ollama-compatible gateway and optional HF Space route. | Aliases disclose the likely origin model and expressly do not claim the provider is currently alive. |
| Image generation | Not offered until a self-hosted provider is configured. | UI/endpoint/policy state that it is disabled and do not send prompt to the previous external image route. |
| Web search | Must have a real provider and verified configuration before the feature can be claimed. | Not claimed as available without verification. |
| Payments | Server-side price; MoMo one-time create/IPN; no renewal job or automatic refund API was confirmed. | No automatic renewal/automatic refund promise. Pending and failed orders require reconciliation. |
| Data retention | New retention config is disabled with `retention_days = NULL`; no scheduler is deployed. | Privacy policy explicitly says retention period and scheduled cleanup are not active until configured. |
| External secrets | Server-side Supabase/MoMo/gateway secrets are required, and the browser Supabase publishable key is not a service-role secret. | README/.env.example separates public browser config from server-only secrets. |

## 5. Personal data inventory

This matrix distinguishes confirmed application paths from hosting/provider details that must be verified in the provider dashboards and agreements.

| Category | Purpose | Where stored/processed | Access | Retention known? | Third parties / notes |
|---|---|---|---|---|---|
| Email, Auth user ID, signup/OAuth metadata | Authentication, account recovery, profile | Supabase Auth; `profiles` | User via auth; privileged service role | Not fully specified by this repository | Supabase; Google/GitHub only if enabled by deployment |
| Password | Auth credential | Supabase Auth (not application tables) | Auth service; application code does not need plaintext password except one-time re-auth request for account deletion | Governed by Supabase account policy; verify provider | Supabase; never log it |
| Conversation titles/messages | Chat, history, sync | Browser localStorage/cache; Supabase `conversations`/`messages` | User-owned records via RLS and authorized Edge Functions | No app-level chat retention schedule enabled | Supabase; prompt/context can be sent to configured inference provider |
| Image/file attachments | Vision/chat feature | Private `chat-attachments` Storage and message metadata | Owner path policy/service role; signed URLs expire after 5 minutes on export | No cleanup schedule enabled by default | Supabase Storage; contents may be sent to configured inference provider when feature is used |
| Memory | User-personalized responses | Supabase `ai_memories` and/or configured client path | User ownership policy and server functions | No retention period configured | Supabase; check deployed capability configuration |
| Token balance/usage/route logs | Quota, billing integrity, diagnostics | `profiles`, `ai_usage_logs`, refund ledger | User may read allowed own usage fields; mutations are server-side | No usage-log retention period configured | Supabase; keep logs free of prompt content/PII |
| Payment/order data | Purchase, reconciliation, plan lifecycle | `orders`/profile; MoMo receives transaction fields | User can read own order; service role and merchant process callbacks | Transaction retention period not decided here | MoMo and Supabase; IPN must not log keys |
| Consent evidence | Evidence of policy/version acceptance | `user_consents` | Service role only in database; user can request export | Retention duration requires legal/operator decision | No raw IP is collected by this new consent flow; `ip_hash` is null |
| Support/privacy/abuse ticket | Respond to user request | `support_requests` | Service role/Owner operations only; form returns ticket ID | Cleanup configurable but off by default | Supabase; email reply not configured |
| IP and connection metadata | Platform operations/security, if collected by provider | HTTP/CDN/hosting/edge logs depending on deployment | Provider/operator according to service settings | Not knowable from repo; verify dashboards/contracts | Vercel, Supabase and possibly other infrastructure |
| Model prompts/context | Generate an answer | Sent to the provider selected by backend route | Backend and inference provider | Gateway/Space logging settings are not verified | Ollama-compatible self-hosted gateway, HF Space if enabled; do not promise non-retention without checking their configuration |
| Browser settings/cache | UI preferences, active chat, local history and sync state | localStorage/sessionStorage; Supabase Auth SDK session storage depends on SDK configuration | Local device/browser profile | Until site data/session cleared or browser evicts it | No separate app analytics/advertising cookie was verified in the code inspected; external SDK/platform behavior still needs provider review |

## 6. Security/configuration properties

- RLS is enabled in the schema snapshot for `profiles`, `conversations`, `messages`, `orders`, `ai_models`, `ai_memories`, `ai_usage_logs` and `plans`. New policy/ledger tables in the migration also enable RLS and revoke client-table grants.
- The `ai_models` registry exposes enabled rows to regular callers, and Owner-write policy checks the role in the database. Edge Function Owner checks also need role tests.
- `consume_tokens`, new request-scoped `refund_tokens`, MoMo finalization, consent data and the new legacy settlement RPC are intended for service role only. The old non-idempotent `refund_tokens(integer, uuid)` overload is disabled in the forward migration.
- `SITE_URL` is added as an explicit origin. A wildcard or default origin is not emitted for a non-allowlisted request.
- `.env.example` contains blanks only; `.gitignore` excludes local environment files. The secret scanner covers high-confidence common patterns in the worktree and supports scanning fetched Git history with `--history`.
- `vercel.json` and existing headers/CSP should still be reviewed in a real browser for script/connect policy compatibility.
- The image endpoint returns 503 and the deprecated chat v9 endpoint returns 410.
- Do not enable retention cleanup until days and legal basis are approved. Configure a protected scheduler separately; code in Git does not create that scheduler.

## 7. Verification status

### Added checks in CI
- Existing routing, image-intent, cognitive core, Native Core, model runtime contract tests.
- New CORS, security-hardening, legal routes/consent and secret-scan tests.
- Deno type checks for active/legacy chat, model health, MoMo, Owner/token reset, account data, support, retention cleanup and disabled image endpoint.

### Not yet proven
- **Merged baseline verification:** PR #20 was squash-merged to `main` as `f69cf8a08b0749bfec743fcb5eed25bdfb45808f`. Post-merge GitHub Actions runs `39430069649` (CI) and `39430069928` (quality) were successful. This does not prove hosted database/runtime integrations.
- **Database:** migration not applied to hosted Supabase; SQL has not been executed against a clean local/staging PostgreSQL instance in this pass.
- **RLS adversarial tests:** no live tests using anon, user A, user B, Owner and service_role sessions.
- **Tokens:** no concurrent reserve/settle/refund load test to empirically prove no negative balances/double spend.
- **MoMo:** no live/sandbox transaction with valid/invalid HMAC, duplicate IPN, request/amount mismatch, delayed callback, or reconciliation was run.
- **Inference:** no confirmed live `LEGENDARY_LOCAL_AI_URL` / `LEGENDARY_LOCAL_AI_TOKEN`, `/api/tags` check, and real authenticated completion. No claim is made that the local model is active.
- **Frontend UX/a11y/performance:** no Playwright run, keyboard/mobile regression, Lighthouse score or reduced-motion/WebGL device test was completed here.
- **Secret history scan:** CI is configured to run it; no successful output for the latest branch head has been confirmed here.
- **Policy approval:** pages are drafts pending legal review and completion of operator details.

## 8. Rollback and deployment safeguards

1. Review the migration carefully in version control; back up the database and apply it to staging first.
2. The migration changes the token refund contract and disables the legacy two-argument refund RPC. To roll back app behavior, deploy compatible Edge Function code before any database rollback. Do not drop consent, transaction or audit tables as a shortcut; preserve their data.
3. Confirm the existing Owner account by verified Auth UUID and preserve its current assignment; the removed email bootstrap does not automatically elevate a new user.
4. Run SQL checks for all policies and grants under each test role before production.
5. Test MoMo end-to-end in the merchant sandbox and verify transaction reconciliation. Keep payment checkout disabled if the default model/gateway is not ready.
6. Install `SITE_URL`, Supabase server secrets, explicit MoMo endpoint/merchant secrets and (if using local inference) gateway URL/token through the provider dashboard. Rotate any key found exposed by a secret-history scan; do not force-push/rewrite history without a separately approved incident plan.
7. Approve retention periods, set `retention_settings`, then configure and test a protected scheduler before enabling deletion rules.
8. Fill in operator identity/tax/address/contact/SLA placeholders and obtain qualified legal review before publishing policies or collecting paid subscriptions.

## 9. Legal/source notes (checked 2026-10-20)

- Vietnam Law No. 91/2025/QH15 on Personal Data Protection, official Government legal database: https://vanban.chinhphu.vn/?classid=1&docid=214590&pageid=27160&typegroup= . The official record lists the law as effective 2026-01-01. Counsel should check implementing texts and transitional provisions.
- Ministry of Industry and Trade publication on the Law on E-Commerce and Government Decree No. 248/2026/ND-CP: https://moit.gov.vn/en/news/ministry-of-industry-and-trade-disseminates-the-law-on-e-commerce-and-government-decree-no.-248-2026-nd-cp.html . Applicability to this particular service/payment model must be determined by counsel.
- MoMo Developers: “Initiate Transaction” and “One-Time Payments”: https://developers.momo.vn/v3/vi/docs/payment/api/payment-api/init/ and https://developers.momo.vn/v3/vi/docs/payment/api/wallet/onetime/ . These cover the initiation request, request ID, amount bounds and HMAC signing; confirm the exact merchant environment/contract before production.

## 10. Remaining operator actions

- [x] Consolidated security/payment/privacy release was squash-merged as PR #20. PR #19 was closed as superseded; it is not a pending deployment item.
- [ ] Apply the forward migration to staging; run the SQL/RLS/token/payment adversarial test set, review rollback and then schedule production application.
- [ ] Set/verify Supabase and Vercel secrets; confirm that no actual credentials remain exposed in Git history. Rotate any exposed real secret found by the scan.
- [ ] Confirm Owner by Auth UUID.
- [ ] Configure and test a live local-model gateway before enabling any paid model profile.
- [ ] Confirm MoMo merchant setup, production callback URL and refund/reconciliation operations.
- [ ] Decide retention windows and any model-improvement/training use; do not infer consent for secondary uses.
- [ ] Fill all legal placeholders and approve policies with qualified counsel.
- [ ] Configure monitored support response workflow, retention scheduler and post-deploy smoke checks.



## 11. Follow-up verification addendum (2026-10-20)

PR #20 and the Phase 3 hardening in PR #21 have been merged to `main`; CI and quality checks passed for the relevant PR head. This addendum records the engineering changes, while physical-device profiling remains outstanding.

- MoMo payment creation and IPN now use one shared canonical-signature implementation so their string construction and constant-work hex comparison can be tested without invoking a provider. Deterministic HMAC vectors are added at `tests/momo-signature.test.mjs`. Source reference checked: MoMo Developers, “Digital Signature” and payment-init/IPN documentation. The merchant’s exact configured API version and sandbox flow still require an end-to-end test.
- `js/bg3d.js` now uses a smaller static scene for `prefers-reduced-motion` and detected low-resource devices, pauses animation when the document is hidden, and disposes GPU resources/context on `pagehide`. Static source tests are in `tests/bg3d-runtime.test.mjs`; real device profiling remains outstanding.
- `tests/e2e-smoke.mjs` adds Chromium/Playwright smoke coverage for the app shell, `/new`, `/chat/:slug`, and all policy routes using a local rewrite-compatible test server. The new `browser-smoke` workflow job must pass on this branch before it can be merged.

Still not proven in this pass: migration execution on a clean Supabase/PostgreSQL instance, adversarial RLS tests for anon/user A/user B/Owner/service_role, concurrent token reservation/settlement/refund, duplicate and delayed MoMo IPNs against a test database, hosted secrets and model health, mobile keyboard/accessibility/Lighthouse metrics, and production retention scheduling. These require local Docker/Postgres/Supabase or operator-owned provider credentials and must not be represented as completed based only on static tests.


## 12. Frontend and sync follow-up (2026-10-20)

The follow-up PR also hardens user-controlled content and local/cloud synchronization:
- Shared HTML escaping now covers both quote characters; image attachment sources are limited to raster base64 data URLs and HTTPS URLs without embedded credentials.
- Attachment size/count/aggregate payload budgets are checked before and during reading, and ZIP entry declared expansion size is checked before decompression. The payload-size exception is displayed without leaving the send controls locked.
- Chat requests are aborted on conversation navigation, clear/delete and authentication changes; late results/errors from an older request cannot update the active view or unlock a newer request.
- Conversation updatedAt is advanced for ordinary message changes, AI completion, title rename, regeneration and clear. Cloud reads have a sequence guard; per-user sync uses a queued single-flight lock, and conflicting local/cloud conversation bodies are retained as separately labeled local-only copies instead of silently discarding one side.
- CI tests cover the core contracts in tests/chat-security.test.mjs and tests/cloud-sync-runtime.test.mjs; the Playwright smoke test covers application-shell/deep-link/policy-route rendering only. An in-memory Supabase contract simulator in tests/cloud-sync-integration.test.mjs exercises a newer cloud revision conflict, separate preservation of both bodies, offline-only conversation upload, reload persistence and a later deliberate local edit. It is not a real PostgreSQL/RLS test.

Remaining limitation: these sync/browser checks are contract/static regressions, not multi-tab stress tests or authenticated tests against a staged database. Provider, database, legal-operator and retention actions in section 10 remain open and require the operator environment.


## 13. PostgreSQL CI validation added (2026-10-20)

A follow-up inspection found invalid single-dollar delimiters in three functions in `supabase/schema.sql` (`consume_tokens`, the retired legacy `refund_tokens` overload, and `finalize_tokens`). Those delimiters have been corrected to valid `$` blocks. The first PostgreSQL 17 run then exposed an invalid escaped JSON default for `plans.model_tiers`; that is now corrected as a native SQL JSON literal too. The same follow-up also guards against a late MoMo initiate failure response downgrading an order already paid by an IPN. A PostgreSQL 17 GitHub Actions job now initializes only a disposable fixture for the minimum `auth`/`storage` interfaces, executes `supabase/schema.sql` from an empty database, applies the latest hardening migration, then tests RLS isolation between user A/user B, direct-client denial of privileged quota RPCs, cumulative/idempotent refunds, MoMo finalization/idempotency, and a concurrent token-reservation race. On PR #22, PostgreSQL 17 CI passed clean schema execution, the latest hardening migration, RLS/user-isolation checks, cumulative refund idempotency, MoMo finalization/idempotency, and the concurrent quota reservation race. The fixture is disposable PostgreSQL with minimal Supabase-compatible auth/storage objects, not a live Supabase migration or MoMo-provider test.


## 14. Quota/cache follow-up (2026-10-20)

The next code phase closes an application-level quota bypass where Native Core/fallback responses and cached replies did not call the atomic token-reservation RPC. Cache entries are now keyed by authenticated user, cache-hit estimated input/output tokens are charged and logged, fresh requests reserve budget before any route, native output is capped to the reserved budget, and all routes settle estimates consistently. Independent user/IP rate-limit buckets replace the prior combined `userId:IP` bucket, and explicit memory insertion is moved to after a usable response and quota settlement with exact-duplicate and credential-pattern checks. These are automated contract tests, not a measured live gateway or distributed limiter; the in-memory limiter resets across Edge Function isolates and should eventually be backed by a shared atomic store for strict cross-instance enforcement.


## 15. Account/session cache isolation (2026-10-20)

- The chat UI now rehydrates conversation state when the cloud-sync layer finishes loading, fixing cases where a new device had remote history in localStorage but the already-initialized in-memory UI never refreshed.
- On sign-in/sign-out notifications the chat aborts active requests, clears the composer and pending attachments, and immediately replaces the previous in-memory history. Once cloud sync finishes, it renders the currently authenticated user's authoritative scoped cache.
- Normal sign-out and account deletion remove the user's v3 conversation/active/sync localStorage keys plus the legacy shared cache. OAuth redirect sign-in/sign-out events also notify cloud sync. Static contract coverage lives in tests/chat-auth-cache-contract.test.mjs; browser smoke still does not simulate multi-account authentication end to end.
