# Tibo classifier evaluation

- Input: `C:\Users\Yura\Downloads\tibo_signals_rows.csv`
- Unique input rows: 23
- Primary rows: 22 (ambiguous tweet 2083053369351090254 excluded)
- Provisional-all rows: 23
- Gemini model: 未設定
- API key: not configured
- API success: 0 / 23
- First-attempt success: 0 / 23
- Total requests: 23
- Retry requests: 0
- Statuses: model_not_configured=23

## Gold labels

- irrelevant: 19
- reset_executed: 3
- teaser: 1

`official_notice` has zero gold examples, so its class-level metrics are undefined in a statistical sense and are shown as 0 for the fixed four-class macro average. Macro metrics average all four fixed classes, including that zero-support class.

## Primary 22-row comparison

| classifier | accuracy | macro precision | macro recall | macro F1 | valid / total |
|---|---:|---:|---:|---:|---:|
| rule | 95.5% | 48.7% | 50.0% | 49.3% | 22 / 22 |
| Gemini | 0.0% | 0.0% | 0.0% | 0.0% | 0 / 22 |
| Gemini + rule fallback | 95.5% | 48.7% | 50.0% | 49.3% | 22 / 22 |

### Binary metrics

| classifier | precision | recall | F1 | false positive | false negative | invalid |
|---|---:|---:|---:|---:|---:|---:|
| rule / reset-related | 100.0% | 75.0% | 85.7% | 0 | 1 | 0 |
| Gemini / reset-related | 0.0% | 0.0% | 0.0% | 0 | 4 | 22 |
| fallback / reset-related | 100.0% | 75.0% | 85.7% | 0 | 1 | 0 |
| rule / reset-executed | 100.0% | 100.0% | 100.0% | 0 | 0 | 0 |
| Gemini / reset-executed | 0.0% | 0.0% | 0.0% | 0 | 3 | 22 |
| fallback / reset-executed | 100.0% | 100.0% | 100.0% | 0 | 0 | 0 |

#### Rule

| class | support | precision | recall | F1 |
|---|---:|---:|---:|---:|
| reset_executed | 3 | 100.0% | 100.0% | 100.0% |
| official_notice | 0 | 0.0% | 0.0% | 0.0% |
| teaser | 1 | 0.0% | 0.0% | 0.0% |
| irrelevant | 18 | 94.7% | 100.0% | 97.3% |

#### Gemini

| class | support | precision | recall | F1 |
|---|---:|---:|---:|---:|
| reset_executed | 3 | 0.0% | 0.0% | 0.0% |
| official_notice | 0 | 0.0% | 0.0% | 0.0% |
| teaser | 1 | 0.0% | 0.0% | 0.0% |
| irrelevant | 18 | 0.0% | 0.0% | 0.0% |

#### Gemini + rule fallback

| class | support | precision | recall | F1 |
|---|---:|---:|---:|---:|
| reset_executed | 3 | 100.0% | 100.0% | 100.0% |
| official_notice | 0 | 0.0% | 0.0% | 0.0% |
| teaser | 1 | 0.0% | 0.0% | 0.0% |
| irrelevant | 18 | 94.7% | 100.0% | 97.3% |

#### Rule confusion matrix

| gold \ predicted | reset_executed | official_notice | teaser | irrelevant | no valid prediction |
|---|---:|---:|---:|---:|---:|
| reset_executed | 3 | 0 | 0 | 0 | 0 |
| official_notice | 0 | 0 | 0 | 0 | 0 |
| teaser | 0 | 0 | 0 | 1 | 0 |
| irrelevant | 0 | 0 | 0 | 18 | 0 |

#### Gemini confusion matrix

| gold \ predicted | reset_executed | official_notice | teaser | irrelevant | no valid prediction |
|---|---:|---:|---:|---:|---:|
| reset_executed | 0 | 0 | 0 | 0 | 3 |
| official_notice | 0 | 0 | 0 | 0 | 0 |
| teaser | 0 | 0 | 0 | 0 | 1 |
| irrelevant | 0 | 0 | 0 | 0 | 18 |

#### Fallback confusion matrix

| gold \ predicted | reset_executed | official_notice | teaser | irrelevant | no valid prediction |
|---|---:|---:|---:|---:|---:|
| reset_executed | 3 | 0 | 0 | 0 | 0 |
| official_notice | 0 | 0 | 0 | 0 | 0 |
| teaser | 0 | 0 | 0 | 1 | 0 |
| irrelevant | 0 | 0 | 0 | 18 | 0 |

## Provisional-all 23-row comparison

