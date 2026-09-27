revoke all on function public.consume_tokens(integer, uuid) from anon, authenticated;
revoke all on function public.refund_tokens(integer, uuid) from anon, authenticated;
grant execute on function public.consume_tokens(integer, uuid) to service_role;
grant execute on function public.refund_tokens(integer, uuid) to service_role;
