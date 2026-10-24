import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import net from "node:net";

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const postgresBin = process.env.POSTGRES_BIN;
if (!postgresBin) {
  throw new Error("Set POSTGRES_BIN to a local PostgreSQL 17 bin directory (containing initdb, pg_ctl, and psql).");
}

const executable = (name) => join(postgresBin, `${name}${process.platform === "win32" ? ".exe" : ""}`);
const initdb = executable("initdb");
const pgCtl = executable("pg_ctl");
const psql = executable("psql");
for (const path of [initdb, pgCtl, psql]) {
  if (!existsSync(path)) throw new Error(`Missing PostgreSQL executable: ${path}`);
}

const versionResult = spawnSync(pgCtl, ["--version"], { encoding: "utf8" });
if (versionResult.status !== 0) throw new Error(versionResult.stderr || "Could not read pg_ctl version");
const version = `${versionResult.stdout}${versionResult.stderr}`.trim();
if (!/PostgreSQL\)?\s*17\./i.test(version)) {
  throw new Error(`This integration requires PostgreSQL 17; found ${version}`);
}

function functionDefinition(sql, name) {
  const marker = `create or replace function public.${name}(`;
  const start = sql.toLowerCase().indexOf(marker);
  if (start < 0) throw new Error(`Could not find actual ${name} definition in its source migration`);
  const endMarker = "$function$;";
  const end = sql.indexOf(endMarker, start);
  if (end < 0) throw new Error(`Could not find end of ${name} definition`);
  return sql.slice(start, end + endMarker.length);
}

const atomicMigration = readFileSync(join(repositoryRoot, "supabase/migrations/20261008102302_separate_banked_observations_and_associations.sql"), "utf8");
const futureReplyMigration = readFileSync(join(repositoryRoot, "supabase/migrations/20261024100000_add_codex_future_reply_claim_guard.sql"), "utf8");
const schema = readFileSync(join(repositoryRoot, "tests/integration/codexFutureReplyAtomic.schema.sql"), "utf8");
const assertions = readFileSync(join(repositoryRoot, "tests/integration/codexFutureReplyAtomic.assertions.sql"), "utf8");
const twoSessionSeed = readFileSync(join(repositoryRoot, "tests/integration/codexFutureReplyAtomic.twoSessionSeed.sql"), "utf8");
const actualFunctions = [
  functionDefinition(atomicMigration, "apply_codex_usage_webhook_write_v2"),
  functionDefinition(atomicMigration, "apply_codex_usage_webhook_write"),
].join("\n\n");

function run(file, args, options = {}) {
  const result = spawnSync(file, args, { encoding: "utf8", ...options });
  if (result.status !== 0) {
    const details = [result.stdout, result.stderr].filter(Boolean).join("\n");
    throw new Error(`${file} exited with ${result.status ?? result.signal}:\n${details}`);
  }
  return `${result.stdout ?? ""}${result.stderr ?? ""}`;
}

async function reserveLoopbackPort() {
  const server = net.createServer();
  await new Promise((resolveListen, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolveListen);
  });
  const address = server.address();
  assert.ok(address && typeof address !== "string");
  const port = address.port;
  await new Promise((resolveClose, reject) => server.close((error) => error ? reject(error) : resolveClose()));
  return port;
}

function psqlArgs(port, extra = []) {
  return ["-X", "-v", "ON_ERROR_STOP=1", "-h", "127.0.0.1", "-p", String(port), "-U", "postgres", "-d", "postgres", ...extra];
}

