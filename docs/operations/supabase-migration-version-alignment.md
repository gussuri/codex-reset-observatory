# Supabase migration version alignment

Use the migration version recorded by Supabase as the filename prefix. The version is part of the applied migration identity; changing it can make an already-applied SQL file appear pending or make the CLI report a local/remote mismatch.

## Create and apply a migration

Create a new migration once with the CLI and keep its generated version when editing it:

```text
pnpm exec supabase migration new <descriptive-name>
```

For an explicitly selected project, inspect the plan before any apply:

```text
pnpm exec supabase db push --project-ref <project-ref> --dry-run --skip-vault
```

Review every pending version. Apply only after the dry-run matches the intended SQL and target; use the same project and options, removing `--dry-run`. Stop if the CLI reports a version mismatch, proposes previously applied SQL, or includes an unexpected migration. Do not use `--include-all` to bypass a mismatch.

## Reconcile an already-applied migration

The version mapping in this runbook reflects the Production migration catalog inspected for this repository. For another project or environment, inspect that environment's `supabase_migrations.schema_migrations` catalog and compare its recorded migration SQL with the local file before taking action. If it records an older version, handle that environment against its own catalog; do not rename by assumption, repair history, or replay SQL unconditionally.

If a migration was applied through MCP or another tool and its recorded version differs from the local filename, first compare the local SQL with the SQL associated with that remote version. When they are the same migration, rename the local file to the recorded version while preserving its SQL bytes. If the SQL differs, create a new migration instead. Do not replay the SQL, fabricate a history row, or mark unapplied SQL as applied to make the versions appear aligned.
