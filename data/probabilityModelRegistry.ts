import {
  BROAD_BANKED_LATE_AGE_REGIME_DIAGNOSTIC_CONTROL_MODEL_VERSION,
  BROAD_BANKED_LATE_AGE_REGIME_DIAGNOSTIC_LATE_NEUTRAL_MODEL_VERSION,
  BROAD_BANKED_LATE_AGE_REGIME_DIAGNOSTIC_LATE_NO_DOWNWARD_MODEL_VERSION,
  BROAD_BANKED_LATE_AGE_REGIME_DIAGNOSTIC_MODEL_VERSIONS,
  BROAD_BANKED_LATE_AGE_REGIME_DIAGNOSTIC_PRE_RESET_FROZEN_MODEL_VERSION,
  BROAD_BANKED_RANDOM_CLOCK_V2_FREEZE_AT,
  BROAD_BANKED_RANDOM_CLOCK_V2_MODEL_VERSION,
  BROAD_BANKED_RANDOM_CLOCK_V2_POLICY_VERSION,
  CALIBRATED_SHADOW_ARCHIVED_MODEL_VERSIONS,
  CALIBRATED_SHADOW_MODEL_VERSION,
  CALIBRATED_SHADOW_MODEL_VERSION_V1,
  CALIBRATED_SHADOW_MODEL_VERSION_V2,
  CONTEXT_AWARE_CONTINUOUS_PROBABILITY_FREEZE_AT,
  CONTEXT_AWARE_CONTINUOUS_PROBABILITY_MODEL_VERSION,
  ELAPSED_ONLY_MODEL_VERSION,
  LEGACY_RANDOM_RESET_ELIGIBILITY_POLICY,
  LEGACY_SHADOW_PROBABILITY_MODEL_VERSION,
  NEXT_GENERATION_A_COMPONENT_VERSIONS,
  NEXT_GENERATION_A_MODEL_VERSION,
  NEXT_GENERATION_B_MODEL_VERSION,
  NEXT_GENERATION_B_POST_RESET_AGE_MODEL_VERSION,
  NEXT_GENERATION_B_POST_RESET_AGE_POLICY_VERSION,
  NEXT_GENERATION_C_MODEL_VERSION,
  NEXT_GENERATION_C_V2_FREEZE_AT,
  NEXT_GENERATION_C_V2_MODEL_VERSION,
  NEXT_GENERATION_C_FREEZE_AT,
  NEXT_GENERATION_FREEZE_AT,
  NEXT_GENERATION_SELECTIVE_CALIBRATION_MODEL_VERSION,
  NEXT_GENERATION_V3_MODEL_VERSION,
  PUBLISHED_BROAD_BANKED_V2_ADOPTION_AT,
  PUBLISHED_SURVIVAL_CONDITIONED_ADOPTION_AT,
  PUBLISHED_PROBABILITY_ADOPTION_AT,
  PUBLISHED_PROBABILITY_B_MODEL_ADOPTION_AT,
  PUBLISHED_PROBABILITY_HISTORICAL_V4_ADOPTION_AT,
  PUBLISHED_PROBABILITY_MODEL_VERSION,
  PUBLISHED_PROBABILITY_PREVIOUS_ADOPTION_AT,
  PUBLISHED_PROBABILITY_PREVIOUS_MODEL_VERSION,
  PUBLISHED_PROBABILITY_V4_ROLLBACK_AT,
  PUBLISHED_RAW_CONTINUOUS_18_54_ADOPTION_AT,
  SURVIVAL_CONDITIONED_BIN_HOURS,
  SURVIVAL_CONDITIONED_FREEZE_AT,
  SURVIVAL_CONDITIONED_MODEL_VERSION,
  SURVIVAL_CONTEXT_BURST_MODEL_VERSION,
  SURVIVAL_CONTEXT_CIRCADIAN_MODEL_VERSION,
  SURVIVAL_CONTEXT_OLD_REGIME_MODEL_VERSION,
  SURVIVAL_CONTEXT_PREVIOUS_INTERVAL_CIRCADIAN_MODEL_VERSION,
  SURVIVAL_CONTEXT_PREVIOUS_INTERVAL_MODEL_VERSION,
  RANDOM_BANDWIDTH_AGE_DIAGNOSTIC_BANDWIDTH_HOURS,
  RANDOM_BANDWIDTH_AGE_DIAGNOSTIC_FREEZE_AT,
  RANDOM_BANDWIDTH_AGE_DIAGNOSTIC_MODEL_VERSIONS,
  RANDOM_BANDWIDTH_AGE_DIAGNOSTIC_TRUNCATION_HOURS,
  RANDOM_BANDWIDTH_TRUNCATION_SHADOW_CHALLENGER_MODEL_VERSION,
  RANDOM_BANDWIDTH_TRUNCATION_SHADOW_CONTROL_MODEL_VERSION,
  RANDOM_BANDWIDTH_TRUNCATION_SHADOW_FREEZE_AT,
  RANDOM_CONTINUOUS_SHADOW_BANDWIDTH_HOURS,
  RANDOM_CONTINUOUS_SHADOW_FREEZE_AT,
  RANDOM_CONTINUOUS_SHADOW_MODEL_VERSION,
  RANDOM_CONTINUOUS_SHADOW_TRUNCATION_HOURS,
  RANDOM_ELAPSED_SHADOW_FREEZE_AT,
  RANDOM_ELAPSED_SHADOW_MODEL_VERSION,
  RANDOM_LATE_AGE_REGIME_DIAGNOSTIC_CONTROL_MODEL_VERSION,
  RANDOM_LATE_AGE_REGIME_DIAGNOSTIC_FREEZE_AT,
  RANDOM_LATE_AGE_REGIME_DIAGNOSTIC_LATE_NEUTRAL_MODEL_VERSION,
  RANDOM_LATE_AGE_REGIME_DIAGNOSTIC_LATE_NO_DOWNWARD_MODEL_VERSION,
  RANDOM_LATE_AGE_REGIME_DIAGNOSTIC_MODEL_VERSIONS,
  RANDOM_LATE_AGE_REGIME_DIAGNOSTIC_PRE_RESET_FROZEN_MODEL_VERSION,
  RECENCY_H30_PROBABILITY_MODEL_VERSION,
  RECENCY_SHADOW_MODEL_CONFIG,
  REGIME_ELAPSED_FULL_MODEL_VERSION,
  SHADOW_PROBABILITY_MODEL_VERSION,
} from "./shadowProbabilityConfig";
import { PROBABILITY_MODEL_VERSION } from "./predictionWeights";
import { BOUNDARY_CENSORED_MODEL_VERSION } from "../lib/radar/boundaryCensoredProbability";
import {
  CALIBRATED_V2_MODEL_VERSION,
  CONSTANT_HAZARD_MODEL_VERSION,
} from "../scripts/evaluateProbabilityModels";

export type ProbabilityModelKind = "forecast" | "diagnostic" | "ensemble";
export type ProbabilityModelPublicStatus = "current" | "scheduled" | "historical" | "never";
export type ProbabilityModelLifecycleStatus = "active" | "archived" | "retired";
export type ProbabilityModelRole =
  | "public-runtime"
  | "fallback"
  | "shadow"
  | "diagnostic"
  | "experimental-log"
  | "ensemble-component"
  | "evaluation-only";
