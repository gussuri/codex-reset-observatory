import type { Locale } from "./types";

export const UI_TRANSLATIONS: Record<string, Record<Locale, string>> = {
  title: {
    ja: "Codexリセット観測所",
    en: "Codex Reset Observatory",
    zh: "Codex 重置观测站",
  },
  siteStatus: {
    ja: "サイトの状態",
    en: "Update status",
    zh: "更新状态",
  },
  manualReviewAvailable: {
    ja: "🟢 手動確認対応中",
    en: "🟢 Manual review active",
    zh: "🟢 人工确认进行中",
  },
  manualReviewDelayed: {
    ja: "🌙 手動確認が遅れる場合があります",
    en: "🌙 Manual review may be delayed",
    zh: "🌙 人工确认可能会延迟",
  },
  lastCheckedLabel: {
    ja: "最終更新時刻",
    en: "Last updated",
    zh: "上次更新",
  },
  subTitle: {
    ja: "Codex制限解除・使用量リセット情報",
    en: "Codex reset notices, history, and probability",
    zh: "Codex 使用限制重置信息",
  },
  description: {
    ja: "利用上限リセット、制限解除タイミング、リセット履歴、期待度をまとめて確認できます。",
    en: "Track the likelihood of an OpenAI Codex usage-limit reset, recent signals, and past reset events. This site estimates whether another reset is likely within the next 24 or 48 hours.",
    zh: "一站式查看 Codex 使用限制的重置状态、预计时间、历史记录和重置可能性。",
  },
  officialNotice: {
    ja: "公式リセット予告",
    en: "Reset-related notice",
    zh: "重置相关预告",
  },
  noNotice: {
    ja: "公式リセット予告はありません",
    en: "No reset-related notice",
    zh: "暂无官方重置预告",
  },
  activeNoticeLabel: {
    ja: "予告あり",
    en: "Notice available",
    zh: "已有预告",
  },
  noNoticeLabel: {
    ja: "予告なし",
    en: "No notice",
    zh: "无预告",
  },
  checkAction: {
    ja: "要確認",
    en: "Pending confirmation",
    zh: "尚待确认",
  },
  scheduledResetTime: {
    ja: "予告時間",
    en: "Estimated reset window",
    zh: "预告时间",
  },
  source: {
    ja: "ソース",
    en: "Source",
    zh: "来源",
  },
  currentStatus: {
    ja: "現在の状況",
    en: "Current outlook",
    zh: "当前状况",
  },
  randomReset: {
    ja: "ランダムリセット",
    en: "Unscheduled reset probability",
    zh: "不定期重置",
  },
  expectationLabel: {
    ja: "期待度",
    en: "Likelihood",
    zh: "重置可能性",
  },
  within24h: {
    ja: "24時間以内",
    en: "Within 24h",
    zh: "24小时内",
  },
  within48h: {
    ja: "48時間以内",
    en: "Within 48h",
    zh: "48小时内",
  },
  disclaimer: {
    ja: "※この予測はコミュニティや障害状況などを基にした目安であり、公式の発表とは異なる場合があります。",
    en: "This is a reference estimate based on public signals, usage-limit anomalies, community activity, and official updates. It is not an official notice.",
    zh: "※本预测仅供参考，依据社区动态、故障状态等信息计算，可能与官方实际安排不同。",
  },
  viewAllHistoryLink: {
    ja: "さらにリセット履歴を見る →",
    en: "View all reset history →",
    zh: "查看更多重置历史 →",
  },
  timeRangeSeparator: {
    ja: " 〜 ",
    en: " to ",
    zh: " 至 ",
  },
  latestReset: {
    ja: "最新のリセット",
    en: "Latest reset",
    zh: "最新重置",
  },
  scope: {
    ja: "対象プラン",
    en: "Scope",
    zh: "适用套餐",
  },
  detectionTime: {
    ja: "リセット検知時刻",
    en: "Reset detection time",
    zh: "重置检测时间",
  },
  resetTime: {
    ja: "リセット実施時刻",
    en: "Reset time",
    zh: "重置执行时间",
  },
  windowLength: {
    ja: "予告から実施まで",
    en: "Time from notice to reset",
    zh: "从预告到执行",
  },
  historyCycleType: {
    ja: "分類",
    en: "Category",
    zh: "分类",
  },
  historyReasonType: {
    ja: "理由",
    en: "Reason",
    zh: "原因",
  },
  historyResetMethod: {
    ja: "リセット方法",
    en: "Reset method",
    zh: "重置方式",
  },
  historyNoticeToExecution: {
    ja: "告知から実施まで",
    en: "Time from notice to reset",
    zh: "从预告到执行",
  },
  historyNote: {
    ja: "補足",
    en: "Note",
    zh: "补充",
  },
  weeklyResetRef: {
    ja: "1週間サイクルのリセット参考日",
    en: "Weekly reset reference",
    zh: "每周重置参考日期",
  },
  weeklyResetNote: {
    ja: "任意リセットを使ったアカウントでは、次回定期リセット日がこちらに表示している日付とずれます。",
    en: "If you used a manual reset, your next weekly reset date will differ from the reference date shown here.",
    zh: "使用过手动重置的账号，下次定期重置日期可能与此处显示的日期有所偏差。",
  },
  resetHistory: {
    ja: "リセット履歴",
    en: "Reset history",
    zh: "重置历史",
  },
  recentResetEvents: {
    ja: "直近のリセット履歴",
    en: "Recent reset events",
    zh: "最近的重置历史",
  },
  noHistory: {
    ja: "直近履歴は取得できていません。",
    en: "No reset history is available.",
    zh: "未能获取最近的重置历史。",
  },
  lastUpdated: {
    ja: "最終更新時刻",
    en: "Last updated",
    zh: "最后更新时间",
  },
  dataFetched: {
    ja: "データ取得時刻",
    en: "Data fetched",
    zh: "数据获取时间",
  },
  reason: {
    ja: "理由",
    en: "Reason",
    zh: "原因",
  },
  about: {
    ja: "About",
    en: "About",
    zh: "关于",
  },
  faq: {
    ja: "FAQ",
    en: "FAQ",
    zh: "常见问题",
  },
  history: {
    ja: "History",
    en: "History",
    zh: "历史",
  },
  languageName: {
    ja: "日本語",
    en: "English",
    zh: "简体中文",
  },
};

