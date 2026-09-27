alter table public.profiles alter column token_limit set default 500000;
update public.profiles set token_limit = 500000 where plan = 'free' and coalesce(role,'user') <> 'owner';
notify pgrst, 'reload schema';
