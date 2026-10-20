# Legal review checklist — checked 2026-10-20

This is an engineering checklist, not legal advice. The policy pages are drafts and must not be treated as launch approval.

## Operator information to fill before publication

- [ ] Legal name of operator / individual.
- [ ] Enterprise/tax registration number, if applicable.
- [ ] Contact/business address.
- [ ] Public support email and privacy/security/DPO contact.
- [ ] Hotline, support hours and response SLA.
- [ ] Contact for privacy requests and abuse reports.
- [ ] Merchant identity and official MoMo merchant integration mode.
- [ ] Data-region / subprocessor facts from the actual Supabase, Vercel, MoMo, OAuth and inference provider accounts.
- [ ] Retention days for chat, usage logs, memory, attachments, support requests, and payment/audit records; do not enable cleanup until approved.
- [ ] Decide complaint handling, refund windows/conditions, invoice/tax treatment and any price changes.

## Pages created in this branch

- [ ] /terms — terms, account, pricing, content, disclaimers and disputes.
- [ ] /privacy — data map, purposes, processors, retention, rights and security.
- [ ] /refund — actual single-payment flow, pending/failed order handling, and manual reconciliation.
- [ ] /acceptable-use — prohibited behaviors and enforcement.
- [ ] /token-policy — quota defaults and reset windows from repository schema.
- [ ] /cookies — browser storage keys detected in code and deletion guidance.
- [ ] /ai-disclosure — Native Core versus inference model, aliases, local gateway readiness, disabled image generation and limitations.
- [ ] /contact — support/privacy/billing/abuse ticket intake; automated email is not configured.
- [ ] /payment-result — authenticated server-side order status, not a redirect-query result.
- [ ] Registration consent checkbox and versioned consent rows in user_consents.
- [ ] Account data export and password-reauthenticated deletion implemented in account-data; OAuth-only deletion may require manual support.
- [ ] retention_settings + data-retention-cleanup implemented but disabled by default; no scheduler is configured in this repository.

## Behavior-dependent wording that must be verified after deployment

- [ ] Compare seeded plan prices/quotas against production public.plans, the UI, and the MoMo order amount.
- [ ] Confirm Guest 1,000 tokens/session, Free 500,000/6h, Pro 2,000,000/12h, Legendary 6,000,000/18h; Pro manual reset 1/month and Legendary/Owner 1/7 days.
- [ ] Verify live model profile, gateway health, model inference, auth bearer secret, routing/fallback and logs before any marketing claim.
- [ ] Verify whether Hugging Face Space is enabled, which data it receives, its retention policy and its contractual location.
- [ ] Confirm whether web search has a real provider; do not publish as available unless verified.
- [ ] Confirm image generation remains disabled until an approved self-hosted provider is tested.
- [ ] Verify auth providers, URLs, retention and log settings in Supabase/Vercel dashboards; repository alone cannot reveal hosted settings.
- [ ] Set each retention_settings row to an approved positive retention_days and enabled=true only after backup and deletion dry run.
- [ ] Configure a protected scheduler to call data-retention-cleanup; prove it is not publicly callable without RETENTION_CLEANUP_SECRET.
- [ ] Verify account export includes every user-owned record and files; verify deletion removes data or documents lawful retention for transactions/consent evidence.
- [ ] Test pending MoMo order, successful IPN, failed IPN, repeated IPN, duplicate transaction ID, mismatched amount/order/request ID and callback delay in merchant sandbox.
- [ ] Confirm order status values and plan expiry behavior with the actual merchant and database schema.
- [ ] Review age rules, parental consent, lawful basis by purpose, cross-border transfer assessments, processors and breach notification timelines with qualified counsel.

## Legal sources checked 2026-10-20

1. **Law No. 91/2025/QH15 on Personal Data Protection**, official Government legal document database. The source lists issuance 26 June 2025 and effective date 1 January 2026: [Official text record](https://vanban.chinhphu.vn/?classid=1&docid=214590&pageid=27160&typegroup=). The law's detailed application, transitional rules and subordinate instruments should be reviewed by counsel before launch.
2. **Vietnam's Law on E-Commerce and Government Decree No. 248/2026/ND-CP**, Ministry of Industry and Trade publication: [MOIT publication](https://moit.gov.vn/en/news/ministry-of-industry-and-trade-disseminates-the-law-on-e-commerce-and-government-decree-no.-248-2026-nd-cp.html). The publication describes the new framework as effective from 1 July 2026. Counsel should check the primary legal text and applicability to this service/merchant model.
3. **MoMo Developers — One-Time Payments / captureWallet**: [Initiate transaction and parameter rules](https://developers.momo.vn/v3/vi/docs/payment/api/payment-api/init/) and [One-time wallet payment guide](https://developers.momo.vn/v3/vi/docs/payment/api/wallet/onetime/). The docs list requestType captureWallet, unique requestId for idempotency, amount boundaries, redirectUrl/ipnUrl and HMAC-SHA256 field ordering. Re-verify these values against the exact merchant contract/environment before production.

## Open decisions / manual blockers

- [ ] Operator identity/contact details are intentionally placeholders, not invented.
- [ ] Refund period and policy, retention duration, and use of data to improve models remain business/legal decisions.
- [ ] Production secrets must be installed/verified by the operator; rotate any exposed key if the history scan finds one.
- [ ] Apply the new SQL migration to staging, validate schema/permissions and test rollback/recovery before production.
- [ ] Confirm MoMo merchant onboarding, production endpoint, callback URL and reconciliation workflow.
- [ ] Obtain legal review and approve publication of policy version 1.0.0 before enabling account registration/payments in production.
