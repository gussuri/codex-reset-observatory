import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

const root = process.cwd();
const foundationPath = path.join(
  root,
  "supabase",
  "migrations",
  "20260730000000_create_initial_observatory_schema.sql",
);
const configPath = path.join(root, "supabase", "config.toml");
const envExamplePath = path.join(root, ".env.example");

test("foundation recreates only the pre-20260731 base schema", () => {
  const sql = fs.readFileSync(foundationPath, "utf8");

  for (const table of ["tibo_heartbeat", "tibo_signals", "prediction_history"]) {
    assert.match(sql, new RegExp(`CREATE TABLE IF NOT EXISTS public\\.${table}`));
  }

  for (const laterColumn of [
    "last_page_reload_at",
    "rule_signal_type",
    "translated_text_ja",
    "ai_teaser_strength",
    "expected_start_at",
    "quote_context_text",
    "secondary_signal",
  ]) {
    assert.doesNotMatch(sql, new RegExp(`\\b${laterColumn}\\b`));
  }

  assert.match(sql, /CREATE EXTENSION IF NOT EXISTS pgcrypto WITH SCHEMA extensions/);
  assert.match(sql, /GENERATED ALWAYS AS IDENTITY/);
  assert.match(sql, /ALTER TABLE public\.tibo_heartbeat ENABLE ROW LEVEL SECURITY/);
  assert.match(sql, /ALTER TABLE public\.tibo_signals ENABLE ROW LEVEL SECURITY/);
  assert.match(sql, /ALTER TABLE public\.prediction_history ENABLE ROW LEVEL SECURITY/);
  assert.match(sql, /ON SEQUENCE public\.prediction_history_id_seq\s+TO service_role/);
  assert.doesNotMatch(sql, /TO\s+(?:public|anon|authenticated)[,\s]/);
});

test("local Supabase config is explicit about schema safety and does not link Production", () => {
  const config = fs.readFileSync(configPath, "utf8");

  assert.match(config, /^project_id = "codex-reset-observatory"$/m);
  assert.match(config, /^auto_expose_new_tables = false$/m);
  assert.match(config, /^major_version = 17$/m);
  assert.match(config, /^enabled = false$/m);
  assert.doesNotMatch(config, /project-ref|project_ref|password|service_role|SUPABASE_URL/);
});

test("env example lists names without real values", () => {
  const envExample = fs.readFileSync(envExamplePath, "utf8");
  const requiredNames = [
    "SUPABASE_URL",
    "SUPABASE_SERVICE_ROLE_KEY",
    "CRON_SECRET",
    "TIBO_WEBHOOK_SECRET",
    "CODEX_USAGE_MONITOR_SECRET",
    "GEMINI_API_KEY",
    "GEMINI_MODEL",
    "GEMINI_CLASSIFICATION_MODE",
    "GEMINI_TRANSLATION_MODE",
    "CODEX_CLI_PATH",
    "CODEX_USAGE_WEBHOOK_URL",
    "CODEX_USAGE_POLL_INTERVAL_MS",
    "APP_URL",
  ];

  for (const name of requiredNames) {
    assert.match(envExample, new RegExp(`^${name}=$`, "m"));
  }
});
