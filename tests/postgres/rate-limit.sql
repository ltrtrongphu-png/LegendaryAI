\set ON_ERROR_STOP on

SET ROLE service_role;
DO $rate_limit_test$
DECLARE
  t0 timestamptz := '2026-10-20T14:00:00Z';
  first_call jsonb;
  second_call jsonb;
  limited_call jsonb;
  burst_first jsonb;
  burst_second jsonb;
BEGIN
  first_call := public.check_api_rate_limit(repeat('a',64), t0, 60, 2, 50);
  IF COALESCE((first_call->>'ok')::boolean,false) IS NOT TRUE THEN
    RAISE EXCEPTION 'RATE LIMIT: first request should pass: %', first_call;
  END IF;

  second_call := public.check_api_rate_limit(repeat('a',64), t0 + interval '100 milliseconds', 60, 2, 50);
  IF COALESCE((second_call->>'ok')::boolean,false) IS NOT TRUE THEN
    RAISE EXCEPTION 'RATE LIMIT: second request within the bucket should pass: %', second_call;
  END IF;

  limited_call := public.check_api_rate_limit(repeat('a',64), t0 + interval '200 milliseconds', 60, 2, 50);
  IF COALESCE((limited_call->>'ok')::boolean,true) IS NOT FALSE
     OR COALESCE(limited_call->>'code','') <> 'RATE_LIMITED' THEN
    RAISE EXCEPTION 'RATE LIMIT: third request should be rate limited: %', limited_call;
  END IF;

  burst_first := public.check_api_rate_limit(repeat('b',64), t0, 60, 100, 50);
  burst_second := public.check_api_rate_limit(repeat('b',64), t0 + interval '10 milliseconds', 60, 100, 50);
  IF COALESCE((burst_first->>'ok')::boolean,false) IS NOT TRUE
     OR COALESCE(burst_second->>'code','') <> 'REQUEST_BURST' THEN
    RAISE EXCEPTION 'RATE LIMIT: minimum interval should block request bursts: first %, second %', burst_first, burst_second;
  END IF;

  IF has_function_privilege('anon', 'public.check_api_rate_limit(text,timestamptz,integer,integer,integer)', 'EXECUTE') THEN
    RAISE EXCEPTION 'SECURITY: anon must not be able to execute check_api_rate_limit';
  END IF;
  IF EXISTS (
    SELECT 1 FROM public.api_rate_limit_buckets
    WHERE key_hash = repeat('a',64) OR key_hash = repeat('b',64)
  ) IS NOT TRUE THEN
    RAISE EXCEPTION 'RATE LIMIT: hashed keys should be stored in the backing table';
  END IF;
END
$rate_limit_test$;
RESET ROLE;
SELECT 'postgres-rate-limit: shared windows, burst checks and service-only grants passed' AS result;
