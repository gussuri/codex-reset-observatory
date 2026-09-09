import path from "node:path";
import { fileURLToPath } from "node:url";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import {
  applyResetRejection,
  validateResetRejectionInput,
  type ResetRejectionInput,
  type ResetRejectionResult,
} from "../lib/radar/resetRejectionStore";

const VALUE_FLAGS = {
  "--event-key": "eventKey",
  "-e": "eventKey",
  "--reason": "reason",
  "-r": "reason",
  "--by": "by",
  "--format": "format",
} as const;

export type ParsedResetRejectionArgs = {
  apply: boolean;
  format: "json" | "pretty";
  input: ResetRejectionInput;
};

export type ResetRejectionExecutor = (
  client: SupabaseClient<any>,
  input: ResetRejectionInput,
  options: { apply?: boolean },
) => Promise<ResetRejectionResult>;

export function parseResetRejectionArgs(args: string[]): ParsedResetRejectionArgs {
  const values: Partial<Record<string, string>> = {};
  let apply = false;
  let format: "json" | "pretty" = "json";

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === "--apply") {
      if (apply) throw new Error("--apply may only be specified once");
      apply = true;
      continue;
    }

    if (arg === "--help" || arg === "-h") {
      continue;
    }

    const field = VALUE_FLAGS[arg as keyof typeof VALUE_FLAGS];
    if (!field) {
      throw new Error(`Unknown argument: ${arg}`);
    }

    if (values[field] !== undefined) {
      throw new Error(`${arg} may only be specified once`);
    }

    const value = args[index + 1];
    if (value === undefined || value.startsWith("--") || (value.startsWith("-") && value.length === 2)) {
      throw new Error(`${arg} is required and must take a value`);
    }

    values[field] = value;
    index += 1;
  }

  if (values.format === "pretty" || values.format === "json") {
    format = values.format;
  } else if (values.format) {
    throw new Error(`Invalid format '${values.format}'. Supported formats: json, pretty`);
  }

  const validated = validateResetRejectionInput({
    eventKey: values.eventKey ?? "",
    reason: values.reason ?? "",
    by: values.by ?? "operator",
  });

  return {
    apply,
    format,
    input: validated,
  };
}

export const USAGE = [
  "Usage:",
  "  pnpm exec tsx scripts/reject-reset-event.ts",
  "    --event-key <eventKey>",
  "    --reason <rejection reason>",
  "    [--by <operator>] [--apply] [--format json|pretty]",
  "",
  "Examples:",
  "  # Dry-run inspection (default, no DB writes):",
  "  npm run reset:reject -- --event-key usage-reset-512a8b31-e43e-4f91-b5e6-7023b87e80ec --reason \"Monitor false positive\"",
  "",
  "  # Explicit logical rejection execution:",
  "  npm run reset:reject -- --event-key usage-reset-512a8b31-e43e-4f91-b5e6-7023b87e80ec --reason \"Monitor false positive\" --by \"oncall\" --apply",
  "",
  "Options:",
  "  --event-key, -e   Target reset event key (e.g. usage-reset-<uuid> or raw <uuid>). [Required]",
  "  --reason, -r      Audit reason explaining why this reset event is being rejected. [Required]",
  "  --by              Operator or service identity performing the rejection. [Default: operator]",
  "  --apply           Explicitly execute the logical invalidation against Supabase. Without this flag, a dry-run is performed.",
  "  --format          Output formatting ('json' or 'pretty'). [Default: json]",
  "  --help, -h        Show this help message.",
].join("\n");

export function getSupabaseClient(): SupabaseClient<any> {
  const url = process.env.SUPABASE_URL?.trim();
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim();
  if (!url || !key) {
    throw new Error("SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY environment variables are required.");
  }
  return createClient(url, key, { auth: { persistSession: false } });
}

export async function runResetRejectionCli(
  args: string[],
  options: {
    client?: SupabaseClient<any>;
    execute?: ResetRejectionExecutor;
  } = {},
): Promise<number> {
  if (args.includes("--help") || args.includes("-h")) {
    console.log(USAGE);
    return 0;
  }

  const parsed = parseResetRejectionArgs(args);
  const client = options.client ?? getSupabaseClient();
  const execute = options.execute ?? applyResetRejection;

  const result = await execute(client, parsed.input, { apply: parsed.apply });

  if (parsed.format === "pretty") {
    console.log("==================================================");
    console.log(`[RESET REJECTION] Status: ${result.status.toUpperCase()}`);
    console.log("==================================================");
    console.log(`Event Key:     ${result.eventKey}`);
    console.log(`Apply Flag:    ${result.apply ? "YES (DB Write)" : "NO (Dry Run)"}`);
    console.log(`Message:       ${result.message}`);
    if (result.target) {
      console.log(`Canonical Key: ${result.target.canonicalEventKey}`);
      console.log(`Target Status: ${result.target.overallStatus}`);
      console.log(`Execution At:  ${result.target.summary.displayExecutionAt ?? "N/A"}`);
      console.log(`Source:        ${result.target.summary.executionTimeSource ?? "N/A"}`);
      console.log(`Public?:       ${result.target.summary.isPublicEstimate ? "YES" : "NO"}`);
      console.log(`Impact:        ${result.target.summary.probabilityEligibilityImpact}`);
    }
    if (result.audit) {
      console.log(`Audit Reason:  ${result.audit.rejectionReason}`);
      console.log(`Audit By:      ${result.audit.rejectedBy}`);
      console.log(`Audit At:      ${result.audit.rejectedAt}`);
    }
    console.log(`Cache Tag:     ${result.cacheInvalidation.tag} (revalidated: ${result.cacheInvalidation.revalidated})`);
    console.log("==================================================");
  } else {
    console.log(JSON.stringify(result, null, 2));
  }

  if (result.status === "not_found") {
    console.error(`Error: Reset event key '${result.eventKey}' was not found in the database.`);
    return 1;
  }

  return 0;
}

async function main() {
  const args = process.argv.slice(2);
  return runResetRejectionCli(args);
}

const currentModulePath = path.resolve(fileURLToPath(import.meta.url));
const invokedModulePath = process.argv[1] ? path.resolve(process.argv[1]) : null;
if (invokedModulePath === currentModulePath) {
  main()
    .then((exitCode) => {
      process.exitCode = exitCode;
    })
    .catch((error: unknown) => {
      console.error(error instanceof Error ? error.message : error);
      process.exitCode = 1;
    });
}
