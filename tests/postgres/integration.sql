\set ON_ERROR_STOP on

-- Create two independent users after schema + migration triggers are installed.
INSERT INTO auth.users(id, email, raw_user_meta_data) VALUES
  ('00000000-0000-4000-8000-000000000001', 'user-a@example.invalid', '{}'::jsonb),
  ('00000000-0000-4000-8000-000000000002', 'user-b@example.invalid', '{}'::jsonb)
ON CONFLICT (id) DO NOTHING;

-- Supabase grants these table privileges by default; the disposable fixture grants them
-- explicitly so the test measures RLS behavior, not platform default-privilege setup.
GRANT ALL PRIVILEGES ON ALL TABLES IN SCHEMA public TO service_role;
GRANT USAGE, SELECT, UPDATE ON ALL SEQUENCES IN SCHEMA public TO service_role;
GRANT SELECT ON public.profiles, public.orders TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.conversations, public.messages, public.ai_memories TO authenticated;
GRANT SELECT ON public.ai_usage_logs TO authenticated;
GRANT SELECT ON public.ai_models, public.plans TO anon, authenticated;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO service_role, authenticated;

INSERT INTO public.conversations(id,user_id,title,slug,created_at,updated_at) VALUES
  ('conv-a','00000000-0000-4000-8000-000000000001','A private thread','a-private',now(),now()),
  ('conv-b','00000000-0000-4000-8000-000000000002','B private thread','b-private',now(),now())
ON CONFLICT (id) DO NOTHING;

INSERT INTO public.messages(id,conversation_id,user_id,role,content) VALUES
  ('msg-a','conv-a','00000000-0000-4000-8000-000000000001','user','A private message'),
  ('msg-b','conv-b','00000000-0000-4000-8000-000000000002','user','B private message')
ON CONFLICT (id) DO NOTHING;

INSERT INTO public.orders(user_id,plan,amount,provider,provider_order_id,provider_request_id,status)
VALUES
 ('00000000-0000-4000-8000-000000000001','pro',149000,'momo','order-a','request-a','pending'),
 ('00000000-0000-4000-8000-000000000002','pro',149000,'momo','order-b','request-b','pending')
ON CONFLICT (provider_order_id) DO NOTHING;

-- RLS: User A may see only their profile, conversations, messages, and orders.
SET ROLE authenticated;
SELECT set_config('request.jwt.claim.sub','00000000-0000-4000-8000-000000000001',false);
DO $test$
BEGIN
  IF (SELECT count(*) FROM public.profiles) <> 1 THEN RAISE EXCEPTION 'RLS: user A profile isolation failed'; END IF;
  IF (SELECT count(*) FROM public.conversations) <> 1 THEN RAISE EXCEPTION 'RLS: user A conversation isolation failed'; END IF;
  IF (SELECT count(*) FROM public.messages) <> 1 THEN RAISE EXCEPTION 'RLS: user A message isolation failed'; END IF;
  IF (SELECT count(*) FROM public.orders) <> 1 THEN RAISE EXCEPTION 'RLS: user A order isolation failed'; END IF;
  IF has_function_privilege(current_user, 'public.consume_tokens(integer,uuid,boolean)', 'EXECUTE') THEN
    RAISE EXCEPTION 'SECURITY: authenticated may execute consume_tokens directly';
  END IF;
  IF has_function_privilege(current_user, 'public.refund_tokens(integer,uuid,text,integer)', 'EXECUTE') THEN
    RAISE EXCEPTION 'SECURITY: authenticated may execute idempotent refund_tokens directly';
  END IF;
END
$test$;

DO $write_test$
BEGIN
  BEGIN
    INSERT INTO public.conversations(id,user_id,title) VALUES
      ('conv-forged','00000000-0000-4000-8000-000000000002','forged user B row');
    RAISE EXCEPTION 'RLS: cross-user insert was unexpectedly accepted';
  EXCEPTION WHEN insufficient_privilege THEN
    NULL;
  END;
END
$write_test$;
RESET ROLE;

DO $forged_check$
BEGIN
  IF EXISTS (SELECT 1 FROM public.conversations WHERE id='conv-forged') THEN
    RAISE EXCEPTION 'RLS: forged conversation row persisted';
  END IF;
END
$forged_check$;

