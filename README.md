# LegendaryAI

LegendaryAI is a plain HTML/CSS/JS chat UI with Supabase Auth, PostgreSQL, private object storage, server-side model routing, per-plan token windows, and MoMo payment integration.

## Deployment truth and AI transparency

The code supports **Native Core**, an Ollama-compatible gateway, and an optional Hugging Face Space route. Native Core is orchestration/deterministic logic, not a foundation LLM. A repository model profile marked enabled is not proof that the inference service is alive.

The repository does **not** confirm a live local-model gateway or production model readiness. To activate a self-hosted model, an operator must configure the private server-side secrets <code>LEGENDARY_LOCAL_AI_URL</code> and <code>LEGENDARY_LOCAL_AI_TOKEN</code>, enable the corresponding row in <code>public.ai_models</code>, verify <code>local-model-health</code>, then submit an authenticated test request. The frontend must never receive either secret. An explicitly selected Ollama-compatible model fails closed when the gateway fails; the request is not silently relabelled as Native Core.

Model display labels are aliases. For example, the seeded registry maps “Legendary Reasoner 32B” to <code>qwen3:30b</code>, “Legendary Vision Pro 11B” to <code>llama3.2-vision:11b</code>, “Legendary Ultra 120B” to <code>gpt-oss:120b</code>, and “Legendary Vision 109B” to <code>llama4:scout</code>. These mappings are not proof that those models are currently available.

Image generation is currently **disabled** in both the browser flow and the <code>image-generate</code> Edge Function until a self-hosted image provider is configured and security-tested. The app does not send image prompts through the old OpenAI image integration. Web search must not be presented as available unless a real provider is enabled and verified.

## Plans and token quotas

The following are the defaults encoded in the repository schema. Production plan rows and UI prices must be checked in the deployed database before a public price claim is made.

| Plan | Default token limit | Reset window | Manual reset |
|---|---:|---|---|
| Guest | 1,000 per guest session | Session-based, not a six-hour reset plan | Not available |
| Free | 500,000 | 6 hours | Not available |
| Pro | 2,000,000 | 12 hours | 1 time per month |
| Legendary | 6,000,000 | 18 hours | 1 time per 7 days |
| Owner | Privileged/admin configuration | Owner window in backend | 1 time per 7 days |

Seeded subscription prices are Pro 149,000 VND/month and Legendary 399,000 VND/month; the production <code>plans</code> table remains the source of truth and can differ. MoMo purchases are single payments in the current code; an automatic-renewal mechanism was not found. See [token policy](/token-policy) and [payment/refund policy](/refund).

## Security model

- Private endpoints authenticate the caller server-side; Owner operations must check the role server-side.
- CORS emits <code>Access-Control-Allow-Origin</code> only for allowlisted origins, including configured <code>SITE_URL</code>.
- Token reservation is performed by a service-role RPC; request-scoped refunds use an idempotency ledger in the new migration.
- User data tables use RLS and ownership policies. The <code>chat-attachments</code> bucket is private and scoped to a user folder.
- MoMo IPNs validate an HMAC signature, order ID, request ID, amount, plan/user binding for successful payments, and transaction ID idempotency.
- Do not commit service-role credentials, MoMo secrets, gateway bearer tokens, or private keys. The publishable Supabase key in <code>js/supabase-config.js</code> is designed to be public; it is not a service-role key.
- <code>vercel.json</code> includes security headers/CSP and rewrites for legal and payment-result routes.

## Local development

Required tools: Node.js 20+, Supabase CLI v2, Docker, and (for SQL application) <code>psql</code>.