export type ProbabilityModelCalibration =
  | "none"
  | "prequential-logit"
  | "selective"
  | "contextual"
  | null;

export type ProbabilityModelRegistryEntry = {
  key: string;
  modelVersion: string;
  displayName: string;
  family: string;
  variant: string;
  revision: string;
  kind: ProbabilityModelKind;
  publicStatus: ProbabilityModelPublicStatus;
  status: ProbabilityModelLifecycleStatus;
  roles: readonly ProbabilityModelRole[];
  parentModelVersion: string | null;
  comparisonBaselineModelVersion: string | null;
  freezeAt: string | null;
  eligibilityPolicyVersion: string | null;
  regimePolicyVersion: string | null;
  bandwidthHours: number | null;
  truncationHours: number | null;
  calibration: ProbabilityModelCalibration;
  differenceFromParent: string;
  notes: string | null;
};

export type PublicProbabilityPeriodId =
  | "historical-elapsed-v1"
  | "historical-v4"
  | "b-v1"
  | "b-v2"
  | "selective-v3"
  | "corrective-rollback-v4"
  | "raw-continuous-18-54"
  | "broad-banked-v2"
  | "survival-conditioned-v1";

export type PublicProbabilityPeriodEntry = {
  id: PublicProbabilityPeriodId;
  modelVersion: string;
  startAt: string | null;
  endAt: string | null;
  adoptionMode: "manual";
  note: string;
};

type ModelEntryInput = Omit<
  ProbabilityModelRegistryEntry,
  | "parentModelVersion"
  | "comparisonBaselineModelVersion"
  | "freezeAt"
  | "eligibilityPolicyVersion"
  | "regimePolicyVersion"
  | "bandwidthHours"
  | "truncationHours"
  | "calibration"
  | "differenceFromParent"
  | "notes"
> & Partial<Pick<
  ProbabilityModelRegistryEntry,
  | "parentModelVersion"
  | "comparisonBaselineModelVersion"
  | "freezeAt"
  | "eligibilityPolicyVersion"
  | "regimePolicyVersion"
  | "bandwidthHours"
  | "truncationHours"
  | "calibration"
  | "differenceFromParent"
  | "notes"
>>;

function model(input: ModelEntryInput): ProbabilityModelRegistryEntry {
  return {
    parentModelVersion: null,
    comparisonBaselineModelVersion: null,
    freezeAt: null,
    eligibilityPolicyVersion: null,
    regimePolicyVersion: null,
    bandwidthHours: null,
    truncationHours: null,
    calibration: null,
    differenceFromParent: "",
    notes: null,
    ...input,
    roles: [...input.roles],
  };
}

const lateAgeV1Entries: readonly ProbabilityModelRegistryEntry[] = [
  model({
    key: "late-age/control/v1",
    modelVersion: RANDOM_LATE_AGE_REGIME_DIAGNOSTIC_CONTROL_MODEL_VERSION,
    displayName: "Random Continuous Late-Age Regime Control v1",
    family: "late-age-regime",
    variant: "control",
    revision: "v1",
    kind: "diagnostic",
    publicStatus: "never",
    status: "active",
    roles: ["diagnostic", "experimental-log"],
    freezeAt: RANDOM_LATE_AGE_REGIME_DIAGNOSTIC_FREEZE_AT,
    eligibilityPolicyVersion: LEGACY_RANDOM_RESET_ELIGIBILITY_POLICY,
    bandwidthHours: 18,
    truncationHours: 54,
    calibration: "none",
    notes: "Legacy late-age diagnostic control arm.",
  }),
  model({
    key: "late-age/neutral/v1",
    modelVersion: RANDOM_LATE_AGE_REGIME_DIAGNOSTIC_LATE_NEUTRAL_MODEL_VERSION,
    displayName: "Random Continuous Late-Age Neutral v1",
    family: "late-age-regime",
    variant: "late-neutral",
    revision: "v1",
    kind: "diagnostic",
    publicStatus: "never",
    status: "active",
    roles: ["diagnostic", "experimental-log"],
    parentModelVersion: RANDOM_LATE_AGE_REGIME_DIAGNOSTIC_CONTROL_MODEL_VERSION,
    comparisonBaselineModelVersion: RANDOM_LATE_AGE_REGIME_DIAGNOSTIC_CONTROL_MODEL_VERSION,
    freezeAt: RANDOM_LATE_AGE_REGIME_DIAGNOSTIC_FREEZE_AT,
    eligibilityPolicyVersion: LEGACY_RANDOM_RESET_ELIGIBILITY_POLICY,
    bandwidthHours: 18,
    truncationHours: 54,
    calibration: "none",
    differenceFromParent: "At random age >=144h, the regime multiplier is neutralized.",
  }),
  model({
    key: "late-age/no-downward/v1",
    modelVersion: RANDOM_LATE_AGE_REGIME_DIAGNOSTIC_LATE_NO_DOWNWARD_MODEL_VERSION,
    displayName: "Random Continuous Late-Age No-Downward v1",
    family: "late-age-regime",
    variant: "late-no-downward",
    revision: "v1",
    kind: "diagnostic",
    publicStatus: "never",
    status: "active",
    roles: ["diagnostic", "experimental-log"],
    parentModelVersion: RANDOM_LATE_AGE_REGIME_DIAGNOSTIC_CONTROL_MODEL_VERSION,
    comparisonBaselineModelVersion: RANDOM_LATE_AGE_REGIME_DIAGNOSTIC_CONTROL_MODEL_VERSION,
    freezeAt: RANDOM_LATE_AGE_REGIME_DIAGNOSTIC_FREEZE_AT,
    eligibilityPolicyVersion: LEGACY_RANDOM_RESET_ELIGIBILITY_POLICY,
    bandwidthHours: 18,
    truncationHours: 54,
    calibration: "none",
    differenceFromParent: "At random age >=144h, the regime multiplier is prevented from reducing hazard below neutral.",
  }),
  model({
    key: "late-age/pre-reset-frozen/v1",
    modelVersion: RANDOM_LATE_AGE_REGIME_DIAGNOSTIC_PRE_RESET_FROZEN_MODEL_VERSION,
    displayName: "Random Continuous Pre-Reset Frozen Regime v1",
    family: "late-age-regime",
    variant: "pre-reset-frozen",
    revision: "v1",
    kind: "diagnostic",
    publicStatus: "never",
    status: "active",
    roles: ["diagnostic", "experimental-log"],
    parentModelVersion: RANDOM_LATE_AGE_REGIME_DIAGNOSTIC_CONTROL_MODEL_VERSION,
    comparisonBaselineModelVersion: RANDOM_LATE_AGE_REGIME_DIAGNOSTIC_CONTROL_MODEL_VERSION,
    freezeAt: RANDOM_LATE_AGE_REGIME_DIAGNOSTIC_FREEZE_AT,
    eligibilityPolicyVersion: LEGACY_RANDOM_RESET_ELIGIBILITY_POLICY,
    bandwidthHours: 18,
    truncationHours: 54,
    calibration: "none",
    differenceFromParent: "Freezes the pre-reset regime multiplier for the late-age diagnostic arm.",
  }),
];