-- Refund ledger is request-scoped and cumulative: duplicate retries must not double-refund.
UPDATE public.profiles SET token_limit=1000,tokens_used=500,token_reset_at=now()+interval '1 hour'
WHERE id='00000000-0000-4000-8000-000000000001';
SET ROLE service_role;
SELECT public.refund_tokens(300,'00000000-0000-4000-8000-000000000001','refund-test-1',500);
SELECT public.refund_tokens(300,'00000000-0000-4000-8000-000000000001','refund-test-1',500);
SELECT public.refund_tokens(350,'00000000-0000-4000-8000-000000000001','refund-test-1',500);
RESET ROLE;
DO $refund_test$
BEGIN
  IF (SELECT tokens_used FROM public.profiles WHERE id='00000000-0000-4000-8000-000000000001') <> 150 THEN
    RAISE EXCEPTION 'REFUND: expected exactly 350 tokens refunded from 500 after duplicate calls';
  END IF;
  IF (SELECT refunded_tokens FROM public.token_refunds WHERE reservation_id='refund-test-1') <> 350 THEN
    RAISE EXCEPTION 'REFUND: ledger cumulative target is incorrect';
  END IF;
END
$refund_test$;

-- MoMo finalizer: bind request ID, update paid state/plan once, and reject duplicate transaction use.
SET ROLE service_role;
DO $payment_test$
DECLARE first_result jsonb; second_result jsonb; invalid_result jsonb; before_expiry timestamptz; after_expiry timestamptz;
BEGIN
  invalid_result := public.finalize_momo_payment(
    (SELECT id FROM public.orders WHERE provider_order_id='order-a'),
    'wrong-request', true, 0, 'Success', now(), 'transaction-invalid'
  );
  IF COALESCE(invalid_result->>'error','') <> 'REQUEST_ID_MISMATCH' THEN
    RAISE EXCEPTION 'PAYMENT: request ID mismatch was not rejected: %', invalid_result;
  END IF;

  first_result := public.finalize_momo_payment(
    (SELECT id FROM public.orders WHERE provider_order_id='order-a'),
    'request-a', true, 0, 'Success', now(), 'transaction-a'
  );
  IF COALESCE((first_result->>'ok')::boolean,false) IS NOT TRUE THEN
    RAISE EXCEPTION 'PAYMENT: first successful callback was not accepted: %', first_result;
  END IF;
  SELECT plan_expires_at INTO before_expiry FROM public.profiles WHERE id='00000000-0000-4000-8000-000000000001';

  second_result := public.finalize_momo_payment(
    (SELECT id FROM public.orders WHERE provider_order_id='order-a'),
    'request-a', true, 0, 'Success', now(), 'transaction-a'
  );
  IF COALESCE((second_result->>'already_processed')::boolean,false) IS NOT TRUE THEN
    RAISE EXCEPTION 'PAYMENT: duplicate callback was not idempotent: %', second_result;
  END IF;
  SELECT plan_expires_at INTO after_expiry FROM public.profiles WHERE id='00000000-0000-4000-8000-000000000001';
  IF before_expiry IS DISTINCT FROM after_expiry THEN
    RAISE EXCEPTION 'PAYMENT: duplicate callback extended plan expiry';
  END IF;
END
$payment_test$;
RESET ROLE;

DO $post_payment$
BEGIN
  IF (SELECT status FROM public.orders WHERE provider_order_id='order-a') <> 'paid' THEN
    RAISE EXCEPTION 'PAYMENT: successful IPN did not mark order paid';
  END IF;
  IF (SELECT provider_transaction_id FROM public.orders WHERE provider_order_id='order-a') <> 'transaction-a' THEN
    RAISE EXCEPTION 'PAYMENT: transaction ID was not persisted';
  END IF;
  IF (SELECT plan FROM public.profiles WHERE id='00000000-0000-4000-8000-000000000001') <> 'pro' THEN
    RAISE EXCEPTION 'PAYMENT: successful IPN did not update plan';
  END IF;
END
$post_payment$;

-- Reset for the separate concurrency harness; only one 700-token reservation can fit in 1000.
UPDATE public.profiles SET token_limit=1000,tokens_used=0,token_reset_at=now()+interval '1 hour'
WHERE id='00000000-0000-4000-8000-000000000001';
SELECT 'postgres-integration: RLS, service-only RPCs, idempotent refunds and MoMo finalization passed' AS result;
