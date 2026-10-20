# Contributing

## Workflow
1. Branch from the current default branch using fix/<phase>-<topic> or feat/<topic>.
2. Keep changes focused and use descriptive commit messages.
3. Update VERSION, CHANGELOG.md, tests and docs when behavior changes.
4. Open a pull request. Do not push directly to main and do not merge while CI is red or required security checks are missing.
5. For SQL, write idempotent forward migrations, include rollback/recovery notes, and test against staging before production.
6. Never commit secrets, customer data or production logs. Use blank values from .env.example.

## Local checks
Run the Node regression tests listed in the README and ensure Deno type checks pass. For SQL changes, verify RLS under anon, two different authenticated users, Owner and service_role. For MoMo changes, test valid/invalid signatures, mismatched amount/order/request ID, repeated IPNs and delayed callbacks in sandbox.

## Definition of done
A PR should describe what changed, tests run, residual risks, rollback/recovery, and production steps requiring an operator. Never claim production secrets, migrations or inference services are configured unless verified in the target environment.