const broadBankedLateAgeEntries: readonly ProbabilityModelRegistryEntry[] = [
  model({
    key: "broad-banked/late-age/control/v2",
    modelVersion: BROAD_BANKED_LATE_AGE_REGIME_DIAGNOSTIC_CONTROL_MODEL_VERSION,
    displayName: "Broad-Banked Late-Age Regime Control v2",
    family: "broad-banked-late-age-regime",
    variant: "control",
    revision: "v2",
    kind: "diagnostic",
    publicStatus: "never",
    status: "active",
    roles: ["diagnostic", "experimental-log"],
    parentModelVersion: BROAD_BANKED_RANDOM_CLOCK_V2_MODEL_VERSION,
    comparisonBaselineModelVersion: BROAD_BANKED_RANDOM_CLOCK_V2_MODEL_VERSION,
    freezeAt: BROAD_BANKED_RANDOM_CLOCK_V2_FREEZE_AT,
    eligibilityPolicyVersion: BROAD_BANKED_RANDOM_CLOCK_V2_POLICY_VERSION,
    regimePolicyVersion: NEXT_GENERATION_B_POST_RESET_AGE_POLICY_VERSION,
    bandwidthHours: 18,
    truncationHours: 54,
    calibration: "none",
    notes: "Diagnostic-only control; never selected by the public selector.",
  }),
  model({
    key: "broad-banked/late-age/neutral/v2",
    modelVersion: BROAD_BANKED_LATE_AGE_REGIME_DIAGNOSTIC_LATE_NEUTRAL_MODEL_VERSION,
    displayName: "Broad-Banked Late-Age Neutral v2",
    family: "broad-banked-late-age-regime",
    variant: "late-neutral",
    revision: "v2",
    kind: "diagnostic",
    publicStatus: "never",
    status: "active",
    roles: ["diagnostic", "experimental-log"],
    parentModelVersion: BROAD_BANKED_RANDOM_CLOCK_V2_MODEL_VERSION,
    comparisonBaselineModelVersion: BROAD_BANKED_LATE_AGE_REGIME_DIAGNOSTIC_CONTROL_MODEL_VERSION,
    freezeAt: BROAD_BANKED_RANDOM_CLOCK_V2_FREEZE_AT,
    eligibilityPolicyVersion: BROAD_BANKED_RANDOM_CLOCK_V2_POLICY_VERSION,
    regimePolicyVersion: NEXT_GENERATION_B_POST_RESET_AGE_POLICY_VERSION,
    bandwidthHours: 18,
    truncationHours: 54,
    calibration: "none",
    differenceFromParent: "At random age >=144h, the regime multiplier is neutralized.",
    notes: "Diagnostic-only arm; never selected by the public selector.",
  }),
  model({
    key: "broad-banked/late-age/no-downward/v2",
    modelVersion: BROAD_BANKED_LATE_AGE_REGIME_DIAGNOSTIC_LATE_NO_DOWNWARD_MODEL_VERSION,
    displayName: "Broad-Banked Late-Age No-Downward v2",
    family: "broad-banked-late-age-regime",
    variant: "late-no-downward",
    revision: "v2",
    kind: "diagnostic",
    publicStatus: "never",
    status: "active",
    roles: ["diagnostic", "experimental-log"],
    parentModelVersion: BROAD_BANKED_RANDOM_CLOCK_V2_MODEL_VERSION,
    comparisonBaselineModelVersion: BROAD_BANKED_LATE_AGE_REGIME_DIAGNOSTIC_CONTROL_MODEL_VERSION,
    freezeAt: BROAD_BANKED_RANDOM_CLOCK_V2_FREEZE_AT,
    eligibilityPolicyVersion: BROAD_BANKED_RANDOM_CLOCK_V2_POLICY_VERSION,
    regimePolicyVersion: NEXT_GENERATION_B_POST_RESET_AGE_POLICY_VERSION,
    bandwidthHours: 18,
    truncationHours: 54,
    calibration: "none",
    differenceFromParent: "At random age >=144h, the regime multiplier is prevented from reducing hazard below neutral.",
    notes: "Diagnostic-only arm; never selected by the public selector.",
  }),
  model({
    key: "broad-banked/late-age/pre-reset-frozen/v2",
    modelVersion: BROAD_BANKED_LATE_AGE_REGIME_DIAGNOSTIC_PRE_RESET_FROZEN_MODEL_VERSION,
    displayName: "Broad-Banked Pre-Reset Frozen Regime v2",
    family: "broad-banked-late-age-regime",
    variant: "pre-reset-frozen",
    revision: "v2",
    kind: "diagnostic",
    publicStatus: "never",
    status: "active",
    roles: ["diagnostic", "experimental-log"],
    parentModelVersion: BROAD_BANKED_RANDOM_CLOCK_V2_MODEL_VERSION,
    comparisonBaselineModelVersion: BROAD_BANKED_LATE_AGE_REGIME_DIAGNOSTIC_CONTROL_MODEL_VERSION,
    freezeAt: BROAD_BANKED_RANDOM_CLOCK_V2_FREEZE_AT,
    eligibilityPolicyVersion: BROAD_BANKED_RANDOM_CLOCK_V2_POLICY_VERSION,
    regimePolicyVersion: NEXT_GENERATION_B_POST_RESET_AGE_POLICY_VERSION,
    bandwidthHours: 18,
    truncationHours: 54,
    calibration: "none",
    differenceFromParent: "Freezes the pre-reset regime multiplier for the broad-banked late-age diagnostic arm.",
    notes: "Diagnostic-only arm; never selected by the public selector.",
  }),
];

function ageDiagnosticEntries() {
  return RANDOM_BANDWIDTH_AGE_DIAGNOSTIC_MODEL_VERSIONS.map((modelVersion, index) => model({
    key: "raw-continuous/bw" + RANDOM_BANDWIDTH_AGE_DIAGNOSTIC_BANDWIDTH_HOURS[index] + "-tr54/age-diagnostic-v1",
    modelVersion,
    displayName: "Raw Continuous Bandwidth Age Diagnostic " + RANDOM_BANDWIDTH_AGE_DIAGNOSTIC_BANDWIDTH_HOURS[index] + "h v1",
    family: "raw-continuous-age-diagnostic",
    variant: "bandwidth-" + RANDOM_BANDWIDTH_AGE_DIAGNOSTIC_BANDWIDTH_HOURS[index] + "-tr54",
    revision: "v1",
    kind: "diagnostic",
    publicStatus: "never",
    status: "active",
    roles: ["diagnostic", "experimental-log"],
    comparisonBaselineModelVersion: RANDOM_BANDWIDTH_TRUNCATION_SHADOW_CHALLENGER_MODEL_VERSION,
    freezeAt: RANDOM_BANDWIDTH_AGE_DIAGNOSTIC_FREEZE_AT,
    eligibilityPolicyVersion: LEGACY_RANDOM_RESET_ELIGIBILITY_POLICY,
    regimePolicyVersion: NEXT_GENERATION_B_POST_RESET_AGE_POLICY_VERSION,
    bandwidthHours: RANDOM_BANDWIDTH_AGE_DIAGNOSTIC_BANDWIDTH_HOURS[index],
    truncationHours: RANDOM_BANDWIDTH_AGE_DIAGNOSTIC_TRUNCATION_HOURS,
    calibration: "none",
  }));
}

