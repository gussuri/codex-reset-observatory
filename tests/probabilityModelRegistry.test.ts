import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import test from "node:test";

import * as shadowConfig from "../data/shadowProbabilityConfig";
import { PROBABILITY_MODEL_VERSION } from "../data/predictionWeights";
import { BOUNDARY_CENSORED_MODEL_VERSION } from "../lib/radar/boundaryCensoredProbability";
import {
  CALIBRATED_V2_MODEL_VERSION,
  CONSTANT_HAZARD_MODEL_VERSION,
} from "../scripts/evaluateProbabilityModels";
import { normalizeLineEndings } from "../scripts/normalizeLineEndings";
import { getPublishedProbabilityPeriodAt } from "../lib/radar/publishedProbability";
import {
  BROAD_BANKED_LATE_AGE_REGIME_DIAGNOSTIC_MODEL_VERSIONS,
  BROAD_BANKED_RANDOM_CLOCK_V2_MODEL_VERSION,
  CALIBRATED_SHADOW_MODEL_VERSION,
  ELAPSED_ONLY_MODEL_VERSION,
  NEXT_GENERATION_A_COMPONENT_VERSIONS,
  PUBLISHED_BROAD_BANKED_V2_ADOPTION_AT,
  PUBLISHED_SURVIVAL_CONDITIONED_ADOPTION_AT,
  PUBLISHED_PROBABILITY_MODEL_VERSION,
  SURVIVAL_CONDITIONED_MODEL_VERSION,
  RANDOM_LATE_AGE_REGIME_DIAGNOSTIC_MODEL_VERSIONS,
} from "../data/shadowProbabilityConfig";
import {
  CURRENT_PUBLIC_PROBABILITY_MODEL,
  PROBABILITY_MODEL_POINTERS,
  PROBABILITY_MODEL_REGISTRY,
  PUBLIC_PROBABILITY_PERIOD_REGISTRY,
  formatProbabilityModelRegistryMarkdown,
  getCurrentPublicProbabilityModel,
  getCurrentPublicProbabilityPeriod,
  getProbabilityModelByKey,
  getProbabilityModelByVersion,
  getProbabilityModelsByFamily,
  getProbabilityModelsByRole,
  getProbabilityPeriodAt,
} from "../data/probabilityModelRegistry";

const MODEL_REGISTRY_DOC = resolve("docs/probability/model-registry.md");
const SHADOW_CONFIG_SOURCE = resolve("data/shadowProbabilityConfig.ts");

function collectDeclaredModelVersionExports() {
  const source = readFileSync(SHADOW_CONFIG_SOURCE, "utf8");
  const names = Array.from(
    source.matchAll(/export\s+const\s+([A-Z][A-Z0-9_]*MODEL_VERSION[A-Z0-9_]*)\s*=/g),
    (match) => match[1],
  );
  const values = new Set<string>();

  for (const name of names) {
    const value = (shadowConfig as Record<string, unknown>)[name];
    if (typeof value === "string") {
      values.add(value);
      continue;
    }
    if (Array.isArray(value) && value.every((item) => typeof item === "string")) {
      for (const item of value) values.add(item);
      continue;
    }
    assert.fail(name + " is a model-version export with an unsupported value");
  }

  return values;
}

function collectExplicitNonConfigModelIdentities() {
  return new Set([
    PROBABILITY_MODEL_VERSION,
    BOUNDARY_CENSORED_MODEL_VERSION,
    CONSTANT_HAZARD_MODEL_VERSION,
    CALIBRATED_V2_MODEL_VERSION,
    ...shadowConfig.RECENCY_SHADOW_MODEL_CONFIG.map((entry) => entry.modelVersion),
    ...NEXT_GENERATION_A_COMPONENT_VERSIONS,
  ]);
}

test("probability model registry has unique keys and model identities", () => {
  const keys = PROBABILITY_MODEL_REGISTRY.map((entry) => entry.key);
  const modelVersions = PROBABILITY_MODEL_REGISTRY.map((entry) => entry.modelVersion);

  assert.equal(new Set(keys).size, keys.length);
  assert.equal(new Set(modelVersions).size, modelVersions.length);
});