function makeForwardPlan(proof) {
  const previousAt = "2026-10-22T17:54:00Z";
  const observedAt = "2026-10-22T17:59:00Z";
  const previousResetsAt = 1_800_000_000;
  const currentResetsAt = previousResetsAt + 86_400;
  const replyId = String(proof.tweet_id);
  const eventKey = String(proof.ai_contextual_reset_tweet_id);
  const estimate = {
    reset_event_key: `tibo-reset-${replyId}`,
    display_execution_at: observedAt,
    execution_time_source: "usage_observation",
    execution_time_confidence: "high",
    execution_time_precision: "approximate",
    execution_window_start_at: previousAt,
    execution_window_end_at: observedAt,
    recovery_previous_observed_at: previousAt,
    recovery_observed_at: observedAt,
    tibo_announced_at: proof.tweet_created_at,
    tibo_primary_tweet_id: replyId,
    tibo_source_tweet_ids: [replyId],
    official_notice_tweet_id: replyId,
    official_notice_at: proof.tweet_created_at,
    estimator_version: "usage-execution-monitor-v1",
    manual_override_at: null,
    manual_override_by: null,
    manual_override_reason: null,
    manual_execution_at: null,
    manual_execution_precision: null,
    is_monitor_observed: false,
  };
  const fallback = {
    ...estimate,
    reset_event_key: "usage-reset-pending",
    tibo_announced_at: null,
    tibo_primary_tweet_id: null,
    tibo_source_tweet_ids: [],
    official_notice_tweet_id: null,
    official_notice_at: null,
    is_monitor_observed: true,
  };
  return {
    source_key: "local-codex-app-server",
    expected_previous_observed_at: previousAt,
    state: {
      source_key: "local-codex-app-server",
      observed_at: observedAt,
      received_at: "2026-10-22T17:59:01Z",
      limit_id: "codex",
      plan_type: "plus",
      used_percent: 0,
      window_duration_mins: 10080,
      resets_at: currentResetsAt,
      coverage_started_at: previousAt,
      banked_reset_available_count: 0,
      last_banked_grant_at: null,
      updated_at: "2026-10-22T17:59:01Z",
    },
    observation: {
      source_key: "local-codex-app-server",
      observed_at: observedAt,
      previous_observed_at: previousAt,
      previous_used_percent: 100,
      current_used_percent: 0,
      previous_resets_at: previousResetsAt,
      current_resets_at: currentResetsAt,
      cycle_hint: "unexpected",
      confidence: "strong",
      status: "observed",
      matched_tibo_tweet_id: null,
      confirmed_at: null,
      updated_at: "2026-10-22T17:59:01Z",
    },
    execution_estimate: estimate,
    future_reply_claim: {
      event_key: eventKey,
      reply_tweet_id: replyId,
      recovery_observed_at: observedAt,
      reset_event_key: estimate.reset_event_key,
      reply_proof: proof,
    },
    future_reply_fallback_execution_estimate: fallback,
  };
}

function sqlLiteral(value) {
  return `'${value.replaceAll("'", "''")}'`;
}

function runTwoSessionStaleProofCase(port, tempRoot, seedFile, mutation) {
  // Session 1 seeds and reads the selected reply, then closes. Session 2 applies
  // a manual/context edit and calls the forward RPC with session 1's old proof.
  const readerOutput = run(psql, psqlArgs(port, ["-q", "-A", "-t", "-f", seedFile]));
  const proofLine = readerOutput.split(/\r?\n/).find((line) => line.trimStart().startsWith("{"));
  assert.ok(proofLine, `reader session did not return a JSON reply proof:\n${readerOutput}`);
  const proof = JSON.parse(proofLine);
  const plan = makeForwardPlan(proof);
  const updateSql = mutation === "manual"
    ? "update public.tibo_signals set verification_status = 'rejected' where tweet_id = '2113162413008884099';"
    : "update public.tibo_signals set reply_context_text = 'An edited parent context.', source_context_snapshot = pg_catalog.jsonb_set(source_context_snapshot, '{parent,text}', pg_catalog.to_jsonb('An edited parent context.'::text)) where tweet_id = '2113162413008884099';";
  const writerFile = join(tempRoot, `two-session-${mutation}-writer.sql`);
  const planSql = sqlLiteral(JSON.stringify(plan));
  writeFileSync(writerFile, [
    updateSql,
    `select public.apply_codex_usage_future_reply_webhook_write(${planSql}::jsonb)::text;`,
  ].join("\n"), "utf8");
  const writerOutput = run(psql, psqlArgs(port, ["-q", "-A", "-t", "-f", writerFile]));
  const resultLine = writerOutput.split(/\r?\n/).find((line) => line.trimStart().startsWith("{"));
  assert.ok(resultLine, `writer session did not return its RPC result:\n${writerOutput}`);
  const result = JSON.parse(resultLine);
  assert.equal(result.status, "applied", `${mutation} drift still persists the monitor observation`);
  assert.equal(result.future_reply_proof_changed, true, `${mutation} drift is detected from the locked row`);

  const verificationSql = [
    "select (select count(*) from public.codex_usage_future_reply_claims)::text || '|' ||",
    "coalesce((select e.tibo_primary_tweet_id from public.reset_execution_estimates e limit 1), 'null');",
  ].join("\n");
  const verification = run(psql, psqlArgs(port, ["-q", "-A", "-t", "-c", verificationSql])).trim();
  assert.equal(verification, "0|null", `${mutation} drift must leave a standalone estimate and no reply claim`);
}