export const PROBABILITY_MODEL_REGISTRY: readonly ProbabilityModelRegistryEntry[] = [
  model({
    key: "odds/random-only/v2",
    modelVersion: LEGACY_SHADOW_PROBABILITY_MODEL_VERSION,
    displayName: "Legacy Random-Only Odds v2",
    family: "odds",
    variant: "random-only",
    revision: "v2",
    kind: "forecast",
    publicStatus: "never",
    status: "retired",
    roles: ["shadow", "evaluation-only"],
    eligibilityPolicyVersion: LEGACY_RANDOM_RESET_ELIGIBILITY_POLICY,
    calibration: "none",
    notes: "Retained for historical comparison only.",
  }),
  model({
    key: "odds/random-inclusive/v3",
    modelVersion: SHADOW_PROBABILITY_MODEL_VERSION,
    displayName: "Random-Inclusive Odds v3",
    family: "odds",
    variant: "random-inclusive",
    revision: "v3",
    kind: "forecast",
    publicStatus: "never",
    status: "active",
    roles: ["shadow"],
    eligibilityPolicyVersion: LEGACY_RANDOM_RESET_ELIGIBILITY_POLICY,
    calibration: "none",
  }),
  model({
    key: "recency/bayes/h14-r2",
    modelVersion: RECENCY_SHADOW_MODEL_CONFIG[0].modelVersion,
    displayName: "Recency Bayesian H14 r2",
    family: "recency",
    variant: "bayes-h14",
    revision: "r2",
    kind: "forecast",
    publicStatus: "never",
    status: "active",
    roles: ["shadow"],
    eligibilityPolicyVersion: LEGACY_RANDOM_RESET_ELIGIBILITY_POLICY,
    calibration: "none",
  }),
  model({
    key: "recency/bayes/h30-r3",
    modelVersion: RECENCY_H30_PROBABILITY_MODEL_VERSION,
    displayName: "Recency Bayesian H30 r3",
    family: "recency",
    variant: "bayes-h30",
    revision: "r3",
    kind: "forecast",
    publicStatus: "never",
    status: "active",
    roles: ["shadow", "ensemble-component"],
    eligibilityPolicyVersion: LEGACY_RANDOM_RESET_ELIGIBILITY_POLICY,
    calibration: "none",
  }),
  model({
    key: "recency/bayes/h60-r2",
    modelVersion: RECENCY_SHADOW_MODEL_CONFIG[2].modelVersion,
    displayName: "Recency Bayesian H60 r2",
    family: "recency",
    variant: "bayes-h60",
    revision: "r2",
    kind: "forecast",
    publicStatus: "never",
    status: "active",
    roles: ["shadow"],
    eligibilityPolicyVersion: LEGACY_RANDOM_RESET_ELIGIBILITY_POLICY,
    calibration: "none",
  }),
  model({
    key: "v4/logit-calibrated/v1",
    modelVersion: CALIBRATED_SHADOW_MODEL_VERSION_V1,
    displayName: "Prequential Logit Calibrated v1",
    family: "prequential-calibration",
    variant: "logit-calibrated",
    revision: "v1",
    kind: "forecast",
    publicStatus: "never",
    status: "archived",
    roles: ["shadow", "evaluation-only"],
    calibration: "prequential-logit",
  }),
  model({
    key: "v4/logit-calibrated/v2",
    modelVersion: CALIBRATED_SHADOW_MODEL_VERSION_V2,
    displayName: "Prequential Logit Calibrated v2",
    family: "prequential-calibration",
    variant: "logit-calibrated",
    revision: "v2",
    kind: "forecast",
    publicStatus: "never",
    status: "archived",
    roles: ["shadow", "evaluation-only"],
    calibration: "prequential-logit",
  }),
  model({
    key: "v4/logit-calibrated/v3",
    modelVersion: CALIBRATED_SHADOW_MODEL_VERSION,
    displayName: "Prequential Logit Calibrated v3",
    family: "prequential-calibration",
    variant: "logit-calibrated",
    revision: "v3",
    kind: "forecast",
    publicStatus: "historical",
    status: "active",
    roles: ["public-runtime", "fallback", "shadow"],
    calibration: "prequential-logit",
  }),
  model({
    key: "regime-elapsed/full/v1",
    modelVersion: REGIME_ELAPSED_FULL_MODEL_VERSION,
    displayName: "Regime Elapsed Full v1",
    family: "regime-elapsed",
    variant: "full",
    revision: "v1",
    kind: "forecast",
    publicStatus: "never",
    status: "active",
    roles: ["shadow", "ensemble-component"],
    eligibilityPolicyVersion: LEGACY_RANDOM_RESET_ELIGIBILITY_POLICY,
    calibration: "none",
  }),
  model({
    key: "elapsed/base/v1",
    modelVersion: ELAPSED_ONLY_MODEL_VERSION,
    displayName: "Elapsed-Only v1",
    family: "elapsed",
    variant: "base",
    revision: "v1",
    kind: "forecast",
    publicStatus: "historical",
    status: "active",
    roles: ["public-runtime", "fallback"],
    eligibilityPolicyVersion: LEGACY_RANDOM_RESET_ELIGIBILITY_POLICY,
    calibration: "none",
  }),
  model({
    key: "b-family/base/v1",
    modelVersion: NEXT_GENERATION_B_MODEL_VERSION,
    displayName: "Next Generation B v1",
    family: "b-family",
    variant: "base",
    revision: "v1",
    kind: "forecast",
    publicStatus: "historical",
    status: "active",
    roles: ["public-runtime", "shadow", "ensemble-component", "experimental-log"],
    parentModelVersion: RANDOM_CONTINUOUS_SHADOW_MODEL_VERSION,
    freezeAt: NEXT_GENERATION_FREEZE_AT,
    eligibilityPolicyVersion: LEGACY_RANDOM_RESET_ELIGIBILITY_POLICY,
    regimePolicyVersion: NEXT_GENERATION_B_POST_RESET_AGE_POLICY_VERSION,
    bandwidthHours: RANDOM_CONTINUOUS_SHADOW_BANDWIDTH_HOURS,
    truncationHours: RANDOM_CONTINUOUS_SHADOW_TRUNCATION_HOURS,
    calibration: "prequential-logit",
    differenceFromParent: "Adds the frozen B-family prequential calibration and signal policy to the random-continuous base.",
  }),
  model({
    key: "b-family/post-reset-age/v2",
    modelVersion: NEXT_GENERATION_B_POST_RESET_AGE_MODEL_VERSION,
    displayName: "Next Generation B Post-Reset Age v2",
    family: "b-family",
    variant: "post-reset-age",
    revision: "v2",
    kind: "forecast",
    publicStatus: "historical",
    status: "active",
    roles: ["public-runtime", "shadow", "ensemble-component", "experimental-log"],
    parentModelVersion: NEXT_GENERATION_B_MODEL_VERSION,
    freezeAt: NEXT_GENERATION_FREEZE_AT,
    eligibilityPolicyVersion: LEGACY_RANDOM_RESET_ELIGIBILITY_POLICY,
    regimePolicyVersion: NEXT_GENERATION_B_POST_RESET_AGE_POLICY_VERSION,
    bandwidthHours: RANDOM_CONTINUOUS_SHADOW_BANDWIDTH_HOURS,
    truncationHours: RANDOM_CONTINUOUS_SHADOW_TRUNCATION_HOURS,
    calibration: "prequential-logit",
    differenceFromParent: "Adds the frozen post-reset-age regime attenuation policy to B v1.",
  }),
  model({
    key: "b-family/post-reset-age/v3",
    modelVersion: NEXT_GENERATION_V3_MODEL_VERSION,
    displayName: "Next Generation Uncalibrated Post-Reset Age v3",
    family: "b-family",
    variant: "post-reset-age-uncalibrated",
    revision: "v3",
    kind: "forecast",
    publicStatus: "never",
    status: "active",
    roles: ["shadow", "experimental-log"],
    freezeAt: NEXT_GENERATION_FREEZE_AT,
    eligibilityPolicyVersion: LEGACY_RANDOM_RESET_ELIGIBILITY_POLICY,
    regimePolicyVersion: NEXT_GENERATION_B_POST_RESET_AGE_POLICY_VERSION,
    bandwidthHours: RANDOM_CONTINUOUS_SHADOW_BANDWIDTH_HOURS,
    truncationHours: RANDOM_CONTINUOUS_SHADOW_TRUNCATION_HOURS,
    calibration: "none",
  }),
  model({
    key: "b-family/selective-calibration/v3",
    modelVersion: NEXT_GENERATION_SELECTIVE_CALIBRATION_MODEL_VERSION,
    displayName: "Next Generation Selective Calibration v3",
    family: "b-family",
    variant: "selective-calibration",
    revision: "v3",
    kind: "forecast",
    publicStatus: "historical",
    status: "active",
    roles: ["public-runtime", "shadow", "experimental-log"],
    parentModelVersion: NEXT_GENERATION_B_POST_RESET_AGE_MODEL_VERSION,
    freezeAt: NEXT_GENERATION_FREEZE_AT,
    eligibilityPolicyVersion: LEGACY_RANDOM_RESET_ELIGIBILITY_POLICY,
    regimePolicyVersion: NEXT_GENERATION_B_POST_RESET_AGE_POLICY_VERSION,
    bandwidthHours: RANDOM_CONTINUOUS_SHADOW_BANDWIDTH_HOURS,
    truncationHours: RANDOM_CONTINUOUS_SHADOW_TRUNCATION_HOURS,
    calibration: "selective",
    differenceFromParent: "Applies the selective calibration policy to the frozen B post-reset-age forecast.",
  }),
  model({
    key: "random-clock/elapsed/v1",
    modelVersion: RANDOM_ELAPSED_SHADOW_MODEL_VERSION,
    displayName: "Random Elapsed Shadow v1",
    family: "random-clock",
    variant: "elapsed",
    revision: "v1",
    kind: "forecast",
    publicStatus: "never",
    status: "active",
    roles: ["shadow"],
    freezeAt: RANDOM_ELAPSED_SHADOW_FREEZE_AT,
    eligibilityPolicyVersion: LEGACY_RANDOM_RESET_ELIGIBILITY_POLICY,
    calibration: "none",
  }),
  model({
    key: "random-clock/continuous/v1",
    modelVersion: RANDOM_CONTINUOUS_SHADOW_MODEL_VERSION,
    displayName: "Random Continuous Shadow v1",
    family: "random-clock",
    variant: "continuous",
    revision: "v1",
    kind: "forecast",
    publicStatus: "never",
    status: "active",
    roles: ["shadow"],
    freezeAt: RANDOM_CONTINUOUS_SHADOW_FREEZE_AT,
    eligibilityPolicyVersion: LEGACY_RANDOM_RESET_ELIGIBILITY_POLICY,
    bandwidthHours: RANDOM_CONTINUOUS_SHADOW_BANDWIDTH_HOURS,
    truncationHours: RANDOM_CONTINUOUS_SHADOW_TRUNCATION_HOURS,
    calibration: "none",
  }),
  model({
    key: "ensemble/logit-stack/v1",
    modelVersion: NEXT_GENERATION_A_MODEL_VERSION,
    displayName: "Next Generation Ensemble A v1",
    family: "next-generation-ensemble",
    variant: "logit-stack",
    revision: "v1",
    kind: "ensemble",
    publicStatus: "never",
    status: "active",
    roles: ["shadow", "evaluation-only"],
    freezeAt: NEXT_GENERATION_FREEZE_AT,
    calibration: "none",
    notes: "Ensemble identity over the frozen A component inventory.",
  }),
  model({
    key: "raw-continuous/bw24-tr72/v1",
    modelVersion: RANDOM_BANDWIDTH_TRUNCATION_SHADOW_CONTROL_MODEL_VERSION,
    displayName: "Raw Continuous Bandwidth 24/72 Control v1",
    family: "raw-continuous-bandwidth",
    variant: "bw24-tr72",
    revision: "v1",
    kind: "forecast",
    publicStatus: "never",
    status: "active",
    roles: ["shadow", "experimental-log"],
    freezeAt: RANDOM_BANDWIDTH_TRUNCATION_SHADOW_FREEZE_AT,
    eligibilityPolicyVersion: LEGACY_RANDOM_RESET_ELIGIBILITY_POLICY,
    regimePolicyVersion: NEXT_GENERATION_B_POST_RESET_AGE_POLICY_VERSION,
    bandwidthHours: 24,
    truncationHours: 72,
    calibration: "none",
  }),
  model({
    key: "raw-continuous/bw18-tr54/v1",
    modelVersion: RANDOM_BANDWIDTH_TRUNCATION_SHADOW_CHALLENGER_MODEL_VERSION,
    displayName: "Raw Continuous Bandwidth 18/54 v1",
    family: "raw-continuous-bandwidth",
    variant: "bw18-tr54",
    revision: "v1",
    kind: "forecast",
    publicStatus: "historical",
    status: "active",
    roles: ["fallback", "experimental-log"],
    parentModelVersion: RANDOM_BANDWIDTH_TRUNCATION_SHADOW_CONTROL_MODEL_VERSION,
    freezeAt: RANDOM_BANDWIDTH_TRUNCATION_SHADOW_FREEZE_AT,
    eligibilityPolicyVersion: LEGACY_RANDOM_RESET_ELIGIBILITY_POLICY,
    regimePolicyVersion: NEXT_GENERATION_B_POST_RESET_AGE_POLICY_VERSION,
    bandwidthHours: 18,
    truncationHours: 54,
    calibration: "none",
    differenceFromParent: "Uses the preregistered 18h bandwidth and 54h truncation instead of the 24/72 control.",
  }),
  ...ageDiagnosticEntries(),
  ...lateAgeV1Entries,
  model({
    key: "broad-banked/base/v2",
    modelVersion: BROAD_BANKED_RANDOM_CLOCK_V2_MODEL_VERSION,
    displayName: "Broad-Banked Random Continuous 18/54 v2",
    family: "broad-banked",
    variant: "base",
    revision: "v2",
    kind: "forecast",
    publicStatus: "current",
    status: "active",
    roles: ["public-runtime", "experimental-log"],
    parentModelVersion: RANDOM_BANDWIDTH_TRUNCATION_SHADOW_CHALLENGER_MODEL_VERSION,
    freezeAt: BROAD_BANKED_RANDOM_CLOCK_V2_FREEZE_AT,
    eligibilityPolicyVersion: BROAD_BANKED_RANDOM_CLOCK_V2_POLICY_VERSION,
    regimePolicyVersion: NEXT_GENERATION_B_POST_RESET_AGE_POLICY_VERSION,
    bandwidthHours: 18,
    truncationHours: 54,
    calibration: "none",
    differenceFromParent: "Broad completed banked distributions become eligible random-clock boundaries; estimator and frozen 18/54 parameters remain unchanged.",
  }),
  model({
    key: "survival-conditioned/base/v1",
    modelVersion: SURVIVAL_CONDITIONED_MODEL_VERSION,
    displayName: "Survival-Conditioned Adaptive H45 Tail H24 v1",
    family: "survival-conditioned",
    variant: "adaptive-h45-tail-h24",
    revision: "v1",
    kind: "forecast",
    publicStatus: "scheduled",
    status: "active",
    roles: ["public-runtime", "fallback", "experimental-log"],
    parentModelVersion: BROAD_BANKED_RANDOM_CLOCK_V2_MODEL_VERSION,
    comparisonBaselineModelVersion: BROAD_BANKED_RANDOM_CLOCK_V2_MODEL_VERSION,
    freezeAt: SURVIVAL_CONDITIONED_FREEZE_AT,
    eligibilityPolicyVersion: BROAD_BANKED_RANDOM_CLOCK_V2_POLICY_VERSION,
    bandwidthHours: SURVIVAL_CONDITIONED_BIN_HOURS,
    truncationHours: null,
    calibration: "none",
    differenceFromParent: "Conditions the random-reset hazard on survival age using completed broad-banked intervals, H45 recency weighting, adaptive 6-24h smoothing, and an H24 tail return toward the weighted long-run rate.",
    notes: "Scheduled future public candidate; broad-banked v2 remains current until a separate promotion commit explicitly sets the adoption boundary.",
  }),
  ...[
    ["previous-interval", SURVIVAL_CONTEXT_PREVIOUS_INTERVAL_MODEL_VERSION],
    ["circadian", SURVIVAL_CONTEXT_CIRCADIAN_MODEL_VERSION],
    ["previous-interval-circadian", SURVIVAL_CONTEXT_PREVIOUS_INTERVAL_CIRCADIAN_MODEL_VERSION],
    ["burst", SURVIVAL_CONTEXT_BURST_MODEL_VERSION],
    ["old-regime", SURVIVAL_CONTEXT_OLD_REGIME_MODEL_VERSION],
  ].map(([variant, modelVersion]) => model({
    key: `survival-conditioned-context/${variant}/v1`,
    modelVersion,
    displayName: `Survival-Conditioned ${variant} Context v1`,
    family: "survival-conditioned-context",
    variant,
    revision: "v1",
    kind: "forecast",
    publicStatus: "never",
    status: "active",
    roles: ["shadow", "experimental-log"],
    parentModelVersion: SURVIVAL_CONDITIONED_MODEL_VERSION,
    comparisonBaselineModelVersion: SURVIVAL_CONDITIONED_MODEL_VERSION,
    freezeAt: SURVIVAL_CONDITIONED_FREEZE_AT,
    eligibilityPolicyVersion: BROAD_BANKED_RANDOM_CLOCK_V2_POLICY_VERSION,
    regimePolicyVersion: variant === "old-regime" ? NEXT_GENERATION_B_POST_RESET_AGE_POLICY_VERSION : null,
    bandwidthHours: SURVIVAL_CONDITIONED_BIN_HOURS,
    truncationHours: null,
    calibration: "contextual",
    differenceFromParent: `Shadow context arm: ${variant}; it cannot change public selection or fallback behavior.`,
  })),
  ...broadBankedLateAgeEntries,
  model({
    key: "context-aware/continuous/bw18-tr54/v1",
    modelVersion: CONTEXT_AWARE_CONTINUOUS_PROBABILITY_MODEL_VERSION,
    displayName: "Context-Aware Continuous 18/54 v1",
    family: "context-aware",
    variant: "continuous-bw18-tr54",
    revision: "v1",
    kind: "forecast",
    publicStatus: "never",
    status: "active",
    roles: ["shadow", "experimental-log"],
    freezeAt: CONTEXT_AWARE_CONTINUOUS_PROBABILITY_FREEZE_AT,
    eligibilityPolicyVersion: LEGACY_RANDOM_RESET_ELIGIBILITY_POLICY,
    regimePolicyVersion: NEXT_GENERATION_B_POST_RESET_AGE_POLICY_VERSION,
    bandwidthHours: 18,
    truncationHours: 54,
    calibration: "contextual",
  }),
  model({
    key: "contextual-burst/circadian/v1",
    modelVersion: NEXT_GENERATION_C_MODEL_VERSION,
    displayName: "Contextual Burst C v1",
    family: "contextual-burst",
    variant: "circadian",
    revision: "v1",
    kind: "forecast",
    publicStatus: "never",
    status: "active",
    roles: ["shadow", "experimental-log"],
    freezeAt: NEXT_GENERATION_C_FREEZE_AT,
    bandwidthHours: RANDOM_CONTINUOUS_SHADOW_BANDWIDTH_HOURS,
    truncationHours: RANDOM_CONTINUOUS_SHADOW_TRUNCATION_HOURS,
    calibration: "contextual",
  }),
  model({
    key: "contextual-burst/circadian-normalized/v2",
    modelVersion: NEXT_GENERATION_C_V2_MODEL_VERSION,
    displayName: "Contextual Burst C Normalized v2",
    family: "contextual-burst",
    variant: "circadian-normalized",
    revision: "v2",
    kind: "forecast",
    publicStatus: "never",
    status: "active",
    roles: ["shadow", "experimental-log"],
    parentModelVersion: NEXT_GENERATION_C_MODEL_VERSION,
    freezeAt: NEXT_GENERATION_C_V2_FREEZE_AT,
    bandwidthHours: RANDOM_CONTINUOUS_SHADOW_BANDWIDTH_HOURS,
    truncationHours: RANDOM_CONTINUOUS_SHADOW_TRUNCATION_HOURS,
    calibration: "contextual",
    differenceFromParent: "Adds the preregistered circadian normalization solver to Contextual Burst C.",
  }),
  model({
    key: "boundary-censored/random/v3",
    modelVersion: BOUNDARY_CENSORED_MODEL_VERSION,
    displayName: "Boundary-Censored Random Odds v3",
    family: "boundary-censored",
    variant: "random",
    revision: "v3",
    kind: "diagnostic",
    publicStatus: "never",
    status: "active",
    roles: ["diagnostic", "evaluation-only"],
    calibration: "none",
    notes: "Evaluation-only boundary-censored estimator; not a public selector arm.",
  }),
  model({
    key: "evaluation/constant-hazard/v1",
    modelVersion: CONSTANT_HAZARD_MODEL_VERSION,
    displayName: "Constant Hazard Benchmark v1",
    family: "evaluation-benchmark",
    variant: "constant-hazard",
    revision: "v1",
    kind: "forecast",
    publicStatus: "never",
    status: "active",
    roles: ["evaluation-only"],
    calibration: "none",
  }),
  model({
    key: "evaluation/logit-calibrated/v1",
    modelVersion: CALIBRATED_V2_MODEL_VERSION,
    displayName: "Benchmark Logit-Calibrated Prequential v1",
    family: "evaluation-benchmark",
    variant: "logit-calibrated-prequential",
    revision: "v1",
    kind: "forecast",
    publicStatus: "never",
    status: "active",
    roles: ["evaluation-only"],
    calibration: "prequential-logit",
  }),
  model({
    key: "heuristic/time-consistent/v2",
    modelVersion: PROBABILITY_MODEL_VERSION,
    displayName: "Heuristic Time-Consistent v2",
    family: "heuristic",
    variant: "time-consistent",
    revision: "v2",
    kind: "forecast",
    publicStatus: "never",
    status: "active",
    roles: ["fallback"],
    calibration: "none",
    notes: "Final heuristic runtime fallback used by the local probability calculation path.",
  }),
];

