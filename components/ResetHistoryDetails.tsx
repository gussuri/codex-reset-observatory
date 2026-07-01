import type { Locale, RadarViewModel } from "@/lib/radar/types";
import { translateUI, translateDynamic } from "@/lib/radar/i18n";

type ResetHistoryItem = RadarViewModel["recentHistory"][number];

type ResetHistoryDetailsProps = {
  item: ResetHistoryItem;
  locale: Locale;
  compact?: boolean;
  showScope?: boolean;
};

export function ResetHistoryDetails({
  item,
  locale,
  compact = false,
  showScope = true,
}: ResetHistoryDetailsProps) {
  const details = item.details ?? {
    cycleType: item.resetType,
    reasonType: item.resetTypes?.find((type) => type !== item.resetType) ?? item.resetType,
    resetMethod: item.windowLength,
    scope: item.scope,
    noticeToExecution: item.windowLength,
    note: item.summary,
  };

  const rows: Array<readonly [string, string]> = [
    [translateUI("historyCycleType", locale), details.cycleType],
    [translateUI("historyReasonType", locale), details.reasonType],
    [translateUI("historyResetMethod", locale), details.resetMethod],
  ];

  if (showScope) {
    rows.splice(3, 0, [translateUI("scope", locale), details.scope]);
  }

  rows.push([translateUI("historyNoticeToExecution", locale), details.noticeToExecution]);

  return (
    <div className={compact ? "mt-2 space-y-2" : "mt-3 space-y-3"}>
      <dl className="grid gap-x-4 gap-y-2 text-sm sm:grid-cols-2">
        {rows.map(([label, value]) => (
          <div className="grid grid-cols-[7.5rem_1fr] gap-2" key={label}>
            <dt className="text-slate-500">{label}</dt>
            <dd className="font-medium text-slate-800">{translateDynamic(value, locale)}</dd>
          </div>
        ))}
      </dl>
      {details.note ? (
        <div className="rounded border border-slate-100/70 bg-slate-50 p-2.5 text-sm leading-6 text-slate-600">
          <p className="font-medium text-slate-500">
            {translateUI("historyNote", locale)}
          </p>
          <p className="mt-1">{translateDynamic(details.note, locale)}</p>
        </div>
      ) : null}
    </div>
  );
}
