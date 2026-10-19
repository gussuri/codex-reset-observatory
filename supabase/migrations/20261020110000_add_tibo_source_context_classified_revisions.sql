alter table public.tibo_signals
  add column if not exists source_context_classified_revision_hashes text[] not null default '{}'::text[];

do $migration$
begin
  if not exists (
    select 1
      from pg_constraint
     where conname = 'tibo_signals_source_context_classified_revisions_check'
       and conrelid = 'public.tibo_signals'::regclass
  ) then
    alter table public.tibo_signals
      add constraint tibo_signals_source_context_classified_revisions_check
      check (
        cardinality(source_context_classified_revision_hashes) <= 3
        and array_position(source_context_classified_revision_hashes, null) is null
        and source_context_classified_revision_hashes <@ source_context_revision_hashes
      );
  end if;
end
$migration$;