async function waitForMarker(child, marker, timeoutMs = 8000) {
  return new Promise((resolveWait, rejectWait) => {
    let output = "";
    const timeout = setTimeout(() => rejectWait(new Error(`Timed out waiting for PostgreSQL session marker ${marker}`)), timeoutMs);
    const inspect = (chunk) => {
      output += chunk.toString();
      if (output.includes(marker)) {
        clearTimeout(timeout);
        resolveWait(output);
      }
    };
    child.stdout.on("data", inspect);
    child.stderr.on("data", inspect);
    child.once("error", (error) => {
      clearTimeout(timeout);
      rejectWait(error);
    });
    child.once("exit", (code) => {
      if (!output.includes(marker)) {
        clearTimeout(timeout);
        rejectWait(new Error(`Lock-holder session exited before marker (${code}): ${output}`));
      }
    });
  });
}

async function waitForExit(child) {
  if (child.exitCode !== null || child.signalCode !== null) {
    return { code: child.exitCode, signal: child.signalCode };
  }
  return new Promise((resolveExit, rejectExit) => {
    child.once("error", rejectExit);
    child.once("exit", (code, signal) => resolveExit({ code, signal }));
  });
}

const tempRoot = mkdtempSync(join(tmpdir(), "codex-future-reply-pg17-"));
const dataDir = join(tempRoot, "data");
const port = await reserveLoopbackPort();
let serverStarted = false;
let lockHolder;

