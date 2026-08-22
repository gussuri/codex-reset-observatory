alter table public.tibo_signals
  add column if not exists codex_operational_status text,
  add column if not exists codex_operational_confidence double precision,
  add column if not exists codex_operational_evidence_quote text,
  add column if not exists codex_operational_reason_ja text,
  add column if not exists codex_operational_expires_at timestamptz;

alter table public.tibo_signals
  drop constraint if exists tibo_signals_codex_operational_status_check;

alter table public.tibo_signals
  add constraint tibo_signals_codex_operational_status_check
  check (
    codex_operational_status is null
    or codex_operational_status in ('none', 'investigating', 'active', 'recovered')
  );

alter table public.tibo_signals
  drop constraint if exists tibo_signals_codex_operational_confidence_check;

alter table public.tibo_signals
  add constraint tibo_signals_codex_operational_confidence_check
  check (
    codex_operational_confidence is null
    or (
      codex_operational_confidence >= 0
      and codex_operational_confidence <= 1
    )
  );