export const DYNAMIC_TRANSLATIONS: Record<string, Record<Locale, string>> = {
  "Tibo氏の公式Xで告知あり": {
    ja: "Tibo氏の公式Xで告知あり",
    en: "Announced on Tibo's official X",
    zh: "在 Tibo 官方 X 上发布预告",
  },
  "900万人アクティブユーザー記念の可能性": {
    ja: "900万人アクティブユーザー記念の可能性",
    en: "a possible celebration reset for reaching 9 million active users",
    zh: "可能庆祝达到 900 万活跃用户而重置",
  },
  "Tibo氏が900万人アクティブユーザー到達に伴う利用制限の追加リセット（または制限緩和）を示唆しました。": {
    ja: "Tibo氏が900万人アクティブユーザー到達に伴う利用制限の追加リセット（または制限緩和）を示唆しました。",
    en: "Tibo suggested an additional reset (or limit relaxation) of usage limits to celebrate reaching 9M active users.",
    zh: "Tibo 暗示，为庆祝活跃用户达到 900 万，Codex 的使用限制可能会再次重置或放宽。",
  },
  "Tibo氏が900万人アクティブユーザー到達に伴う利用制限の追加リセット（または制限緩和）を示唆しました。7月16日朝〜17日朝にかけての実施が予想されます。": {
    ja: "Tibo氏が900万人アクティブユーザー到達に伴う利用制限の追加リセット（または制限緩和）を示唆しました。7月16日朝〜17日朝にかけての実施が予想されます。",
    en: "Tibo suggested an additional reset (or limit relaxation) of usage limits to celebrate reaching 9M active users. Expected execution is between the morning of July 16 and the morning of July 17 JST.",
    zh: "Tibo 暗示，为庆祝活跃用户达到 900 万，Codex 的使用限制可能会再次重置或放宽。预计将于 7 月 16 日早上至 17 日早上执行。",
  },
  "Tibo氏が900万人アクティブユーザー到達に伴う利用制限の追加リセット（または制限緩和）を示唆しました。正確な実施時刻は未告知のため、広めの予想レンジを設定しています。": {
    ja: "Tibo氏が900万人アクティブユーザー到達に伴う利用制限の追加リセット（または制限緩和）を示唆しました。正確な実施時刻は未告知のため、広めの予想レンジを設定しています。",
    en: "Tibo suggested an additional reset (or limit relaxation) of usage limits to celebrate reaching 9M active users. Since the exact execution time is unannounced, a wide expected range has been set.",
    zh: "Tibo 暗示，为庆祝活跃用户达到 900 万，Codex 的使用限制可能会再次重置或放宽。由于尚未公布具体执行时间，因此本页面设置了较宽的预计时间范围。请优先查看原帖中的详细信息。",
  },
  "1時間11分": {
    ja: "1時間11分",
    en: "1 hour 11 minutes",
    zh: "1 小时 11 分钟",
  },
  "Tibo氏が、過剰な利用制限消費問題の補償として、全プランのCodex利用制限を数時間以内にリセットすると発表しました。": {
    ja: "Tibo氏が、過剰な利用制限消費問題の補償として、全プランのCodex利用制限を数時間以内にリセットすると発表しました。",
    en: "Tibo announced that Codex usage limits across all plans will be reset within a few hours to compensate for an issue causing excessive usage consumption.",
    zh: "Tibo 宣布将在数小时内重置所有计划的 Codex 使用限制，以补偿导致使用额度过度消耗的问题。",
  },
  // Titles / Reset Types
  "500万人達成記念リセット": {
    ja: "500万人達成記念リセット",
    en: "5M user milestone reset",
    zh: "500 万用户庆祝重置",
  },
  "500 万用户庆祝重置": {
    ja: "500万人達成記念リセット",
    en: "5M user milestone reset",
    zh: "500 万用户庆祝重置",
  },
  "5M users celebration reset": {
    ja: "500万人達成記念リセット",
    en: "5M user milestone reset",
    zh: "500 万用户庆祝重置",
  },
  "Codex障害対応の利用上限リセット": {
    ja: "Codex障害対応の利用上限リセット",
    en: "Codex reliability compensation reset",
    zh: "Codex 可靠性事故补偿重置",
  },
  "Codex 可靠性事故补偿重置": {
    ja: "Codex障害対応の利用上限リセット",
    en: "Codex reliability compensation reset",
    zh: "Codex 可靠性事故补偿重置",
  },
  "Codex reliability compensation reset": {
    ja: "Codex障害対応の利用上限リセット",
    en: "Codex reliability compensation reset",
    zh: "Codex 可靠性事故补偿重置",
  },
  "Codex利用上限リセット": {
    ja: "Codex利用上限リセット",
    en: "Codex usage-limit reset",
    zh: "Codex使用限制重置",
  },
  "Codex usage-limit reset": {
    ja: "Codex利用上限リセット",
    en: "Codex usage-limit reset",
    zh: "Codex使用限制重置",
  },
  "GPT-5.5性能低下への補償リセット": {
    ja: "GPT-5.5性能低下への補償リセット",
    en: "GPT-5.5 degradation compensation reset",
    zh: "GPT-5.5 能力退化补偿重置",
  },
  "GPT-5.5 能力退化补偿重置": {
    ja: "GPT-5.5性能低下への補償リセット",
    en: "GPT-5.5 degradation compensation reset",
    zh: "GPT-5.5 能力退化补偿重置",
  },
  "GPT-5.5 degradation compensation reset": {
    ja: "GPT-5.5性能低下への補償リセット",
    en: "GPT-5.5 degradation compensation reset",
    zh: "GPT-5.5 能力退化补偿重置",
  },
  "長時間セッション圧縮の消費異常に対する補償リセット": {
    ja: "長時間セッション圧縮の消費異常に対する補償リセット",
    en: "Long-session compression usage anomaly compensation reset",
    zh: "长会话压缩耗额异常补偿重置",
  },
  "长会话压缩耗额异常补偿重置": {
    ja: "長時間セッション圧縮の消費異常に対する補償リセット",
    en: "Long-session compression usage anomaly compensation reset",
    zh: "长会话压缩耗额异常补偿重置",
  },
  "Long-session compression usage anomaly compensation reset": {
    ja: "長時間セッション圧縮の消費異常に対する補償リセット",
    en: "Long-session compression usage anomaly compensation reset",
    zh: "长会话压缩耗额异常补偿重置",
  },
  "Sam氏の投稿をきっかけにしたレート制限リセット": {
    ja: "Sam氏の投稿をきっかけにしたレート制限リセット",
    en: "Rate-limit reset triggered by Sam's post",
    zh: "Sam 点赞承诺速率限制重置",
  },
  "Sam 点赞承诺速率限制重置": {
    ja: "Sam氏の投稿をきっかけにしたレート制限リセット",
    en: "Rate-limit reset triggered by Sam's post",
    zh: "Sam 点赞承诺速率限制重置",
  },
  "Rate-limit reset triggered by Sam's post": {
    ja: "Sam氏の投稿をきっかけにしたレート制限リセット",
    en: "Rate-limit reset triggered by Sam's post",
    zh: "Sam 点赞承诺速率限制重置",
  },
  "周度庆祝付费计划重置": {
    ja: "週次の節目を祝う有料プランリセット",
    en: "Weekly celebration paid plan reset",
    zh: "周度庆祝付费套餐重置",
  },
  "400 万活跃用户里程碑重置": {
    ja: "400万アクティブユーザー達成記念リセット",
    en: "4M active users milestone reset",
    zh: "400 万活跃用户里程碑重置",
  },
  "局部故障补偿重置": {
    ja: "一部障害への補償リセット",
    en: "Partial incident compensation reset",
    zh: "局部故障补偿重置",
  },
  "一周年纪念重置": {
    ja: "1周年記念リセット",
    en: "1st anniversary reset",
    zh: "一周年纪念重置",
  },
  "300 万周活用户与新计划重置": {
    ja: "300万週間アクティブユーザーと新プランに伴うリセット",
    en: "3M weekly active users and new plan reset",
    zh: "300 万周活用户与新计划重置",
  },

  // Scopes
  "全有料プラン": {
    ja: "全有料プラン",
    en: "All paid plans",
    zh: "所有付费套餐",
  },
  "全プラン": {
    ja: "全プラン",
    en: "All plans",
    zh: "所有计划",
  },
  "所有付费计划": {
    ja: "全有料プラン",
    en: "All paid plans",
    zh: "所有付费套餐",
  },
  "All paid plans": {
    ja: "全有料プラン",
    en: "All paid plans",
    zh: "所有付费套餐",
  },
  "All plans": {
    ja: "全プラン",
    en: "All plans",
    zh: "所有计划",
  },
  "Codexユーザー": {
    ja: "Codexユーザー",
    en: "Codex users",
    zh: "Codex 用户",
  },
  "Codex 用户": {
    ja: "Codexユーザー",
    en: "Codex users",
    zh: "Codex 用户",
  },
  "Codex users": {
    ja: "Codexユーザー",
    en: "Codex users",
    zh: "Codex 用户",
  },
  "既存の$200 Proユーザー": {
    ja: "既存の$200 Proユーザー",
    en: "Existing $200 Pro users",
    zh: "现有 $200 Pro 用户",
  },
  "现有 $200 Pro 用户": {
    ja: "既存の$200 Proユーザー",
    en: "Existing $200 Pro users",
    zh: "现有 $200 Pro 用户",
  },

  // Window Humans
  "定期実施": {
    ja: "定期実施",
    en: "Weekly cycle",
    zh: "定期执行",
  },
  "即時リセット": {
    ja: "即時リセット",
    en: "Immediate reset",
    zh: "即时重置",
  },
  "无窗": {
    ja: "即時リセット",
    en: "Immediate reset",
    zh: "无时间窗",
  },
  "9時間25分": {
    ja: "9時間25分",
    en: "9 hours 25 minutes",
    zh: "9小时25分",
  },
  "9小时25分": {
    ja: "9時間25分",
    en: "9 hours 25 minutes",
    zh: "9小时25分",
  },
  "19時間53分": {
    ja: "19時間53分",
    en: "19 hours 53 minutes",
    zh: "19小时53分",
  },
  "19小时53分": {
    ja: "19時間53分",
    en: "19 hours 53 minutes",
    zh: "19小时53分",
  },
  "8分": {
    ja: "8分",
    en: "8 minutes",
    zh: "8分钟",
  },
  "8分钟": {
    ja: "8分",
    en: "8 minutes",
    zh: "8分钟",
  },
  "17時間20分": {
    ja: "17時間20分",
    en: "17 hours 20 minutes",
    zh: "17小时20分",
  },
  "17小时20分": {
    ja: "17時間20分",
    en: "17 hours 20 minutes",
    zh: "17小时20分",
  },

  // Statuses
  "配布": {
    ja: "配布",
    en: "Distributed",
    zh: "发放",
  },
  "検知": {
    ja: "検知",
    en: "Detected",
    zh: "检测到",
  },
  "実施": {
    ja: "実施",
    en: "Reset",
    zh: "执行",
  },
  "実施予定": {
    ja: "実施予定",
    en: "Planned reset",
    zh: "计划执行",
  },
  "終了": {
    ja: "終了",
    en: "Closed",
    zh: "结束",
  },
  "リセット実施": {
    ja: "リセット実施",
    en: "Reset completed",
    zh: "重置执行",
  },
  "予告検知": {
    ja: "予告検知",
    en: "Notice detected",
    zh: "检测到预告",
  },
  "予告中": {
    ja: "予告中",
    en: "Notice active",
    zh: "预告中",
  },
  "定期リセット": {
    ja: "定期リセット",
    en: "Weekly reset",
    zh: "定期重置",
  },
  "詫びリセット": {
    ja: "詫びリセット",
    en: "Compensation reset",
    zh: "故障补偿重置",
  },
  "ご祝儀リセット": {
    ja: "ご祝儀リセット",
    en: "Celebration reset",
    zh: "庆祝重置",
  },
  "予告付き臨時リセット": {
    ja: "予告付き臨時リセット",
    en: "Announced temporary reset",
    zh: "带预告的临时重置",
  },
  "コミュニティ予測": {
    ja: "コミュニティ予測",
    en: "Community signal",
    zh: "社区预测",
  },
  "その他": {
    ja: "その他",
    en: "Other",
    zh: "其他",
  },
  "ランダムリセット": {
    ja: "ランダムリセット",
    en: "Unscheduled reset",
    zh: "随机重置",
  },
  "個人別リセット": {
    ja: "個人別リセット",
    en: "Account-specific reset",
    zh: "账号特定重置",
  },
  "通常更新": {
    ja: "通常更新",
    en: "Regular refresh",
    zh: "常规更新",
  },
  "通常更新 / 詫びリセット": {
    ja: "通常更新 / 詫びリセット",
    en: "Regular refresh / Compensation reset",
    zh: "常规更新 / 故障补偿重置",
  },
  "強制リセット": {
    ja: "強制リセット",
    en: "Forced reset",
    zh: "强制重置",
  },
  "利用上限更新": {
    ja: "利用上限更新",
    en: "Usage-limit refresh",
    zh: "使用限制更新",
  },
  "任意リセット権1回配布": {
    ja: "任意リセット権1回配布",
    en: "1 manual reset credit",
    zh: "发放 1 次手动重置机会",
  },
  "不明": {
    ja: "不明",
    en: "Unknown",
    zh: "未知",
  },
  "即時実行": {
    ja: "即時実行",
    en: "Immediate execution",
    zh: "即时执行",
  },
  "数時間以内": {
    ja: "数時間以内",
    en: "Within a few hours",
    zh: "数小时内",
  },
  "26分": {
    ja: "26分",
    en: "26 minutes",
    zh: "26分钟",
  },
  "40分": {
    ja: "40分",
    en: "40 minutes",
    zh: "40分钟",
  },

  // Summaries
  "通常の1週間サイクルのタイミングで、Codexの利用上限リセットが実施されました。": {
    ja: "通常の1週間サイクルのタイミングで、Codexの利用上限リセットが実施されました。",
    en: "Codex usage limits were reset on the usual weekly-cycle timing.",
    zh: "在常规的 1 周循环时间点，执行了 Codex 使用限制重置。",
  },
  "1週間サイクルの定期リセットが実施されました。": {
    ja: "1週間サイクルの定期リセットが実施されました。",
    en: "A weekly-cycle reset was completed.",
    zh: "已执行 1 周循环的定期重置。",
  },
  "アクティブユーザー数800万人到達を記念し、ChatGPT WorkとCodex全体の利用上限が強制リセットされました。※発表から順次適用されているため、アカウントへの反映に数十分から数時間程度の遅延が発生する場合があります。": {
    ja: "アクティブユーザー数800万人到達を記念し、ChatGPT WorkとCodex全体の利用上限が強制リセットされました。※発表から順次適用されているため、アカウントへの反映に数十分から数時間程度の遅延が発生する場合があります。",
    en: "Usage limits for ChatGPT Work and Codex were reset to celebrate reaching 8 million active users. *Because the reset is being applied sequentially, there may be a delay of several minutes to hours before it takes effect on your account.",
    zh: "为庆祝活跃用户数达到800万，ChatGPT Work和Codex整体的使用限制已强制重置。※由于重置是顺序应用的，您的账号可能会出现几十分钟到数小时的延迟。",
  },
  "アクティブユーザー数800万人到達を記念し、ChatGPT WorkとCodex全体の利用上限が強制リセットされる予定です。06:00 JST 頃の実施が見込まれています。※発表から順次適用されているため、アカウントへの反映に数十分から数時間程度の遅延が発生する場合があります。": {
    ja: "アクティブユーザー数800万人到達を記念し、ChatGPT WorkとCodex全体の利用上限が強制リセットされる予定です。06:00 JST 頃の実施が見込まれています。※発表から順次適用されているため、アカウントへの反映に数十分から数時間程度の遅延が発生する場合があります。",
    en: "Usage limits for ChatGPT Work and Codex are scheduled to be reset to celebrate reaching 8 million active users, around 06:00 JST. *Because the reset is applied sequentially, there may be a delay of several minutes to hours before it takes effect on your account.",
    zh: "为庆祝活跃用户数达到800万，ChatGPT Work和Codex整体的使用限制预计将于JST 06:00左右强制重置。※由于重置是顺序应用的，您的账号可能会出现几十分钟到数小时的延迟。",
  },
  "アクティブユーザー数800万人到達を記念し、ChatGPT WorkとCodex全体の利用上限が06:00 JST頃に強制リセットされる予定です。※発表から順次適用されているため、アカウントへの反映に数十分から数時間程度の遅延が発生する場合があります。": {
    ja: "アクティブユーザー数800万人到達を記念し、ChatGPT WorkとCodex全体の利用上限が06:00 JST頃に強制リセットされる予定です。※発表から順次適用されているため、アカウントへの反映に数十分から数時間程度の遅延が発生する場合があります。",
    en: "Usage limits for ChatGPT Work and Codex are scheduled to be reset around 06:00 JST to celebrate reaching 8 million active users. *Because the reset is applied sequentially, there may be a delay of several minutes to hours before it takes effect on your account.",
    zh: "为庆祝活跃用户数达到800万，ChatGPT Work和Codex整体的使用限制预计将于JST 06:00左右强制重置。※由于重置是顺序应用的，您的账号可能会出现几十分钟到数小时的延迟。",
  },
  "アクティブユーザー数800万人到達を記念し、ChatGPT WorkとCodex全体の利用上限が強制リresetされました。※発表から順次適用されているため、アカウントへの反映に数十分から数時間程度の遅延が発生する場合があります。": {
    ja: "アクティブユーザー数800万人到達を記念し、ChatGPT WorkとCodex全体の利用上限が強制リセットされました。※発表から順次適用されているため、アカウントへの反映に数十分から数時間程度の遅延が発生する場合があります。",
    en: "Usage limits for ChatGPT Work and Codex were reset to celebrate reaching 8 million active users. *Because the reset is being applied sequentially, there may be a delay of several minutes to hours before it takes effect on your account.",
    zh: "为庆祝活跃用户数达到800万，ChatGPT Work和Codex整体的使用限制已强制重置。※由于重置是顺序应用的，您的账号可能会出现几十分钟到数小时の延迟。",
  },
  "前回リセット直後（間隔理論による確率抑制）": {
    ja: "前回リセット直後（間隔理論による確率抑制）",
    en: "Post-reset suppression (interval theory)",
    zh: "重置后概率抑制（间隔理论）",
  },
  "Tibo氏の「明日またChatGPTとCodexの楽しい出来事で会いましょう」匂わせ投稿": {
    ja: "Tibo氏の「明日またChatGPTとCodexの楽しい出来事で会いましょう」匂わせ投稿",
    en: "Tibo's post hinting 'See you back tomorrow for more ChatGPT and Codex fun'",
    zh: "Tibo 发帖暗示“明天见，享受更多 ChatGPT 和 Codex 的乐趣”",
  },
  "Tibo氏が「See you back tomorrow for more ChatGPT and Codex fun」と投稿（明日以降の追加発表・リセットを示唆）": {
    ja: "Tibo氏が「See you back tomorrow for more ChatGPT and Codex fun」と投稿（明日以降の追加発表・リセットを示唆）",
    en: "Tibo posted 'See you back tomorrow for more ChatGPT and Codex fun' (hinting at upcoming announcements/resets)",
    zh: "Tibo 发帖称“See you back tomorrow for more ChatGPT and Codex fun”（暗示明天起的追加发布/重置）",
  },
  "ChatGPT Work急速採用記念リセット": {
    ja: "ChatGPT Work急速採用記念リセット",
    en: "ChatGPT Work Rapid Adoption Celebration Reset",
    zh: "ChatGPT Work 快速采用庆祝重置",
  },
  "ChatGPT Workの急速な普及とチームの努力を祝し、CodexとChatGPT Work全体の利用上限が強制リセットされました。": {
    ja: "ChatGPT Workの急速な普及とチームの努力を祝し、CodexとChatGPT Work全体の利用上限が強制リセットされました。",
    en: "Usage limits for Codex and ChatGPT Work were forcibly reset to celebrate the rapid adoption of ChatGPT Work and team efforts.",
    zh: "为庆祝 ChatGPT Work 的快速普及和团队付出的努力，Codex 与 ChatGPT Work 整体的使用限制已强制重置。",
  },
  "大規模障害に伴う詫びリセット": {
    ja: "大規模障害に伴う詫びリセット",
    en: "Outage Compensation Reset",
    zh: "大规模故障补偿重置",
  },
  "世界規模で発生したシステム障害の復旧に伴い、ChatGPT WorkとCodex全体の利用上限が強制リセットされました。": {
    ja: "世界規模で発生したシステム障害の復旧に伴い、ChatGPT WorkとCodex全体の利用上限が強制リセットされました。",
    en: "Usage limits for ChatGPT Work and Codex were forcibly reset following full recovery from a global system outage.",
    zh: "为弥补全球范围发生的系统故障，ChatGPT Work 和 Codex 的使用限制已在服务恢复后强制重置。",
  },
  "Tibo氏が「Tomorrow is feeling codexy」と投稿（Codex関連の更新・リセットを示唆）": {
    ja: "Tibo氏が「Tomorrow is feeling codexy」と投稿（Codex関連の更新・リセットを示唆）",
    en: "Tibo posted 'Tomorrow is feeling codexy' (hinting at upcoming Codex updates/reset)",
    zh: "Tibo 发帖称“Tomorrow is feeling codexy”（暗示即将来临的 Codex 更新/重置）",
  },
  "Tibo氏の「Tomorrow is feeling codexy」匂わせ投稿": {
    ja: "Tibo氏の「Tomorrow is feeling codexy」匂わせ投稿",
    en: "Tibo's 'Tomorrow is feeling codexy' teaser post",
    zh: "Tibo 的“Tomorrow is feeling codexy”预告贴",
  },
  "1000万人アクティブユーザー記念リセット": {
    ja: "1000万人アクティブユーザー記念リセット",
    en: "10M Active Users Celebration Reset",
    zh: "1000万活跃用户庆祝重置",
  },
  "アクティブユーザー数1000万人到達を記念し、ChatGPT WorkとCodex全体の利用上限が強制リセットされました。": {
    ja: "アクティブユーザー数1000万人到達を記念し、ChatGPT WorkとCodex全体の利用上限が強制リセットされました。",
    en: "Usage limits for ChatGPT Work and Codex were reset to celebrate reaching 10 million active users.",
    zh: "为庆祝活跃用户数达到 1000 万，ChatGPT Work 和 Codex 的使用限制已被强制重置。",
  },
  "16分": {
    ja: "16分",
    en: "16 minutes",
    zh: "16 分钟",
  },
  "900万人アクティブユーザー記念リセット": {
    ja: "900万人アクティブユーザー記念リセット",
    en: "9 million active users celebration reset",
    zh: "900万活跃用户庆祝重置",
  },
  "アクティブユーザー数900万人到達を記念し、ChatGPT WorkとCodex全体の利用上限が強制リセットされました。": {
    ja: "アクティブユーザー数900万人到達を記念し、ChatGPT WorkとCodex全体の利用上限が強制リセットされました。",
    en: "Usage limits for ChatGPT Work and Codex were reset to celebrate reaching 9 million active users.",
    zh: "为庆祝活跃用户数达到 900 万，ChatGPT Work 和 Codex 的使用限制已被强制重置。",
  },
  "0分": {
    ja: "0分",
    en: "0 min",
    zh: "0 分",
  },
  "3時間": {
    ja: "3時間",
    en: "3 hours",
    zh: "3 小时",
  },
  "定期": {
    ja: "定期",
    en: "Scheduled",
    zh: "定期",
  },
  "800万人アクティブユーザー記念リセット": {
    ja: "800万人アクティブユーザー記念リセット",
    en: "8 million active users celebration reset",
    zh: "800万活跃用户庆祝重置",
  },
  "アクティブユーザー数800万人到達を記念し、ChatGPT WorkとCodex全体の利用上限が強制リセットされました。": {
    ja: "アクティブユーザー数800万人到達を記念し、ChatGPT WorkとCodex全体の利用上限が強制リセットされました。",
    en: "Usage limits for ChatGPT Work and Codex were reset to celebrate reaching 8 million active users.",
    zh: "为庆祝活跃用户数达到800万，ChatGPT Work 和 Codex 的使用限制已被强制重置。",
  },
  "800万人アクティブユーザー記念": {
    ja: "800万人アクティブユーザー記念",
    en: "8 million active users celebration",
    zh: "800万活跃用户庆祝",
  },
  "Tibo氏（OpenAI Codex開発者）が、アクティブユーザー数800万人突破を記念してCodex利用上限を再びリセットしたと発表しました。": {
    ja: "Tibo氏（OpenAI Codex開発者）が、アクティブユーザー数800万人突破を記念してCodex利用上限を再びリセットしたと発表しました。",
    en: "Tibo (OpenAI Codex developer) announced that Codex usage limits were reset again to celebrate reaching 8 million active users.",
    zh: "Tibo（OpenAI Codex开发者）宣布为庆祝活跃用户数突破800万，已再次重置Codex使用限制。",
  },
  "Tibo氏（OpenAI Codex開発者）が、アクティブユーザー数800万人突破を記念してCodex利用上限をリセットすると発表しました。06:00 JST頃の実施が見込まれます。": {
    ja: "Tibo氏（OpenAI Codex開発者）が、アクティブユーザー数800万人突破を記念してCodex利用上限をリセットすると発表しました。06:00 JST頃の実施が見込まれます。",
    en: "Tibo (OpenAI Codex developer) announced that Codex usage limits will be reset to celebrate reaching 8 million active users, expected around 06:00 JST.",
    zh: "Tibo（OpenAI Codex开发者）宣布为庆祝活跃用户数突破800万，将重置Codex使用限制，预计JST 06:00左右实施。",
  },
  "800万人アクティブユーザー記念の可能性": {
    ja: "800万人アクティブユーザー記念の可能性",
    en: "potential 8M active users celebration",
    zh: "可能庆祝800万活跃用户",
  },
  "700万人アクティブユーザー記念任意リセット配布": {
    ja: "700万人アクティブユーザー記念任意リセット配布",
    en: "7 Million Active Users Celebration Manual Reset Distribution",
    zh: "700万活跃用户庆祝手动重置发放",
  },
  "20時間40分": {
    ja: "20時間40分",
    en: "20 hours 40 minutes",
    zh: "20小时40分钟",
  },
  "700万人アクティブユーザー記念": {
    ja: "700万人アクティブユーザー記念",
    en: "7 Million Active Users Celebration",
    zh: "700万活跃用户庆祝",
  },
  "Web/モバイル機能不具合補償任意リセット": {
    ja: "Web/モバイル機能不具合補償任意リセット",
    en: "Web/Mobile Feature Bug Compensation Manual Reset",
    zh: "网页/移动端功能异常补偿手动重置",
  },
  "不具合対象ユーザー（約50万人）": {
    ja: "不具合対象ユーザー（約50万人）",
    en: "Affected users (approx. 500k)",
    zh: "异常受影响用户（约 50 万人）",
  },
  "アクティブユーザー数700万人到達を記念し、全有料ユーザー（Codex Go/Plus/Pro）に対して任意リセット（マニュアルリセット）1回分が配布されました。": {
    ja: "アクティブユーザー数700万人到達を記念し、全有料ユーザー（Codex Go/Plus/Pro）に対して任意リセット（マニュアルリセット）1回分が配布されました。",
    en: "One banked manual reset was granted to all paid users (Codex Go/Plus/Pro) to celebrate reaching 7 million active users.",
    zh: "为庆祝活跃用户数达到700万，已向所有付费用户（Codex Go/Plus/Pro）发放了 1 次手动重置机会（banked reset）。",
  },
  "Web/モバイルからの任意リセット機能リリース時に、ボタンを押しても適用されなかった一部ユーザー（約50万人）に対して任意リセット（マニュアルリセット）1回分が補償配布されました。": {
    ja: "Web/モバイルからの任意リセット機能リリース時に、ボタンを押しても適用されなかった一部ユーザー（約50万人）に対して任意リセット（マニュアルリセット）1回分が補償配布されました。",
    en: "One banked manual reset was granted as compensation to approximately 500,000 affected users whose reset did not apply after they pressed the button during the web/mobile feature rollout.",
    zh: "由于网页/移动端手动重置功能发布时，部分用户（约 50 万人）点击重置按钮后未生效，已向所有受影响的付费用户补发 1 次手动重置机会。",
  },
  "Tibo氏（OpenAI Codex開発者）が、明日アクティブユーザー数700万人突破を記念して全有料ユーザーに任意リセット枠（banked reset）1回分を付与すると発表しました。": {
    ja: "Tibo氏（OpenAI Codex開発者）が、明日アクティブユーザー数700万人突破を記念して全有料ユーザーに任意リセット枠（banked reset）1回分を付与すると発表しました。",
    en: "Tibo (OpenAI Codex developer) announced that a manual reset (banked reset) credit would be granted to all paid users tomorrow to celebrate reaching 7 million active users.",
    zh: "Tibo（OpenAI Codex开发者）宣布，明天将为庆祝活跃用户数突破700万，向所有付费用户发放 1 次手动重置机会（banked reset）。",
  },
  "即時": {
    ja: "即時",
    en: "Immediate",
    zh: "立即",
  },
  "600万人アクティブユーザー記念リセット": {
    ja: "600万人アクティブユーザー記念リセット",
    en: "6 million active users celebration reset",
    zh: "600万活跃用户庆祝重置",
  },
  "アクティブユーザー数600万人到達を記念し、ChatGPT WorkとCodex全体の利用上限が強制リセットされました。": {
    ja: "アクティブユーザー数600万人到達を記念し、ChatGPT WorkとCodex全体の利用上限が強制リセットされました。",
    en: "Usage limits for ChatGPT Work and Codex were reset to celebrate reaching 6 million active users.",
    zh: "为庆祝活跃用户数达到600万，ChatGPT Work 和 Codex 的使用限制已被强制重置。",
  },
  "600万人アクティブユーザー記念": {
    ja: "600万人アクティブユーザー記念",
    en: "6 million active users celebration",
    zh: "600万活跃用户庆祝",
  },
  "30分": {
    ja: "30分",
    en: "30 minutes",
    zh: "30分钟",
  },
  "Tibo氏（OpenAI Codex開発者）が、アクティブユーザー数600万人突破を記念して1時間以内にCodex利用上限をリセットすると発表しました。": {
    ja: "Tibo氏（OpenAI Codex開発者）が、アクティブユーザー数600万人突破を記念して1時間以内にCodex利用上限をリセットすると発表しました。",
    en: "Tibo (OpenAI Codex developer) announced that Codex usage limits would be reset within an hour to celebrate reaching 6 million active users.",
    zh: "Tibo（OpenAI Codex开发者）宣布为庆祝活跃用户数突破600万，将在1小时内重置Codex使用限制。",
  },
  "Tibo 表示过去 24 小时内有三次影响 Codex 可靠性的小事故，并已为所有付费计划重置 Codex 使用限制。": {
    ja: "過去24時間にCodexの信頼性へ影響する小規模な障害が3件発生したとして、Tibo氏が全有料プランのCodex利用上限をリセットしたと発表しました。",
    en: "Tibo announced that Codex usage limits across all paid plans have been reset due to three minor incidents affecting reliability over the past 24 hours.",
    zh: "Tibo 表示过去 24 小时内有三次影响 Codex 可靠性的小事故，并已为所有付费套餐重置 Codex 使用限制。",
  },
  "Tibo 将这次重置解释为庆祝 Codex 达到 500 万用户；随后确认所有付费 ChatGPT 订阅的周额度和 5 小时额度都已恢复到 100%。": {
    ja: "Codexの500万人達成を祝うリセットとして説明され、その後、有料ChatGPTプランの週次枠と5時間枠が100%に戻ったことが確認されました。",
    en: "Tibo framed this reset as a celebration of Codex reaching 5M users; weekly and 5-hour limits for paid ChatGPT subscriptions were restored to 100%.",
    zh: "Tibo 将这次重置解释为庆祝 Codex 达到 500 万用户；随后确认所有付费 ChatGPT 订阅的周额度和 5 小时额度都已恢复到 100%。",
  },
  "Tibo 表示 Codex 长会话压缩的 cache hit rate 受回滚优化影响，导致限制消耗更快；修复后已为所有账号重置使用限制。": {
    ja: "長時間セッション圧縮のキャッシュヒット率が低下して利用上限の消費が速くなっていた問題について、修正後に全アカウントの利用制限がリセットされました。",
    en: "Tibo said that the cache hit rate for Codex long-session compression was affected by rollback optimization, causing limits to consume faster; after the fix, usage limits were reset for all accounts.",
    zh: "Tibo 表示 Codex 长会话压缩的 cache hit rate 受回滚优化影响，导致限制消耗更快；修复后已为所有账号重置使用限制。",
  },
  "Sam 发文称推文获 1 个赞后 Tibo 会重置 Codex 速率限制，随后社区在数分钟内反馈重置完成。": {
    ja: "Sam氏の投稿をきっかけに、数分後にはコミュニティからリセット完了の反応が出ました。",
    en: "Sam posted that Tibo would reset the Codex rate limit if the tweet got 1 like, and the community reported completion within minutes.",
    zh: "Sam 发文称推文获 1 个赞后 Tibo 会重置 Codex 速率限制，随后社区在数分钟内反馈重置完成。",
  },
  "Tibo 表示两个 GPT-5.5 能力退化问题已修复后，付费计划的使用限制完成重置。": {
    ja: "GPT-5.5の性能低下に関する2件の問題が修正された後、有料プランの利用制限がリセットされました。",
    en: "Tibo stated that after two GPT-5.5 degradation issues were fixed, usage limits for paid plans were reset.",
    zh: "Tibo 表示两个 GPT-5.5 能力退化问题已修复后，付费计划的使用限制完成重置。",
  },
  "2026/06/25 07:01 JST に、全有料プランのCodex利用上限リセットが予定されています。": {
    ja: "2026/06/25 07:01 JST に、全有料プランのCodex利用上限リセットが予定されています。",
    en: "A Codex usage-limit reset for all paid plans is scheduled for Jun 25, 2026 at 7:01 AM JST.",
    zh: "预计于 2026/06/25 07:01 JST 对所有付费套餐重置 Codex 使用限制。",
  },
  "Tibo氏が、全プランのCodexレート制限を24時間以内にリセットすると発表しました。": {
    ja: "Tibo氏が、全プランのCodexレート制限を24時間以内にリセットすると発表しました。",
    en: "Tibo announced that Codex rate limits across all plans will be reset within 24 hours.",
    zh: "Tibo 宣布将在 24 小时内重置所有计划的 Codex 速率限制。",
  },
  "Tibo氏が、全プランのCodexレート制限を24時間以内にリセットすると発表しました。 予告内容を優先して最新状況を確認してください。": {
    ja: "Tibo氏が、全プランのCodexレート制限を24時間以内にリセットすると発表しました。 予告内容を優先して最新状況を確認してください。",
    en: "Tibo announced that Codex rate limits across all plans will be reset within 24 hours. Please check Codex for the latest status.",
    zh: "Tibo 宣布将在 24 小时内重置所有计划的 Codex 速率限制。请优先确认预告内容以获取最新状况。",
  },
  "2026/06/25 07:01 JST に、全有料プランのCodex利用上限リセットが予定されています。 予告内容を優先して最新状況を確認してください。": {
    ja: "2026/06/25 07:01 JST に、全有料プランのCodex利用上限リセットが予定されています。 予告内容を優先して最新状況を確認してください。",
    en: "A Codex usage-limit reset for all paid plans is scheduled for Jun 25, 2026 at 7:01 AM JST. Please check Codex for the latest notice.",
    zh: "预计于 2026/06/25 07:01 JST 对所有付费计划重置 Codex 使用限制。请优先确认预告内容以获取最新状况。",
  },
  "Tibo氏が、一部のユーザーでモデル容量到達エラーが多発していると投稿しました。": {
    ja: "Tibo氏が、一部のユーザーでモデル容量到達エラーが多発していると投稿しました。",
    en: "Tibo posted that some users are experiencing model capacity error spikes.",
    zh: "Tibo 发文称部分用户频繁遇到模型容量达到上限的错误。",
  },
  "Tibo氏が、Codexの一部ユーザーでモデル容量到達エラーが多発していると投稿しました。": {
    ja: "Tibo氏が、Codexの一部ユーザーでモデル容量到達エラーが多発していると投稿しました。",
    en: "Tibo posted that some users are experiencing Codex model capacity error spikes.",
    zh: "Tibo 发文称部分 Codex 用户频繁遇到模型容量达到上限的错误。",
  },
  "Codexに表示あり": {
    ja: "Codexに表示あり",
    en: "Shown in Codex",
    zh: "显示在 Codex",
  },
  "概要は取得できていません。": {
    ja: "概要は取得できていません。",
    en: "No summary is available.",
    zh: "未能获取概要信息。",
  },
  "通常の1週間サイクルのタイミングで、有料プランのCodex利用上限リセットが実施されました。ただし、任意リセットを使用したアカウントは対象外となります。": {
    ja: "通常の1週間サイクルのタイミングで、有料プランのCodex利用上限リセットが実施されました。ただし、任意リセットを使用したアカウントは対象外となります。",
    en: "A regular Codex usage limit reset was executed as part of the weekly cycle. However, accounts that have used a manual reset are excluded.",
    zh: "作为常规的1周循环，付费套餐的Codex使用限制已重置。但使用过手动重置的账号除外。",
  },
  "GPT-5.6リリース記念": {
    ja: "GPT-5.6リリース記念",
    en: "the recent GPT-5.6 launch celebrations",
    zh: "GPT-5.6 发布庆祝活动",
  },
  "GPT-5.6リリース記念ランダムリセット警戒期間に伴う確率底上げブースト (+20%)": {
    ja: "GPT-5.6リリース記念ランダムリセット警戒期間に伴う確率底上げブースト (+20%)",
    en: "GPT-5.6 launch celebration boost (+20% probability boost during unscheduled reset alert period)",
    zh: "GPT-5.6 发布庆祝随机重置警戒期概率提升 (+20%)",
  },
  "システムによる確率調整": {
    ja: "システムによる確率調整",
    en: "System probability adjustment",
    zh: "系统概率调整",
  },
  "OpenAI Codex開発者のTibo氏が「リセットは今日の午後（米国太平洋時間）に来る」と発言しました。": {
    ja: "OpenAI Codex開発者のTibo氏が「リセットは今日の午後（米国太平洋時間）に来る」と発言しました。",
    en: "Tibo, an OpenAI Codex developer, stated that 'reset is coming this afternoon (US Pacific time).'",
    zh: "OpenAI Codex开发者Tibo表示「今天下午（美国太平洋时间）会有重置」。",
  },
  "Tibo氏（OpenAI Codex開発者）のXポストより": {
    ja: "Tibo氏（OpenAI Codex開発者）のXポストより",
    en: "From Tibo's X post (OpenAI Codex developer)",
    zh: "Tibo（OpenAI Codex 开发者）发布的 X 帖子",
  },
  "Tibo氏（OpenAI Codex開発者）がGPT-5.6 Solローンチを記念し、ChatGPT WorkとCodex全体で2回目のレート制限リセットを24時間以内に実施すると発表。": {
    ja: "Tibo氏（OpenAI Codex開発者）がGPT-5.6 Solローンチを記念し、ChatGPT WorkとCodex全体で2回目のレート制限リセットを24時間以内に実施すると発表。",
    en: "Tibo (OpenAI Codex developer) announced a 2nd rate limit reset across ChatGPT Work and Codex within 24 hours to celebrate the GPT-5.6 Sol launch.",
    zh: "Tibo（OpenAI Codex开发者）宣布为庆祝GPT-5.6 Sol发布，将在24小时内对ChatGPT Work 和 Codex 全体执行第2次速率限制重置。",
  },
  "Tibo氏（OpenAI Codex開発者）が、GPT-5.6 Solローンチ記念の3回目のレート制限リセットを本日後半に実施すると発表しました。": {
    ja: "Tibo氏（OpenAI Codex開発者）が、GPT-5.6 Solローンチ記念の3回目のレート制限リセットを本日後半に実施すると発表しました。",
    en: "Tibo (OpenAI Codex developer) announced a third rate limit reset later today (US Pacific time) to celebrate the GPT-5.6 Sol launch.",
    zh: "Tibo（OpenAI Codex开发者）宣布将于今天晚些时候（美国太平洋时间）执行第3次速率限制重置，以庆祝GPT-5.6 Sol发布。",
  },
  "GPT-5.6 Solリリース記念リセット（4回目）": {
    ja: "GPT-5.6 Solリリース記念リセット（4回目）",
    en: "GPT-5.6 Sol launch celebration reset (fourth)",
    zh: "GPT-5.6 Sol 发布庆祝重置（第4次）",
  },
  "GPT-5.6 Solの追加調査・改善に伴い、ChatGPT WorkとCodex全体の利用上限が4回目に強制リセットされました。": {
    ja: "GPT-5.6 Solの追加調査・改善に伴い、ChatGPT WorkとCodex全体の利用上限が4回目に強制リセットされました。",
    en: "Usage limits for ChatGPT Work and Codex were reset for a fourth time following additional investigations and improvements to GPT-5.6 Sol.",
    zh: "随着对 GPT-5.6 Sol 的进一步调查与改进，ChatGPT Work 和 Codex 的使用限制已第4次被强制重置。",
  },
  "GPT-5.6 Solリリース記念リセット（3回目）": {
    ja: "GPT-5.6 Solリリース記念リセット（3回目）",
    en: "GPT-5.6 Sol launch celebration reset (third)",
    zh: "GPT-5.6 Sol 发布庆祝重置（第3次）",
  },
  "GPT-5.6 Solのリリース記念として、ChatGPT WorkとCodex全体の利用上限が3回目に強制リセットされました。": {
    ja: "GPT-5.6 Solのリリース記念として、ChatGPT WorkとCodex全体の利用上限が3回目に強制リセットされました。",
    en: "Usage limits for ChatGPT Work and Codex were reset for a third time to celebrate the GPT-5.6 Sol launch.",
    zh: "为庆祝GPT-5.6 Sol发布，ChatGPT Work 和 Codex 的使用限制已第3次被强制重置。",
  },
  "15時間": {
    ja: "15時間",
    en: "15 hours",
    zh: "15小时",
  },
  "GPT-5.6 Solリリース記念リセット（2回目）": {
    ja: "GPT-5.6 Solリリース記念リセット（2回目）",
    en: "GPT-5.6 Sol launch celebration reset (second)",
    zh: "GPT-5.6 Sol 发布庆祝重置（第2次）",
  },
  "GPT-5.6 Solのリリース記念として、ChatGPT WorkとCodex全体の利用上限が2回目に強制リセットされました。": {
    ja: "GPT-5.6 Solのリリース記念として、ChatGPT WorkとCodex全体の利用上限が2回目に強制リセットされました。",
    en: "Usage limits for ChatGPT Work and Codex were reset for a second time to celebrate the GPT-5.6 Sol launch.",
    zh: "为庆祝GPT-5.6 Sol发布，ChatGPT Work 和 Codex 的使用限制已第2次被强制重置。",
  },
  "12時間56分": {
    ja: "12時間56分",
    en: "12 hours 56 minutes",
    zh: "12小时56分钟",
  },
  "GPT-5.6リリース記念リセット": {
    ja: "GPT-5.6リリース記念リセット",
    en: "GPT-5.6 launch celebration reset",
    zh: "GPT-5.6 发布庆祝重置",
  },
  "GPT-5.6のリリース記念として、全有料プランのCodex利用上限が強制的にリセットされました。": {
    ja: "GPT-5.6のリリース記念として、全有料プランのCodex利用上限が強制的にリセットされました。",
    en: "Codex usage limits for all paid plans were reset to celebrate the GPT-5.6 launch.",
    zh: "为庆祝GPT-5.6发布，所有付费套餐的Codex使用限制已被强制重置。",
  },
  "約3時間": {
    ja: "約3時間",
    en: "About 3 hours",
    zh: "约3小时",
  },
  "任意リセット1回分": {
    ja: "任意リセット1回分",
    en: "1 manual reset credit",
    zh: "手动重置 1 次",
  },
  "1回分・期限1か月以内": {
    ja: "1回分・期限1か月以内",
    en: "1 credit; expires within 1 month",
    zh: "1 次额度・1 个月内有效",
  },
  "対象アカウント": {
    ja: "対象アカウント",
    en: "Eligible accounts",
    zh: "目标账号",
  },
  "モデル能力退化および過剰な制限消費不具合に対する補償として、任意リセット1回分が配布されました。": {
    ja: "モデル能力退化および過剰な制限消費不具合に対する補償として、任意リセット1回分が配布されました。",
    en: "One manual reset credit was distributed as compensation for model degradation and excessive limit consumption issues.",
    zh: "因模型能力退化及额度过度消耗问题，已发放 1 次手动重置机会作为补偿。",
  },
  "Codexの信頼性に影響する不具合の補償として、任意リセット1回分が配布されました。": {
    ja: "Codexの信頼性に影響する不具合の補償として、任意リセット1回分が配布されました。",
    en: "One manual reset credit was distributed as compensation for issues affecting Codex reliability.",
    zh: "因影响 Codex 可靠性的故障，已发放 1 次手动重置机会作为补偿。",
  },
  "招待特典または個人の利用制限の更新として、任意リセットが配布されました。": {
    ja: "招待特典または個人の利用制限の更新として、任意リセットが配布されました。",
    en: "A manual reset credit was distributed as referral rewards or individual quota refresh.",
    zh: "已发放手动重置机会作为推荐奖励或个人额度更新。",
  },
  "能力退化・過剰消費補償任意リセット": {
    ja: "能力退化・過剰消費補償任意リセット",
    en: "Model Degradation & Excessive Consumption Compensation Reset",
    zh: "模型退化及额度过度消耗补偿手动重置",
  },
  "モデルの能力退化および過剰な利用制限消費不具合に対する補償として、全有料プランに任意リセット（マニュアルリセット）1回分が配布されました。": {
    ja: "モデルの能力退化および過剰な利用制限消費不具合に対する補償として、全有料プランに任意リセット（マニュアルリセット）1回分が配布されました。",
    en: "One manual reset credit was distributed to all paid plans as compensation for model degradation and excessive usage consumption issues.",
    zh: "因模型能力退化及额度过度消耗问题，已对所有付费套餐发放 1 次手动重置机会作为补偿。",
  },
  "Codex信頼性障害補償任意リセット": {
    ja: "Codex信頼性障害補償任意リセット",
    en: "Codex Reliability Incident Compensation Reset",
    zh: "Codex 可靠性故障补偿手动重置",
  },
  "Codexの信頼性に影響する不具合の補償として、全アカウントに対して任意リセット（マニュアルリセット）1回分が配布されました。": {
    ja: "Codexの信頼性に影響する不具合の補償として、全アカウントに対して任意リセット（マニュアルリセット）1回分が配布されました。",
    en: "One manual reset credit was distributed to all accounts as compensation for issues affecting Codex reliability.",
    zh: "因影响 Codex 可靠性的故障，已对所有账号发放 1 次手动重置机会作为补偿。",
  },
  "過剰消費バグ調査・強制補償リセット": {
    ja: "過剰消費バグ調査・強制補償リセット",
    en: "Forced Compensation Reset (Excessive Consumption Investigation)",
    zh: "过度消耗漏洞调查强制补偿重置",
  },
  "一部のユーザーでCodexの使用制限が過剰に消費される不具合が発生したため、その調査に伴い全ユーザーの利用制限が強制的にリセット（クリア）されました。": {
    ja: "一部のユーザーでCodexの使用制限が過剰に消費される不具合が発生したため、その調査に伴い全ユーザーの利用制限が強制的にリセット（クリア）されました。",
    en: "Due to an issue causing excessive usage limit consumption for some users, everyone's Codex limits were forcibly reset (cleared) during the investigation.",
    zh: "因部分用户出现 Codex 使用额度过度消耗的问题，在调查期间已强制重置（清空）所有用户的限制额度。",
  },
  "Tibo氏が、Codexの過剰な利用制限消費問題の調査に伴い、全員の利用制限を強制リセットしたと発表しました。": {
    ja: "Tibo氏が、Codexの過剰な利用制限消費問題の調査に伴い、全員の利用制限を強制リセットしたと発表しました。",
    en: "Tibo announced that they forcibly reset everyone's Codex limits as they investigate an issue causing excessive usage consumption.",
    zh: "Tibo 宣布由于正在调查导致使用量过度消耗的问题，已强制重置所有人的 Codex 额度限制。",
  },
  "Tibo氏が、過剰消費問題の調査が終了した後、追加の手動リセット（任意リセット枠）を全員に配布すると発表しました。": {
    ja: "Tibo氏が、過剰消費問題の調査が終了した後、追加の手動リセット（任意リセット枠）を全員に配布すると発表しました。",
    en: "Tibo announced that more manual resets (credit tokens) will be provided to everyone after the excessive consumption investigation is complete.",
    zh: "Tibo 宣布在过度消耗问题的调查结束后，将对所有人发放额外的手动重置机会。",
  },
  "Tibo氏が、1時間以内に全員のCodex利用制限を再度フルリセットすると発表しました。": {
    ja: "Tibo氏が、1時間以内に全員のCodex利用制限を再度フルリセットすると発表しました。",
    en: "Tibo announced that everyone's Codex limits will be fully reset again within the next hour.",
    zh: "Tibo 宣布将在 1 小时内再次完全重置所有人的 Codex 额度限制。",
  },
  "Tibo氏が、今後24時間以内に全有料プランへ任意リセット枠をさらに1回分追加配布すると発表しました。": {
    ja: "Tibo氏が、今後24時間以内に全有料プランへ任意リセット枠をさらに1回分追加配布すると発表しました。",
    en: "Tibo announced that one additional manual reset credit will be distributed to all paid plans within the next 24 hours.",
    zh: "Tibo 宣布将在未来 24 小时内向所有付费套餐追加发放 1 次手动重置机会。",
  },
  "OpenAI関係者がAI Engineerイベントで Codex reset button の実演を示唆し、Tibo氏も “It's happening” と反応しています。": {
    ja: "OpenAI関係者がAI Engineerイベントで Codex reset button の実演を示唆し、Tibo氏も “It's happening” と反応しています。",
    en: "An OpenAI member hinted at a Codex reset button demo at the AI Engineer event, and Tibo also reacted with “It’s happening.”",
    zh: "OpenAI成员暗示将在AI Engineer活动中演示Codex重置按钮，Tibo也对此回应称 “It's happening”。",
  },
  "Romain Huet氏 & Tibo氏の公式Xにて言及あり": {
    ja: "Romain Huet氏 & Tibo氏の公式Xにて言及あり",
    en: "Mentioned on Romain Huet's & Tibo's official X",
    zh: "Romain Huet 与 Tibo 的官方 X 提及",
  },
  "臨時リセット": {
    ja: "臨時リセット",
    en: "Temporary Reset",
    zh: "临时重置",
  },
  "Tibo氏が1時間以内の再フルリセットを告知し、利用制限の過剰消費問題への補償対応として全有料プランのCodex利用制限が強制リセットされました。": {
    ja: "Tibo氏が1時間以内の再フルリセットを告知し、利用制限の過剰消費問題への補償対応として全有料プランのCodex利用制限が強制リセットされました。",
    en: "Tibo announced that a full reset would take place within an hour. Codex limits were then reset for all users as compensation for an excessive-usage issue.",
    zh: "Tibo 宣布将在 1 小时内再次完全重置，并且所有人的 Codex 额度限制已作为过度消耗问题的补偿被强制重置。",
  },
  "任意リセット配布": {
    ja: "任意リセット配布",
    en: "Manual Reset Distributed",
    zh: "手动重置已发放",
  },
  "定期リセットが強制リセットから任意リセット権1回配布に変更されました。": {
    ja: "定期リセットが強制リセットから任意リセット権1回配布に変更されました。",
    en: "The regular reset has been changed from a forced reset to a distribution of one manual reset credit.",
    zh: "定期重置已从强制重置更改为发放 1 次手动重置机会。",
  },
  "Codex reset button 配布 (AIE World's Fair 記念)": {
    ja: "Codex reset button 配布 (AIE World's Fair 記念)",
    en: "Codex Reset Button Credit (AIE World's Fair)",
    zh: "Codex 重置按钮额度（AIE World's Fair 纪念）",
  },
  "AI Engineer World's Fair のデモにおいて Codex reset button が押され、全有料ユーザー（Codex Go/Plus/Pro）に対して任意リセット（マニュアルリセット）1回分が配布されました。": {
    ja: "AI Engineer World's Fair のデモにおいて Codex reset button が押され、全有料ユーザー（Codex Go/Plus/Pro）に対して任意リセット（マニュアルリセット）1回分が配布されました。",
    en: "During the AI Engineer World's Fair demo, the Codex reset button was pressed, granting one manual reset to all paid users (Codex Go/Plus/Pro).",
    zh: "在 AI Engineer World's Fair 的演示中，Codex 重置按钮被按下，向所有付费用户（Codex Go/Plus/Pro）发放了 1 次手动重置机会。",
  },
  "キャンペーン": {
    ja: "キャンペーン",
    en: "Campaign",
    zh: "活动",
  },
  "1時間": {
    ja: "1時間",
    en: "1 hour",
    zh: "1小时",
  },
  "告知": {
    ja: "告知",
    en: "Notice",
    zh: "通知",
  },
  "実行": {
    ja: "実行",
    en: "Executed",
    zh: "执行",
  },
  "任意リセットを使っていないアカウント": {
    ja: "任意リセットを使っていないアカウント",
    en: "Accounts that have not used a manual reset",
    zh: "未使用手动重置的账号",
  },
  "前回のリセットからこのタイミングまでに任意リセットを使用したアカウントは対象外で、使用したタイミングから1週間後にそれぞれリセットされます。": {
    ja: "前回のリセットからこのタイミングまでに任意リセットを使用したアカウントは対象外で、使用したタイミングから1週間後にそれぞれリセットされます。",
    en: "Accounts that used a manual reset after the previous weekly reset are excluded from this reset. Their next weekly reset will occur one week after the manual reset was used.",
    zh: "从上次重置到此时使用过手动重置的账号不在此次重置范围内，将在使用手动重置时间的一周后分别重置。",
  },
  "予告": {
    ja: "予告",
    en: "Notice",
    zh: "预告",
  },
  "予告内容": {
    ja: "予告内容",
    en: "Notice details",
    zh: "预告详情",
  },
};

