# Security policy

## Supported version
Security fixes are developed against the current default branch and its reviewed release.

## Reporting a vulnerability
The official security contact still needs to be filled in: **[[EMAIL BẢO MẬT / DPO]]**. Until the operator does so, use [the contact form](/contact) and choose the privacy/security topic. Do not include credentials, service-role keys, payment secrets, or real personal data in a report.

Include the affected route/function, reproduction steps using test accounts, impact, and a request ID if available. Do not access other users' records, run destructive tests on production, or perform load tests without authorization.

## Response and disclosure
A fixed response SLA has not been committed. The operator must publish one before launch. If a secret may have leaked, rotate it with the provider, audit usage, and remove it from active code. Do not rewrite Git history or force-push without an approved incident plan.

## Security invariants
- Supabase service-role credentials, MoMo secrets and inference bearer tokens are server-only.
- Privileged Edge Functions authenticate and validate authorization server-side.
- RLS separates user-owned rows; Owner operations require an Owner role check at the server and in policies.
- Payment status is set only after a verified provider callback is bound to the stored order.
- Registry labels are not evidence of live inference readiness.