export const PROBABILITY_MODEL_POINTERS = {
  currentPublic: PUBLISHED_PROBABILITY_MODEL_VERSION,
  previousPublic: PUBLISHED_PROBABILITY_PREVIOUS_MODEL_VERSION,
  stableFallback: ELAPSED_ONLY_MODEL_VERSION,
} as const;

export const CURRENT_PUBLIC_PROBABILITY_MODEL = PROBABILITY_MODEL_REGISTRY.find(
  (entry) => entry.modelVersion === PROBABILITY_MODEL_POINTERS.currentPublic,
)!;

export const PUBLIC_PROBABILITY_PERIOD_REGISTRY: readonly PublicProbabilityPeriodEntry[] = [
  {
    id: "historical-elapsed-v1",
    modelVersion: ELAPSED_ONLY_MODEL_VERSION,
    startAt: null,
    endAt: PUBLISHED_PROBABILITY_HISTORICAL_V4_ADOPTION_AT,
    adoptionMode: "manual",
    note: "Earliest retained public period; its precise start is not defined in the current configuration.",
  },
  {
    id: "historical-v4",
    modelVersion: CALIBRATED_SHADOW_MODEL_VERSION,
    startAt: PUBLISHED_PROBABILITY_HISTORICAL_V4_ADOPTION_AT,
    endAt: PUBLISHED_PROBABILITY_B_MODEL_ADOPTION_AT,
    adoptionMode: "manual",
    note: "Historical pre-B calibrated V4 period.",
  },
  {
    id: "b-v1",
    modelVersion: NEXT_GENERATION_B_MODEL_VERSION,
    startAt: PUBLISHED_PROBABILITY_B_MODEL_ADOPTION_AT,
    endAt: PUBLISHED_PROBABILITY_PREVIOUS_ADOPTION_AT,
    adoptionMode: "manual",
    note: "Historical Next Generation B v1 period.",
  },
  {
    id: "b-v2",
    modelVersion: NEXT_GENERATION_B_POST_RESET_AGE_MODEL_VERSION,
    startAt: PUBLISHED_PROBABILITY_PREVIOUS_ADOPTION_AT,
    endAt: PUBLISHED_PROBABILITY_ADOPTION_AT,
    adoptionMode: "manual",
    note: "Historical B post-reset-age v2 period.",
  },
  {
    id: "selective-v3",
    modelVersion: NEXT_GENERATION_SELECTIVE_CALIBRATION_MODEL_VERSION,
    startAt: PUBLISHED_PROBABILITY_ADOPTION_AT,
    endAt: PUBLISHED_PROBABILITY_V4_ROLLBACK_AT,
    adoptionMode: "manual",
    note: "Historical selective calibration v3 period.",
  },
  {
    id: "corrective-rollback-v4",
    modelVersion: CALIBRATED_SHADOW_MODEL_VERSION,
    startAt: PUBLISHED_PROBABILITY_V4_ROLLBACK_AT,
    endAt: PUBLISHED_RAW_CONTINUOUS_18_54_ADOPTION_AT,
    adoptionMode: "manual",
    note: "Corrective rollback to the calibrated V4 identity.",
  },
  {
    id: "raw-continuous-18-54",
    modelVersion: RANDOM_BANDWIDTH_TRUNCATION_SHADOW_CHALLENGER_MODEL_VERSION,
    startAt: PUBLISHED_RAW_CONTINUOUS_18_54_ADOPTION_AT,
    endAt: PUBLISHED_BROAD_BANKED_V2_ADOPTION_AT,
    adoptionMode: "manual",
    note: "Historical raw continuous 18/54 period.",
  },
  {
    id: "broad-banked-v2",
    modelVersion: BROAD_BANKED_RANDOM_CLOCK_V2_MODEL_VERSION,
    startAt: PUBLISHED_BROAD_BANKED_V2_ADOPTION_AT,
    endAt: PUBLISHED_SURVIVAL_CONDITIONED_ADOPTION_AT,
    adoptionMode: "manual",
    note: "Current public broad-banked random continuous 18/54 period; it remains open until a separate survival promotion commit.",
  },
  ...(PUBLISHED_SURVIVAL_CONDITIONED_ADOPTION_AT === null
    ? []
    : [{
        id: "survival-conditioned-v1" as const,
        modelVersion: SURVIVAL_CONDITIONED_MODEL_VERSION,
        startAt: PUBLISHED_SURVIVAL_CONDITIONED_ADOPTION_AT,
        endAt: null,
        adoptionMode: "manual" as const,
        note: "Promoted survival-conditioned public period; adoption is boundary-defined and does not rewrite earlier rows.",
      }]),
];