test("the current public model and pointer view resolve to registered identities", () => {
  const current = getCurrentPublicProbabilityModel();
  assert.equal(current, CURRENT_PUBLIC_PROBABILITY_MODEL);
  assert.equal(current.modelVersion, PUBLISHED_PROBABILITY_MODEL_VERSION);
  assert.equal(current.publicStatus, "current");
  assert.equal(
    PROBABILITY_MODEL_REGISTRY.filter((entry) => entry.publicStatus === "current").length,
    1,
  );
  assert.equal(PROBABILITY_MODEL_POINTERS.currentPublic, PUBLISHED_PROBABILITY_MODEL_VERSION);
  assert.ok(getProbabilityModelByVersion(PROBABILITY_MODEL_POINTERS.previousPublic));
  assert.ok(getProbabilityModelByVersion(PROBABILITY_MODEL_POINTERS.stableFallback));
  assert.equal(getCurrentPublicProbabilityPeriod().id, "broad-banked-v2");
  assert.equal(getCurrentPublicProbabilityPeriod().modelVersion, PUBLISHED_PROBABILITY_MODEL_VERSION);
  assert.equal(
    PUBLIC_PROBABILITY_PERIOD_REGISTRY.at(-1)?.modelVersion,
    SURVIVAL_CONDITIONED_MODEL_VERSION,
  );
});

test("heuristic-v2-time-consistent is a fallback model but not a public period", () => {
  const heuristic = getProbabilityModelByVersion(PROBABILITY_MODEL_VERSION);

  assert.ok(heuristic);
  assert.equal(heuristic.key, "heuristic/time-consistent/v2");
  assert.equal(heuristic.modelVersion, PROBABILITY_MODEL_VERSION);
  assert.equal(heuristic.displayName, "Heuristic Time-Consistent v2");
  assert.equal(heuristic.family, "heuristic");
  assert.equal(heuristic.variant, "time-consistent");
  assert.equal(heuristic.revision, "v2");
  assert.equal(heuristic.kind, "forecast");
  assert.equal(heuristic.publicStatus, "never");
  assert.equal(heuristic.status, "active");
  assert.deepEqual(heuristic.roles, ["fallback"]);
  assert.equal(heuristic.parentModelVersion, null);
  assert.equal(heuristic.comparisonBaselineModelVersion, null);
  assert.equal(heuristic.freezeAt, null);
  assert.equal(heuristic.eligibilityPolicyVersion, null);
  assert.equal(heuristic.regimePolicyVersion, null);
  assert.equal(heuristic.bandwidthHours, null);
  assert.equal(heuristic.truncationHours, null);
  assert.equal(heuristic.calibration, "none");
  assert.equal(heuristic.differenceFromParent, "");
  assert.equal(
    heuristic.notes,
    "Final heuristic runtime fallback used by the local probability calculation path.",
  );
  assert.equal(
    PUBLIC_PROBABILITY_PERIOD_REGISTRY.some((period) => period.modelVersion === PROBABILITY_MODEL_VERSION),
    false,
  );
});

test("explicit model-version inventory is fully covered without broad hazard-string scraping", () => {
  const registryVersions = new Set(PROBABILITY_MODEL_REGISTRY.map((entry) => entry.modelVersion));
  const required = new Set<string>([
    ...Array.from(collectDeclaredModelVersionExports()),
    ...Array.from(collectExplicitNonConfigModelIdentities()),
  ]);

  for (const modelVersion of Array.from(required)) {
    assert.equal(
      registryVersions.has(modelVersion),
      true,
      "missing registry entry for " + modelVersion,
    );
  }
});

test("parent and comparison-baseline references resolve to registry entries", () => {
  for (const entry of PROBABILITY_MODEL_REGISTRY) {
    if (entry.parentModelVersion !== null) {
      assert.ok(getProbabilityModelByVersion(entry.parentModelVersion));
    }
    if (entry.comparisonBaselineModelVersion !== null) {
      assert.ok(getProbabilityModelByVersion(entry.comparisonBaselineModelVersion));
    }
  }
});

test("broad-banked late-age diagnostic arms are never public", () => {
  for (const modelVersion of BROAD_BANKED_LATE_AGE_REGIME_DIAGNOSTIC_MODEL_VERSIONS) {
    const entry = getProbabilityModelByVersion(modelVersion);
    assert.ok(entry);
    assert.equal(entry.kind, "diagnostic");
    assert.equal(entry.publicStatus, "never");
    assert.ok(entry.roles.includes("diagnostic"));
    assert.notEqual(entry.publicStatus, "current");
    assert.equal(
      PUBLIC_PROBABILITY_PERIOD_REGISTRY.some((period) => period.modelVersion === modelVersion),
      false,
    );
  }
});

