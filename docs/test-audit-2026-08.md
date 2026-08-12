# Test Audit

監査日: 2026-08-12

## Before

- Test file count: 69
- Test case count: 655
- `tests/` size: 約603,060 bytes
- Baseline: `corepack pnpm test` は 655 passed / 0 failed / 0 skipped / 0 todo

## Classification

### KEEP_CRITICAL

本番契約、セキュリティ、確率計算、データ境界、監視、拡張機能、正式履歴を守るため削除・弱体化しないファイルです。

`bearerAuth.test.ts`, `boundaryCensoredProbability.test.ts`, `calibratedShadowProbability.test.ts`, `ciWorkflow.test.ts`, `classification.test.ts`, `clientState.test.ts`, `codexUsageMonitor.test.ts`, `codexUsageRecovery.test.ts`, `codexUsageWebhookRoute.test.ts`, `dataHealth.test.ts`, `extensionAutoReload.test.ts`, `extensionNotificationSelfTest.test.ts`, `extensionQueueDeduplication.test.ts`, `formalAdoption.test.ts`, `geminiShadowClassification.test.ts`, `heartbeatApiReloadFields.test.ts`, `monitorHealth.test.ts`, `monitorWorkflow.test.ts`, `openaiStatusHealth.test.ts`, `probabilityAudit.test.ts`, `probabilityForecastPersistence.test.ts`, `probabilityIntegration.test.ts`, `probabilityModelEvaluation.test.ts`, `probabilityTuning.test.ts`, `prospectiveProbabilityEvaluation.test.ts`, `prospectivePublishedModelEvaluation.test.ts`, `prospectiveRandomClockModelEvaluation.test.ts`, `publicDelivery.test.ts`, `publishedProbability.test.ts`, `radarFetch.test.ts`, `randomElapsedProbability.test.ts`, `recencyWeightedProbability.test.ts`, `refreshPolicy.test.ts`, `regimeElapsedEvaluation.test.ts`, `regimeElapsedProbability.test.ts`, `regularResetPersistence.test.ts`, `resetExecutionTime.test.ts`, `resetTeaserStatus.test.ts`, `resetTimeHeatmap.test.ts`, `securityHardening.test.ts`, `shadowEvaluation.test.ts`, `shadowProbability.test.ts`, `statusIncidentEvaluation.test.ts`, `tiboContentScan.test.ts`, `tiboDiagnostics.test.ts`, `tiboExtensionRuntime.test.ts`, `tiboFormalHistory.test.ts`, `tiboReplyMetadata.test.ts`, `tiboTemporal.test.ts`, `tiboWebhookRoute.test.ts`, `tiboWebhookState.test.ts`

### KEEP

現在も有用な表示、翻訳、リンク、補助処理、評価パイプラインのテストです。評価用テストも `package.json` の評価scriptまたは現行の評価経路から参照されているため残します。

`developerLinks.test.ts`, `displayOutlookReason.test.ts`, `geminiTranslation.test.ts`, `i18nCompleteness.test.ts`, `locale.test.ts`, `logProbabilityRoute.test.ts`, `randomResetDisplayNames.test.ts`, `randomResetNameEvaluation.test.ts`, `randomResetNameEvaluationRound2.test.ts`, `randomResetNameEvaluationV2.test.ts`, `resetDurationPresentation.test.ts`, `tiboClassifierEvaluation.test.ts`, `tiboHandle.test.ts`, `tiboTeaserStrengthEvaluation.test.ts`, `tiboTeaserStrengthStress.test.ts`

### CONSOLIDATE

- `siteMetadata.test.ts`
  - ホームのJA/EN/ZH metadata契約を、個別の共通テスト・JA専用テスト・ZH専用テストから、完全なlocale case tableへ統合。
  - FAQ metadataもJA専用の実装から、JA/EN/ZHのtitle、description、Open Graph、Twitter契約を1つのcase tableで確認する形へ整理。