export function getProbabilityModelByVersion(modelVersion: string) {
  return PROBABILITY_MODEL_REGISTRY.find((entry) => entry.modelVersion === modelVersion);
}

export function getProbabilityModelByKey(key: string) {
  return PROBABILITY_MODEL_REGISTRY.find((entry) => entry.key === key);
}

export function getCurrentPublicProbabilityModel() {
  return CURRENT_PUBLIC_PROBABILITY_MODEL;
}

export function getProbabilityModelsByFamily(family: string) {
  return PROBABILITY_MODEL_REGISTRY.filter((entry) => entry.family === family);
}

export function getProbabilityModelsByRole(role: ProbabilityModelRole) {
  return PROBABILITY_MODEL_REGISTRY.filter((entry) => entry.roles.includes(role));
}

export function getPublicProbabilityPeriods() {
  return PUBLIC_PROBABILITY_PERIOD_REGISTRY;
}

export function getCurrentPublicProbabilityPeriod() {
  return PUBLIC_PROBABILITY_PERIOD_REGISTRY.find(
    (period) => period.modelVersion === PROBABILITY_MODEL_POINTERS.currentPublic,
  )!;
}

export function getProbabilityPeriodAt(value: Date | string) {
  const time = typeof value === "string" ? Date.parse(value) : value.getTime();
  if (!Number.isFinite(time)) return null;

  return PUBLIC_PROBABILITY_PERIOD_REGISTRY.find((period) => {
    const start = period.startAt === null ? null : Date.parse(period.startAt);
    const end = period.endAt === null ? null : Date.parse(period.endAt);
    return (start === null || time >= start) && (end === null || time < end);
  }) ?? null;
}