| classifier | accuracy | macro precision | macro recall | macro F1 | valid / total |
|---|---:|---:|---:|---:|---:|
| rule | 91.3% | 48.7% | 48.7% | 48.7% | 23 / 23 |
| Gemini | 0.0% | 0.0% | 0.0% | 0.0% | 0 / 23 |
| Gemini + rule fallback | 91.3% | 48.7% | 48.7% | 48.7% | 23 / 23 |

#### Rule confusion matrix

| gold \ predicted | reset_executed | official_notice | teaser | irrelevant | no valid prediction |
|---|---:|---:|---:|---:|---:|
| reset_executed | 3 | 0 | 0 | 0 | 0 |
| official_notice | 0 | 0 | 0 | 0 | 0 |
| teaser | 0 | 0 | 0 | 1 | 0 |
| irrelevant | 0 | 0 | 1 | 18 | 0 |

#### Gemini confusion matrix

| gold \ predicted | reset_executed | official_notice | teaser | irrelevant | no valid prediction |
|---|---:|---:|---:|---:|---:|
| reset_executed | 0 | 0 | 0 | 0 | 3 |
| official_notice | 0 | 0 | 0 | 0 | 0 |
| teaser | 0 | 0 | 0 | 0 | 1 |
| irrelevant | 0 | 0 | 0 | 0 | 19 |

#### Fallback confusion matrix

| gold \ predicted | reset_executed | official_notice | teaser | irrelevant | no valid prediction |
|---|---:|---:|---:|---:|---:|
| reset_executed | 3 | 0 | 0 | 0 | 0 |
| official_notice | 0 | 0 | 0 | 0 | 0 |
| teaser | 0 | 0 | 0 | 1 | 0 |
| irrelevant | 0 | 0 | 1 | 18 | 0 |

## API operations

- Valid response rate: 0.0%
- Average latency: n/a
- p50 latency: n/a
- p95 latency: n/a
- Token usage: unavailable because the current production Gemini classifier does not expose usageMetadata.

## Mistakes and disagreements

### All classifier mistakes
- 2083053369351090254: gold=irrelevant, rule=teaser, gemini=(model_not_configured), fallback=teaser
- 2081899343091843463: gold=teaser, rule=irrelevant, gemini=(model_not_configured), fallback=irrelevant

### Rule/Gemini disagreements
- None

### Gemini API failures
- 2083048892405604681: model_not_configured, attempts=1
- 2082883808194707792: model_not_configured, attempts=1
- 2082883636177916306: model_not_configured, attempts=1
- 2083395449814229287: model_not_configured, attempts=1
- 2082326593532473523: model_not_configured, attempts=1
- 2082317452755751098: model_not_configured, attempts=1
- 2081839118531834176: model_not_configured, attempts=1
- 2081979033261412537: model_not_configured, attempts=1
- 2083053369351090254: model_not_configured, attempts=1
- 2082895472184987985: model_not_configured, attempts=1
- 2081860991210631476: model_not_configured, attempts=1
- 2083373529081291076: model_not_configured, attempts=1
- 2082655731204096275: model_not_configured, attempts=1
- 2081940052154933696: model_not_configured, attempts=1
- 2082981910209540352: model_not_configured, attempts=1
- 2082578335167807775: model_not_configured, attempts=1
- 2081899343091843463: model_not_configured, attempts=1
- 2083387677945036995: model_not_configured, attempts=1
- 2082574687020966126: model_not_configured, attempts=1
- 2082637967852806207: model_not_configured, attempts=1
- 2082609662231502932: model_not_configured, attempts=1
- 2083378916203343920: model_not_configured, attempts=1
- 2082241164850364555: model_not_configured, attempts=1

## Interpretation and recommendation

- The gold set contains no `official_notice` examples, so notice performance cannot be evaluated.
- API failures are never converted to `irrelevant`; they remain explicit statuses. For overall accuracy, invalid predictions count as incorrect. The confusion matrix keeps them in a separate `no_valid_prediction` column.
- Gemini APIが有効回答を返していないため、今回の結果だけでは移行判断不能です。キーとモデルを設定して同じスクリプトを再実行し、当面はShadow運用を継続してください。

## Scope and safety

This evaluation reads the CSV, calls the existing rule and Gemini classification functions, and writes only the two report files. It does not call the production webhook, write Supabase, update `tibo_signals`, modify classifier prompts/rules, or change `classification_source`.

## Re-run

```text
npm run eval:tibo-classifiers -- --input "C:\Users\Yura\Downloads\tibo_signals_rows.csv"
```
