import type { Locale, RadarViewModel } from "@/lib/radar/types";
import { translateUI } from "@/lib/radar/i18n";

type ResetHistoryItem = RadarViewModel["recentHistory"][number];

type ResetHistoryDetailsProps = {
  item: ResetHistoryItem;
  locale: Locale;
  compact?: boolean;
  showScope?: boolean;
  hideScopeOnMobile?: boolean;
  hideReasonOnMobile?: boolean;
  hideNoticeType?: boolean;
  hideNoticeToExecutionOnMobile?: boolean;
  hideNoteOnMobile?: boolean;
};

function isMeaningfulValue(value: string | null | undefined) {
  return Boolean(value?.trim());
}

const GENERIC_SCOPE_VALUES = new Set([
  "全有料プラン",
  "all paid plans",
  "所有付费套餐",
]);

function shouldShowScope(value: string | null | undefined) {
  const normalizedValue = value?.trim().toLowerCase();
  if (!normalizedValue) return false;
  return !GENERIC_SCOPE_VALUES.has(normalizedValue);
}

export function ResetHistoryDetails({
  item,
  locale,
  compact = false,
  showScope = true,
  hideScopeOnMobile = false,
  hideReasonOnMobile = false,
  hideNoticeType = false,
  hideNoticeToExecutionOnMobile = false,
  hideNoteOnMobile = false,
}: ResetHistoryDetailsProps) {
  const details = item.details ?? {
    cycleType: item.resetType,
    reasonType: item.resetTypes?.find((type) => type !== item.resetType) ?? item.resetType,
    resetMethod: item.windowLength,
    scope: item.scope,
    noticeToExecution: item.windowLength,
    note: item.summary,
  };

  const recordKind = item.recordKind ?? "confirmed_global";
  const canonicalDetails = item.canonicalDetails;
  const isBankedDistribution = canonicalDetails?.resetMethod === "banked_reset_distribution" ||
    recordKind === "banked_distribution";
  const candidateRows: Array<{ id: string; label: string; value: string }> = [
    {
      id: "cycleType",
      label: translateUI("historyCycleType", locale),
      value: details.cycleType,
    },
    ...(details.reasonType && isMeaningfulValue(details.reasonType)
      ? [{ id: "reasonType", label: translateUI("historyReasonType", locale), value: details.reasonType }]
      : []),
    {
      id: "resetMethod",
      label: translateUI("historyResetMethod", locale),
      value: details.resetMethod,
    },
    ...(showScope && shouldShowScope(details.scope)
      ? [{ id: "scope", label: translateUI("scope", locale), value: details.scope }]
      : []),
    ...(canonicalDetails && canonicalDetails.noticeType
      ? [{ id: "noticeType", label: translateUI("historyNoticeType", locale), value: details.noticeType ?? "" }]
      : []),
    ...(canonicalDetails?.noticeType === "present" &&
    canonicalDetails.noticeToExecutionMinutes !== null
      ? [{
          id: "noticeToExecution",
          label: translateUI("historyNoticeToExecution", locale),
          value: details.noticeToExecution,
        }]
      : []),
  ];

  const rows = candidateRows.filter((row) => {
    if (!isMeaningfulValue(row.value)) return false;
    if (row.id === "noticeType" && hideNoticeType) return false;
    if (
      isBankedDistribution &&
      row.id === "resetMethod" &&
      !canonicalDetails
    ) {
      return false;
    }
    return true;
  });

  return (
    <div className={compact ? "mt-2 space-y-2" : "mt-3 space-y-3"}>
      <dl className="grid gap-x-4 gap-y-2 text-sm sm:grid-cols-2">
        {rows.map(({ id, label, value }) => (
          <div
            className={`grid grid-cols-[7.5rem_1fr] gap-2 ${
            (hideScopeOnMobile && id === "scope") ||
              (hideReasonOnMobile && id === "reasonType") ||
              (hideNoticeToExecutionOnMobile && id === "noticeToExecution")
                ? "hidden sm:grid"
                : ""
            }`}
            key={id}
          >
            <dt className="text-slate-500">{label}</dt>
            <dd className="font-medium text-slate-800">{value}</dd>
          </div>
        ))}
      </dl>
      {isMeaningfulValue(details.note) ? (
        <div
          className={`rounded border border-slate-100/70 bg-slate-50 p-2.5 text-sm leading-6 text-slate-600 ${
            hideNoteOnMobile ? "hidden sm:block" : ""
          }`}
        >
          <p className="font-medium text-slate-500">
            {translateUI("historyNote", locale)}
          </p>
          <p className="mt-1">{details.note}</p>
        </div>
      ) : null}
    </div>
  );
}