function markdownValue(value: string | number | null) {
  return value === null ? "—" : String(value);
}

function markdownModelRow(entry: ProbabilityModelRegistryEntry) {
  return [
    "| " + entry.key,
    entry.modelVersion,
    entry.displayName,
    entry.family,
    entry.variant,
    entry.revision,
    entry.kind,
    entry.publicStatus,
    entry.status,
    entry.roles.join(", "),
    markdownValue(entry.parentModelVersion),
    markdownValue(entry.comparisonBaselineModelVersion),
    markdownValue(entry.freezeAt),
    markdownValue(entry.eligibilityPolicyVersion),
    markdownValue(entry.regimePolicyVersion),
    markdownValue(entry.bandwidthHours),
    markdownValue(entry.truncationHours),
    markdownValue(entry.calibration),
    entry.differenceFromParent || "—",
    markdownValue(entry.notes),
  ].join(" | ") + " |";
}

const MODEL_TABLE_HEADER = [
  "| key",
  "modelVersion",
  "displayName",
  "family",
  "variant",
  "revision",
  "kind",
  "publicStatus",
  "status",
  "roles",
  "parentModelVersion",
  "comparisonBaselineModelVersion",
  "freezeAt",
  "eligibilityPolicyVersion",
  "regimePolicyVersion",
  "bandwidthHours",
  "truncationHours",
  "calibration",
  "differenceFromParent",
  "notes",
].join(" | ") + " |";