try {
  process.stdout.write("initializing isolated PostgreSQL cluster\n");
  run(initdb, ["-D", dataDir, "-U", "postgres", "--no-locale", "--encoding=UTF8", "--auth-local=trust", "--auth-host=trust"]);
  const startResult = spawnSync(pgCtl, [
    "-D", dataDir,
    "-l", join(tempRoot, "postgres.log"),
    "-o", `-p ${port} -h 127.0.0.1 -c listen_addresses=127.0.0.1`,
    "-w", "start",
  ], { stdio: "ignore" });
  if (startResult.status !== 0) throw new Error(`pg_ctl start failed (${startResult.status ?? startResult.signal})`);
  serverStarted = true;
  process.stdout.write("loading actual v1/v2 functions and future-reply migration\n");

  const setupFile = join(tempRoot, "setup-and-assert.sql");
  writeFileSync(setupFile, [schema, actualFunctions, futureReplyMigration, assertions].join("\n\n"), "utf8");
  const twoSessionSeedFile = join(tempRoot, "two-session-seed.sql");
  writeFileSync(twoSessionSeedFile, twoSessionSeed, "utf8");
  const integrationOutput = run(psql, psqlArgs(port, ["-f", setupFile]));
  process.stdout.write(`${version}\n${integrationOutput}`);

  runTwoSessionStaleProofCase(port, tempRoot, twoSessionSeedFile, "manual");
  runTwoSessionStaleProofCase(port, tempRoot, twoSessionSeedFile, "context");
  process.stdout.write("two-session manual/context stale-proof fallback passed\n");

  // Hold the monitor advisory lock in session 1 while session 2 runs the real
  // v2 RPC with an immutable BANKED observation. The v2 identity lock must
  // wait and time out before its call into the actual v1 compare-and-swap.
  const holderFile = join(tempRoot, "hold-source-lock.sql");
  writeFileSync(holderFile, [
    "begin;",
    "select pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtext('codex-usage-webhook:local-codex-app-server'));",
    "\\echo FUTURE_REPLY_SOURCE_LOCK_HELD",
    "select pg_catalog.pg_sleep(1.5);",
    "commit;",
  ].join("\n"), "utf8");
  lockHolder = spawn(psql, psqlArgs(port, ["-f", holderFile]), { stdio: ["ignore", "pipe", "pipe"] });
  process.stdout.write("checking two-session v2 serialization\n");
  await waitForMarker(lockHolder, "FUTURE_REPLY_SOURCE_LOCK_HELD");

  const concurrentPlan = JSON.stringify({
    source_key: "local-codex-app-server",
    expected_previous_observed_at: "2026-10-22T17:59:00Z",
    state: {
      source_key: "local-codex-app-server",
      observed_at: "2026-10-22T18:04:00Z",
      received_at: "2026-10-22T18:04:01Z",
      limit_id: "codex",
      plan_type: "plus",
      used_percent: 0,
      window_duration_mins: 10080,
      resets_at: 1800172800,
      coverage_started_at: "2026-10-22T17:54:00Z",
      banked_reset_available_count: 0,
      last_banked_grant_at: null,
      updated_at: "2026-10-22T18:04:01Z",
    },
    banked_grant_observation: {
      observation_key: "codex-future-reply-v2-lock-observation",
      reset_event_key: "codex-future-reply-v2-lock-event",
      source_key: "local-codex-app-server",
      limit_id: "codex",
      plan_type: "plus",
      previous_observed_at: "2026-10-22T17:59:00Z",
      observed_at: "2026-10-22T18:04:00Z",
      received_at: "2026-10-22T18:04:01Z",
      previous_available_count: 0,
      current_available_count: 1,
      observation_window_start_at: "2026-10-22T17:59:00Z",
      observation_window_end_at: "2026-10-22T18:04:00Z",
      execution_time_precision: "approximate",
    },
    banked_post_association_decision: {
      observation_key: "codex-future-reply-v2-lock-observation",
      status: "pending",
    },
  });
  const contentionFile = join(tempRoot, "contended-v2.sql");
  writeFileSync(contentionFile, [
    "set lock_timeout = '250ms';",
    `select public.apply_codex_usage_webhook_write_v2('${concurrentPlan.replaceAll("'", "''")}'::jsonb);`,
  ].join("\n"), "utf8");
  const contended = spawnSync(psql, psqlArgs(port, ["-f", contentionFile]), { encoding: "utf8" });
  const contentionOutput = `${contended.stdout ?? ""}${contended.stderr ?? ""}`;
  assert.notEqual(contended.status, 0, `v2 unexpectedly bypassed the active monitor lock:\n${contentionOutput}`);
  assert.match(contentionOutput, /lock timeout/i, `expected v2 to wait on the actual v1 monitor lock:\n${contentionOutput}`);

  const holderResult = await waitForExit(lockHolder);
  lockHolder = undefined;
  assert.equal(holderResult.code, 0, `lock-holder session failed (${holderResult.signal ?? "no signal"})`);

  const retryFile = join(tempRoot, "retry-v2.sql");
  writeFileSync(retryFile, `select public.apply_codex_usage_webhook_write_v2('${concurrentPlan.replaceAll("'", "''")}'::jsonb);`, "utf8");
  const retryOutput = run(psql, psqlArgs(port, ["-f", retryFile]));
  assert.match(retryOutput, /applied/, "v2 succeeds after the competing source lock is released");
  const bankedFactCount = run(psql, psqlArgs(port, [
    "-q", "-A", "-t", "-c",
    "select count(*) from public.codex_banked_grant_observations where observation_key = 'codex-future-reply-v2-lock-observation';",
  ])).trim();
  assert.equal(bankedFactCount, "1", "actual v2 writes its locked immutable observation after serialization");
  process.stdout.write("two-session v2 lock serialization passed\n");
} finally {
  if (lockHolder) {
    lockHolder.kill();
    await waitForExit(lockHolder).catch(() => undefined);
  }
  if (serverStarted) {
    const stop = spawnSync(pgCtl, ["-D", dataDir, "-m", "fast", "-w", "stop"], { encoding: "utf8" });
    if (stop.status !== 0) process.stderr.write(`${stop.stderr ?? stop.stdout ?? "Could not stop temporary PostgreSQL"}\n`);
  }
  rmSync(tempRoot, { recursive: true, force: true });
}