test("public probability period registry is contiguous with one open-ended current period", () => {
  const ids = PUBLIC_PROBABILITY_PERIOD_REGISTRY.map((period) => period.id);
  assert.equal(new Set(ids).size, ids.length);
  assert.equal(PUBLIC_PROBABILITY_PERIOD_REGISTRY.filter((period) => period.endAt === null).length, 1);
  assert.equal(
    getCurrentPublicProbabilityPeriod().endAt,
    PUBLISHED_SURVIVAL_CONDITIONED_ADOPTION_AT,
  );

  for (let index = 1; index < PUBLIC_PROBABILITY_PERIOD_REGISTRY.length; index += 1) {
    const previous = PUBLIC_PROBABILITY_PERIOD_REGISTRY[index - 1];
    const current = PUBLIC_PROBABILITY_PERIOD_REGISTRY[index];
    assert.notEqual(current.startAt, null);
    assert.equal(previous.endAt, current.startAt);
    assert.ok(Date.parse(current.startAt!) > Date.parse(previous.startAt ?? "1970-01-01T00:00:00.000Z"));
  }

  assert.equal(
    PUBLIC_PROBABILITY_PERIOD_REGISTRY.find((period) => period.id === "broad-banked-v2")?.startAt,
    PUBLISHED_BROAD_BANKED_V2_ADOPTION_AT,
  );
  assert.equal(
    PUBLIC_PROBABILITY_PERIOD_REGISTRY.find((period) => period.id === "broad-banked-v2")?.modelVersion,
    BROAD_BANKED_RANDOM_CLOCK_V2_MODEL_VERSION,
  );
  assert.equal(
    PUBLIC_PROBABILITY_PERIOD_REGISTRY.find((period) => period.id === "survival-conditioned-v1")?.startAt,
    PUBLISHED_SURVIVAL_CONDITIONED_ADOPTION_AT,
  );
});

test("registry period classification matches the unchanged public selector at every boundary", () => {
  for (const period of PUBLIC_PROBABILITY_PERIOD_REGISTRY) {
    if (period.startAt === null) continue;

    const boundary = Date.parse(period.startAt);
    assert.ok(Number.isFinite(boundary));
    for (const delta of [-1, 0, 1]) {
      const at = new Date(boundary + delta);
      assert.equal(
        getPublishedProbabilityPeriodAt(at),
        getProbabilityPeriodAt(at)?.id ?? null,
        period.id + " boundary delta " + delta,
      );
    }
  }

  assert.equal(
    getProbabilityPeriodAt(new Date(Date.parse(PUBLISHED_BROAD_BANKED_V2_ADOPTION_AT!) - 1))?.id,
    "raw-continuous-18-54",
  );
  assert.equal(
    getProbabilityPeriodAt(PUBLISHED_BROAD_BANKED_V2_ADOPTION_AT!)?.id,
    "broad-banked-v2",
  );
  assert.equal(
    getProbabilityPeriodAt(PUBLISHED_SURVIVAL_CONDITIONED_ADOPTION_AT!)?.id,
    "survival-conditioned-v1",
  );
});

test("registry lookup helpers remain pure and return the expected slices", () => {
  assert.equal(getProbabilityModelByKey("heuristic/time-consistent/v2")?.modelVersion, PROBABILITY_MODEL_VERSION);
  assert.equal(
    getProbabilityModelsByFamily("heuristic").some((entry) => entry.modelVersion === PROBABILITY_MODEL_VERSION),
    true,
  );
  assert.equal(
    getProbabilityModelsByRole("fallback").some((entry) => entry.modelVersion === PROBABILITY_MODEL_VERSION),
    true,
  );
  assert.deepEqual(
    getCurrentPublicProbabilityModel(),
    getProbabilityModelByVersion(PUBLISHED_PROBABILITY_MODEL_VERSION),
  );
  assert.notEqual(getCurrentPublicProbabilityPeriod(), PUBLIC_PROBABILITY_PERIOD_REGISTRY[0]);
});

test("generated registry documentation is synchronized", () => {
  const expected = formatProbabilityModelRegistryMarkdown();
  assert.equal(
    normalizeLineEndings(readFileSync(MODEL_REGISTRY_DOC, "utf8")),
    normalizeLineEndings(expected),
  );
});

test("required public and diagnostic identities remain separated by family", () => {
  assert.equal(
    getProbabilityModelByVersion(BROAD_BANKED_RANDOM_CLOCK_V2_MODEL_VERSION)?.family,
    "broad-banked",
  );
  assert.equal(
    getProbabilityModelByVersion(shadowConfig.NEXT_GENERATION_B_POST_RESET_AGE_MODEL_VERSION)?.family,
    "b-family",
  );
  assert.notEqual(
    getProbabilityModelByVersion(BROAD_BANKED_RANDOM_CLOCK_V2_MODEL_VERSION)?.family,
    getProbabilityModelByVersion(shadowConfig.NEXT_GENERATION_B_POST_RESET_AGE_MODEL_VERSION)?.family,
  );
  assert.equal(
    getProbabilityModelByVersion(CALIBRATED_SHADOW_MODEL_VERSION)?.publicStatus,
    "historical",
  );
  assert.equal(
    getProbabilityModelByVersion(ELAPSED_ONLY_MODEL_VERSION)?.publicStatus,
    "historical",
  );
  assert.equal(RANDOM_LATE_AGE_REGIME_DIAGNOSTIC_MODEL_VERSIONS.length, 4);
});
