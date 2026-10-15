-- Harden the legacy trigger function's name resolution.
-- The function has no attached non-internal triggers and should not resolve
-- objects through caller-controlled schemas if it is ever attached again.
ALTER FUNCTION public.process_trade_escrow() SET search_path = '';
