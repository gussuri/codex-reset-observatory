alter table public.tibo_signals
  add column if not exists codex_operational_status text,
  add column if not exists codex_operational_confidence double precision,
  add column if not exists codex_operational_evidence_quote text,
  add column if not exists codex_operational_reason_ja text,
  add column if not exists codex_operational_expires_at timestamptz;

do $$
begin
  if not exists (
    select 1
      from pg_constraint
     where conname = 'tibo_signals_codex_operational_status_check'
       and conrelid = 'public.tibo_signals'::regclass
  ) then
    alter table public.tibo_signals
      add constraint tibo_signals_codex_operational_status_check
      check (codex_operational_status is null or codex_operational_status in (
        'none', 'investigating', 'active', 'recovered'
      ));
  end if;

  if not exists (
    select 1
      from pg_constraint
     where conname = 'tibo_signals_codex_operational_confidence_check'
       and conrelid = 'public.tibo_signals'::regclass
  ) then
    alter table public.tibo_signals
      add constraint tibo_signals_codex_operational_confidence_check
      check (
        codex_operational_confidence is null or
        (codex_operational_confidence >= 0 and codex_operational_confidence <= 1)
      );
  end if;
end
$$;

comment on column public.tibo_signals.codex_operational_status is
  'Display-only Tibo Codex service status; independent of reset classification and probability inputs.';
comment on column public.tibo_signals.codex_operational_expires_at is
  'End of the twelve-hour display eligibility window for a non-none Codex operational assertion.';