1. Clone the repository and copy <code>.env.example</code> to a local-only environment file; never commit the copy.
2. Run <code>supabase start</code>.
3. Open the local Supabase Studio SQL editor and run <code>supabase/schema.sql</code> against the local database.
4. Apply migration files from <code>supabase/migrations/</code> in timestamp order against the local database, including <code>20261020120000_legal_payment_retention_hardening.sql</code>. Some historical migrations overlap with the consolidated schema; if any migration fails, stop and review rather than skipping it. Do not use this manual setup procedure against production.
5. Serve the static frontend with any local static HTTP server at an origin included in the Edge Function allowlists (for example <code>http://localhost:3000</code>). Configure only local Supabase values for local testing.
6. Run the available regression suite and type checks as described below.

The committed <code>supabase/schema.sql</code> is the consolidated schema snapshot. For an existing Supabase deployment, apply each pending migration through the normal migration/review process; **do not blindly rerun the schema snapshot against production**.

## Server-side configuration

Set these as Supabase Edge Function secrets, as applicable:

- <code>SITE_URL</code>: the canonical deployed site origin.
- <code>SUPABASE_URL</code>, <code>SUPABASE_SERVICE_ROLE_KEY</code>, and <code>SUPABASE_ANON_KEY</code>: server-side function configuration; never publish the service-role key.
- <code>MOMO_ENDPOINT</code>, <code>MOMO_PARTNER_CODE</code>, <code>MOMO_ACCESS_KEY</code>, <code>MOMO_SECRET_KEY</code>: approved MoMo merchant environment. Select sandbox/production explicitly; there is no implicit test-endpoint fallback.
- <code>LEGENDARY_LOCAL_AI_URL</code> and <code>LEGENDARY_LOCAL_AI_TOKEN</code>: private Ollama-compatible gateway and bearer token.
- <code>HF_SPACE_URL</code> and <code>HF_ACCESS_TOKEN</code>: only if the Hugging Face route is deliberately enabled and disclosed.
- <code>RETENTION_CLEANUP_SECRET</code>: random secret used to invoke the scheduled retention cleanup job.

Never copy those values into frontend JavaScript or Git. Configure and verify all secrets on Supabase yourself; repository changes do not alter hosted secrets.

## Supabase functions

| Function | Purpose / state |
|---|---|
| <code>ai-chat-v10</code> | Active chat route, token reservation, routing/fallback |
| <code>ai-chat</code> | Legacy compatibility route; shares the protected request-scoped refund contract |
| <code>local-model-health</code> | Private gateway readiness endpoint |
| <code>owner-stats</code>, <code>owner-admin</code> | Owner-only operations; must be deployed and role-tested |
| <code>token-reset</code> | Controlled manual token reset |
| <code>momo-create-payment</code>, <code>momo-ipn</code> | MoMo create/IPN; new DB finalizer comes from the forward migration |
| <code>account-data</code> | Consent evidence, user-scoped payment status, data export and account deletion |
| <code>support-request</code> | Validated support/privacy/billing complaint intake; stores a ticket, no automatic email is configured |
| <code>data-retention-cleanup</code> | Secret-protected scheduled cleanup; disabled until each retention policy is configured |
| <code>image-generate</code> | Intentionally disabled (503) until a supported self-hosted image provider exists |

Set the corresponding <code>verify_jwt</code> values in <code>supabase/config.toml</code>. A secret-protected scheduled function is not a replacement for configuring a real scheduler.

## Testing and CI

Run focused tests with Node.js:

<pre><code>node tests/chat-routing.test.js
node tests/image-intent.test.js
node tests/cors-origin-policy.test.mjs
node tests/security-hardening.test.mjs
node tests/legal-routes.test.mjs
node tests/secret-scan.test.mjs
node tests/bg3d-runtime.test.mjs
node tests/chat-security.test.mjs
node tests/cloud-sync-runtime.test.mjs
node tests/cloud-sync-integration.test.mjs
node tests/postgres-contract.test.mjs
node tests/chat-quota-contract.test.mjs
deno test tests/momo-signature.test.mjs</code></pre>

CI also type-checks Edge Functions with Deno and runs a Playwright browser smoke test for the app shell, deep links, and legal routes. To run that browser test locally, install Node.js 22, run `npm install --no-save --package-lock=false playwright@1.64.1`, install Chromium with `npx --no-install playwright install chromium`, then run `node tests/e2e-smoke.mjs`. These checks still do **not** replace adversarial integration tests against a real PostgreSQL/Supabase staging project, MoMo sandbox callback tests, or a live local-model smoke test.

## Privacy, legal pages and data retention

The static Vietnamese policy pages are at <code>/terms</code>, <code>/privacy</code>, <code>/refund</code>, <code>/acceptable-use</code>, <code>/cookies</code>, <code>/token-policy</code>, <code>/ai-disclosure</code>, and <code>/contact</code>. They are review drafts, not a claim that the service is legally ready to launch. The operator name, tax/business number, address, support/security email, hotline and response time remain placeholders.

Retention policies in the migration are deliberately seeded with <code>enabled = false</code> and <code>retention_days = NULL</code>. No data cleanup is scheduled by this repository. The operator must approve retention periods, configure the values, add a protected scheduler, and verify the deletion job before enabling any rule.

## Operational checklist

- Apply and verify migrations on staging before production; take a database backup and test rollback/recovery.
- Verify RLS with anon, user A, user B, Owner and service_role.
- Verify token reserve/settle/refund under concurrency; negative balances and duplicate refunds must fail.
- Test MoMo sandbox with repeated, delayed, mismatched and failed IPNs before production.
- Check live model health and authenticated inference before enabling paid profiles.
- Review [the legal checklist](docs/LEGAL_REVIEW_CHECKLIST.md), [the audit report](docs/AUDIT_REPORT.md), [SECURITY.md](SECURITY.md), and [CONTRIBUTING.md](CONTRIBUTING.md).
