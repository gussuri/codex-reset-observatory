# 次世代確率モデルのshadow運用

現在の公開モデルは `hazard-odds-v4-logit-calibrated-prequential-v3` のまま維持し、次の2モデルは公開選択へ接続しないshadowとして観測する。

- B: `hazard-regime-random-continuous-calibrated-v1`
- A: `hazard-ensemble-logit-stack-v1`
- freeze: `2026-08-21T03:27:00.000Z`
- mode: prospective only
- backfill: false
- auto publish: false（manual review only）

## 保存経路

A/Bは `/api/log-probability` のlogging cycleだけで計算し、既存の `prediction_history.debug_info.experimentalProbabilityForecasts` へ保存する。`/api/current`、公開DTO、UI、DB schemaではA/Bの学習読み出しやsolverを実行しない。

freeze以後かつ現在originより前のprediction historyを1回だけreadし、Bのraw forecast calibrationとAのensemble trainingで共有する。DB queryが失敗した場合はBのみalpha=0のuncalibrated shadowとして監査情報付きで保存し、Aは保存しない。既存のfirst-writer-winsを維持し、保存済みrowを更新しない。

## targetと評価

targetはcompleted broad-scope eligible random resetだけ。regular resetはrandom clockを戻さず、A/Bのlabelをcensorしない。origin後の24h/48h終了時刻が評価のas-of以前になった場合だけ、そのhorizonをresolvedとして使う。

正式比較は同一originにpublic・A・Bが実際に保存されたrowのうち、Asia/Tokyo各日の最初のrowを使う。Brier、log loss、calibration、availability、non-overlap、skip reasonをレポートし、Gateを満たしても自動採用しない。

```text
corepack pnpm run evaluate:prospective-next-generation
```

レポートは `reports/prospective-next-generation-model-evaluation.json` と `.md` に出力される。対象rowが不足している間は `insufficient_data` とし、精度の優劣を結論づけない。