const MODEL_TABLE_SEPARATOR = "| " + Array.from({ length: 20 }, () => "---").join(" | ") + " |";

function markdownModelTable(entries: readonly ProbabilityModelRegistryEntry[]) {
  return [
    MODEL_TABLE_HEADER,
    MODEL_TABLE_SEPARATOR,
    ...entries.map(markdownModelRow),
  ];
}

export function formatProbabilityModelRegistryMarkdown() {
  const current = getCurrentPublicProbabilityModel();
  const historical = PROBABILITY_MODEL_REGISTRY.filter((entry) => entry.publicStatus === "historical");
  const activeShadow = PROBABILITY_MODEL_REGISTRY.filter((entry) =>
    entry.publicStatus === "never"
    && entry.status === "active"
    && entry.kind !== "diagnostic"
    && !entry.roles.includes("evaluation-only"),
  );
  const diagnostics = PROBABILITY_MODEL_REGISTRY.filter((entry) =>
    entry.kind === "diagnostic" || entry.roles.includes("evaluation-only"),
  );
  const archived = PROBABILITY_MODEL_REGISTRY.filter((entry) =>
    entry.status === "archived" || entry.status === "retired",
  );

  const periodHeader = "| id | modelVersion | startAt | endAt | adoptionMode | note |";
  const periodSeparator = "| --- | --- | --- | --- | --- | --- |";
  const periodRows = PUBLIC_PROBABILITY_PERIOD_REGISTRY.map((period) => [
    "| " + period.id,
    period.modelVersion,
    markdownValue(period.startAt),
    markdownValue(period.endAt),
    period.adoptionMode,
    period.note,
  ].join(" | ") + " |");

  return [
    "# Probability model registry",
    "",
    "> Generated from data/probabilityModelRegistry.ts. This is governance metadata; runtime selectors and public DTOs do not import it.",
    "",
    "## Current public model",
    "",
    "- key: " + current.key,
    "- modelVersion: " + current.modelVersion,
    "- previous public modelVersion: " + PROBABILITY_MODEL_POINTERS.previousPublic,
    "- stable fallback modelVersion: " + PROBABILITY_MODEL_POINTERS.stableFallback,
    "",
    "## Public probability periods",
    "",
    periodHeader,
    periodSeparator,
    ...periodRows,
    "",
    "## Public history model entries",
    "",
    ...markdownModelTable(historical),
    "",
    "## Active and shadow model entries",
    "",
    ...markdownModelTable(activeShadow),
    "",
    "## Diagnostic and evaluation-only entries",
    "",
    ...markdownModelTable(diagnostics),
    "",
    "## Archived and legacy entries",
    "",
    ...markdownModelTable(archived),
    "",
  ].join("\n");
}

export const PROBABILITY_MODEL_REGISTRY_SOURCE_INVENTORY = {
  shadowConfigModelVersions: [
    LEGACY_SHADOW_PROBABILITY_MODEL_VERSION,
    SHADOW_PROBABILITY_MODEL_VERSION,
    RECENCY_H30_PROBABILITY_MODEL_VERSION,
    ...CALIBRATED_SHADOW_ARCHIVED_MODEL_VERSIONS,
    CALIBRATED_SHADOW_MODEL_VERSION,
    REGIME_ELAPSED_FULL_MODEL_VERSION,
    ELAPSED_ONLY_MODEL_VERSION,
    NEXT_GENERATION_B_MODEL_VERSION,
    NEXT_GENERATION_B_POST_RESET_AGE_MODEL_VERSION,
    NEXT_GENERATION_V3_MODEL_VERSION,
    NEXT_GENERATION_SELECTIVE_CALIBRATION_MODEL_VERSION,
    RANDOM_ELAPSED_SHADOW_MODEL_VERSION,
    RANDOM_CONTINUOUS_SHADOW_MODEL_VERSION,
    NEXT_GENERATION_A_MODEL_VERSION,
    RANDOM_BANDWIDTH_TRUNCATION_SHADOW_CONTROL_MODEL_VERSION,
    RANDOM_BANDWIDTH_TRUNCATION_SHADOW_CHALLENGER_MODEL_VERSION,
    ...RANDOM_BANDWIDTH_AGE_DIAGNOSTIC_MODEL_VERSIONS,
    ...RANDOM_LATE_AGE_REGIME_DIAGNOSTIC_MODEL_VERSIONS,
    BROAD_BANKED_RANDOM_CLOCK_V2_MODEL_VERSION,
    ...BROAD_BANKED_LATE_AGE_REGIME_DIAGNOSTIC_MODEL_VERSIONS,
    CONTEXT_AWARE_CONTINUOUS_PROBABILITY_MODEL_VERSION,
    NEXT_GENERATION_C_MODEL_VERSION,
    NEXT_GENERATION_C_V2_MODEL_VERSION,
    ...RECENCY_SHADOW_MODEL_CONFIG.map((entry) => entry.modelVersion),
    ...NEXT_GENERATION_A_COMPONENT_VERSIONS,
  ],
  runtimeFallbackModelVersions: [PROBABILITY_MODEL_VERSION],
  evaluationModelVersions: [
    BOUNDARY_CENSORED_MODEL_VERSION,
    CONSTANT_HAZARD_MODEL_VERSION,
    CALIBRATED_V2_MODEL_VERSION,
  ],
} as const;