### BRITTLE_REFACTOR

- `dashboardPresentation.test.ts`
  - Tailwindのclass全文、spacing、font size、grid定義、icon container等に依存する14個のassertionを削除またはsemanticな見出しassertへ置換。
  - 表示文言、表示順、不要表示の不在、`role`、`aria-*`、数値、リンク、locale契約は維持。

### TEMPORARY

- `domainMigration.test.ts`
  - 旧Vercel domainからのredirect、API互換、拡張機能移行が残る間は必要。
  - ファイル上部に、旧host対応と拡張機能移行経路の双方を廃止した時点で削除する条件をコメントとして明記。

### ARCHIVAL_CANDIDATE

今回は確実な候補なし。過去の命名・teaser strength・prospective評価に見えるテストも、現行の `package.json` script、評価script、または保存済み評価経路から参照されているため、推測でアーカイブしませんでした。

## Changes made

1. `dashboardPresentation.test.ts` のstyle implementation detail assertionを整理しました。ユーザーに見える契約とアクセシビリティassertは残しています。
2. `siteMetadata.test.ts` のlocale重複をtable-driven化しました。タイトル、description、canonical、Open Graph、Twitter、ブランド名、24h/48h SEO表現はハードコードされた期待値で維持しています。
3. `domainMigration.test.ts` に明確なcleanup条件をコメントしました。テスト自体は削除していません。
4. production code、API、DB、確率モデル、履歴データ、監視、拡張機能runtimeは変更していません。

## Tests removed

削除したテスト宣言は2件です。どちらも重複していたホームSEO専用テストで、以下のtable-driven testへ吸収しました。

- `Japanese home title uses the observatory search title without a template suffix`
- `Chinese home title uses the localized observatory search title without a suffix`

代替coverageは `home metadata preserves exact localized SEO contracts` です。JA/EN/ZHそれぞれについて、定数、HTML metadata title、description、Open Graph title/description、Twitter title/description、URL、OG imageを確認します。意図しない削除は0件です。

## Tests consolidated

- ホームmetadata: 3 test declarations → 1 table-driven test。差分は2件の重複宣言を吸収。
- FAQ metadata: JA専用の1 test declarationを、同じtest内のJA/EN/ZH caseへ拡張。テスト宣言数は維持し、契約coverageを拡張。

## Brittle assertions removed

`dashboardPresentation.test.ts` から、ProbabilityMetricsのカードpadding・font class、Heatmap skeletonのclass、dashboardのgrid/max-width、icon container、履歴timestamp gridのclassなど14件を除去しました。代わりに、表示テキスト、semantic heading、ARIA、表示順、リンク、不要要素の不在を確認します。

## Temporary tests

`domainMigration.test.ts` は現行のlegacy host互換がproduction middlewareとChrome拡張の両方に残るため維持します。旧Vercel hostのredirect/API互換と拡張機能の移行対応を完全に廃止できた時点が削除条件です。

## Archival candidates

確定した候補はありません。random reset naming v1/round2/v2、teaser strength stress、published/random-clock prospectiveなどは、過去実験の名前を持つものでも、現行の評価scriptと検証経路を守るため残しています。

## After

- Test file count: 69
- Test case count: 653
- `tests/` size: 約603,747 bytes
- 変更後のtest runnerで skip 0 / todo 0 を確認する

## Coverage rationale

テスト件数は655から653へ2件減りますが、削除したのは同じホームmetadataを別localeで再確認していた重複宣言だけです。期待値はlocale caseへ移し、JA/EN/ZHの全metadata面とFAQの全locale契約を維持しました。

security、public DTO allowlist、probability math、fallback、eligibility、recovery boundary、regular/random区別、Supabase persistence contract、Tibo monitor、Chrome extensionの重要テストは削除・弱体化していません。UIテストではCSS実装詳細への依存だけを外し、表示順・表示内容・ARIA・private情報非表示を維持しています。
