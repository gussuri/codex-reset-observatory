import {
  PROBABILITY_MODEL_POINTERS,
  PROBABILITY_MODEL_REGISTRY,
  PUBLIC_PROBABILITY_PERIOD_REGISTRY,
  getCurrentPublicProbabilityModel,
} from "../data/probabilityModelRegistry";

const json = process.argv.slice(2).includes("--json");

if (json) {
  console.log(JSON.stringify({
    currentPublic: getCurrentPublicProbabilityModel(),
    pointers: PROBABILITY_MODEL_POINTERS,
    publicPeriods: PUBLIC_PROBABILITY_PERIOD_REGISTRY,
    models: PROBABILITY_MODEL_REGISTRY,
  }, null, 2));
} else {
  const current = getCurrentPublicProbabilityModel();
  const publicHistory = PROBABILITY_MODEL_REGISTRY.filter((entry) => entry.publicStatus === "historical");
  const activeShadow = PROBABILITY_MODEL_REGISTRY.filter((entry) =>
    entry.publicStatus === "never"
    && entry.status === "active"
    && entry.kind !== "diagnostic"
    && !entry.roles.includes("evaluation-only"),
  );
  const diagnostics = PROBABILITY_MODEL_REGISTRY.filter((entry) =>
    entry.kind === "diagnostic" || entry.roles.includes("evaluation-only"),
  );
  const archived = PROBABILITY_MODEL_REGISTRY.filter(
    (entry) => entry.status === "archived" || entry.status === "retired",
  );

  console.log("CURRENT PUBLIC");
  console.log("  key: " + current.key);
  console.log("  modelVersion: " + current.modelVersion);
  console.log("  previous public: " + PROBABILITY_MODEL_POINTERS.previousPublic);
  console.log("  stable fallback: " + PROBABILITY_MODEL_POINTERS.stableFallback);
  console.log("");
  console.log("PUBLIC HISTORY");
  for (const period of PUBLIC_PROBABILITY_PERIOD_REGISTRY) {
    console.log("  " + period.id + ": " + period.modelVersion + " [" + (period.startAt ?? "initial") + " .. " + (period.endAt ?? "open") + "]");
  }
  console.log("");

  for (const [title, entries] of [
    ["ACTIVE / SHADOW", activeShadow],
    ["DIAGNOSTIC / EVALUATION-ONLY", diagnostics],
    ["ARCHIVED / LEGACY", archived],
  ] as const) {
    console.log(title);
    for (const entry of entries) {
      console.log("  " + entry.key + " -> " + entry.modelVersion);
    }
    console.log("");
  }

  console.log("PUBLIC HISTORY MODEL ENTRIES");
  for (const entry of publicHistory) {
    console.log("  " + entry.key + " -> " + entry.modelVersion);
  }
}
