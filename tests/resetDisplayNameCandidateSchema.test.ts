import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

test("candidate migration declares the identity and lifecycle contract", () => {
  const sql = readFileSync(
    "supabase/migrations/20260908123000_create_reset_display_name_candidates.sql",
    "utf8",
  );

  assert.match(sql, /candidate_id\s+uuid\s+primary key/i);
  assert.match(sql, /source_snapshot_hash\s+text/i);
  assert.match(sql, /input_hash\s+text/i);
  assert.match(sql, /'unprocessed'/i);
  assert.match(sql, /'pending'/i);
  assert.match(sql, /'notice-precompute-v1'/i);
  assert.match(sql, /enable row level security/i);
  assert.match(sql, /create or replace function public\.upsert_reset_display_name_candidate_seed/i);
  assert.match(sql, /security invoker/i);
  assert.match(sql, /set search_path = pg_catalog, public, extensions/i);
  assert.match(sql, /revoke all on function public\.upsert_reset_display_name_candidate_seed/i);
  assert.match(
    sql,
    /grant execute on function public\.upsert_reset_display_name_candidate_seed\s*\([^)]*\)\s+to\s+service_role/i,
  );
  assert.doesNotMatch(
    sql,
    /grant execute on function public\.upsert_reset_display_name_candidate_seed\s*\([^)]*\)[\s\S]*?to\s+(?:public|anon|authenticated)/i,
  );
});
