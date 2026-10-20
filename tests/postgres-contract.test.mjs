import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const schema = readFileSync("supabase/schema.sql", "utf8");
const migration = readFileSync("supabase/migrations/20261020120000_legal_payment_retention_hardening.sql", "utf8");

assert.doesNotMatch(schema, /^as \$$/m, "schema function bodies must use a valid dollar-quote delimiter");
assert.doesNotMatch(schema, /^\$;$/m, "schema function bodies must close with the matching $$ delimiter");
assert.equal((schema.match(/\$\$/g) || []).length % 2, 0, "schema dollar quote delimiters must be balanced");
assert.match(schema, /revoke all on function public\.consume_tokens\(integer, uuid, boolean\) from public, anon, authenticated/i, "reserve-token RPC must not be callable by client roles");
assert.match(migration, /grant execute on function public\.refund_tokens\(integer, uuid, text, integer\) to service_role/i, "idempotent refund RPC must be service-role-only");
assert.match(migration, /primary key \(user_id, reservation_id\)/i, "refund ledger must be unique by user/request");
assert.match(migration, /for update/i, "payment finalization must take a row lock");
assert.match(migration, /p_request_id <> v_order\.provider_request_id/i, "payment finalization must bind request ID to the order");
assert.match(migration, /orders_provider_transaction_id_uidx/i, "provider transaction ID must be unique");
console.log("postgres-contract: schema quoting and security invariants passed");