export function translateUI(key: string, locale: Locale): string {
  return UI_TRANSLATIONS[key]?.[locale] ?? key;
}

export function translateDynamic(value: string | undefined, locale: Locale): string {
  if (!value) {
    return "";
  }

  const trimmed = value.trim().normalize("NFC");

  // DYNAMIC_TRANSLATIONS のキーもNFC正規化した辞書を作成して検索する（NFD/NFC差異対策）
  const normalizedDict: Record<string, Record<Locale, string>> = {};
  for (const [key, mapping] of Object.entries(DYNAMIC_TRANSLATIONS)) {
    normalizedDict[key.normalize("NFC")] = mapping;
  }

  const directMatch = normalizedDict[trimmed]?.[locale];
  if (directMatch) {
    return directMatch;
  }

  // 日・時間・分パターンの自動解析・翻訳（例: "35時間20分", "1日5時間", "2日" などを辞書登録なしで全自動変換）
  const durationMatch = trimmed.match(/^(?:(\d+)日)?(?:(\d+)時間)?(?:(\d+)分)?$/);
  if (
    durationMatch &&
    (durationMatch[1] !== undefined ||
      durationMatch[2] !== undefined ||
      durationMatch[3] !== undefined)
  ) {
    const days = durationMatch[1] ? parseInt(durationMatch[1], 10) : 0;
    const hours = durationMatch[2] ? parseInt(durationMatch[2], 10) : 0;
    const minutes = durationMatch[3] ? parseInt(durationMatch[3], 10) : 0;

    if (days > 0 || hours > 0 || minutes > 0) {
      if (locale === "en") {
        const parts: Array<string> = [];
        if (days > 0) parts.push(`${days} ${days === 1 ? "day" : "days"}`);
        if (hours > 0) parts.push(`${hours} ${hours === 1 ? "hour" : "hours"}`);
        if (minutes > 0) parts.push(`${minutes} ${minutes === 1 ? "minute" : "minutes"}`);
        return parts.join(" ");
      }
      if (locale === "zh") {
        const parts: Array<string> = [];
        if (days > 0) parts.push(`${days} 天`);
        if (hours > 0) parts.push(`${hours} 小时`);
        if (minutes > 0) parts.push(`${minutes} 分钟`);
        return parts.join(" ");
      }
      const parts: Array<string> = [];
      if (days > 0) parts.push(`${days}日`);
      if (hours > 0) parts.push(`${hours}時間`);
      if (minutes > 0) parts.push(`${minutes}分`);
      return parts.join("");
    }
  }

  // Fallback for partial/contains matching or dynamic strings
  let result = trimmed;
  const sortedEntries = Object.entries(normalizedDict).sort(
    (a, b) => b[0].length - a[0].length,
  );
  for (const [key, mapping] of sortedEntries) {
    if (key.length > 3 && result.includes(key)) {
      result = result.replaceAll(key, mapping[locale]);
    }
  }

  return result;
}

export function translateExpectation(value: string, locale: Locale): string {
  const dictionary: Record<string, Record<Locale, string>> = {
    低: { ja: "低", en: "Low", zh: "低" },
    中: { ja: "中", en: "Medium", zh: "中" },
    高: { ja: "高", en: "High", zh: "高" },
    超高: { ja: "極めて高", en: "Very High", zh: "极高" },
    極めて高: { ja: "極めて高", en: "Very High", zh: "极高" },
    不明: { ja: "不明", en: "Unknown", zh: "未知" },
  };

  return dictionary[value]?.[locale] ?? value;
}
