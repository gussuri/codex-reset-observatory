alter table public.tibo_signals
  add column if not exists ai_failure_diagnostics jsonb;

comment on column public.tibo_signals.ai_failure_diagnostics is
  'Internal bounded Gemini failure diagnostics for the latest Tibo classification trial; never exposed through public DTOs.';

do $$
begin
  if not exists (
    select 1
      from pg_constraint
     where conname = 'tibo_signals_ai_failure_diagnostics_check'
       and conrelid = 'public.tibo_signals'::regclass
  ) then
    alter table public.tibo_signals
      add constraint tibo_signals_ai_failure_diagnostics_check
      check (
        ai_failure_diagnostics is null
        or case
          when jsonb_typeof(ai_failure_diagnostics) = 'array' then
            jsonb_array_length(ai_failure_diagnostics) <= 2
            and octet_length(ai_failure_diagnostics::text) <= 256
          else false
        end
      );
  end if;
end;
$$;
