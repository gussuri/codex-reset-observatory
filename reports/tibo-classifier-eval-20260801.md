# Tibo classifier evaluation

- Input: `C:\Users\Yura\Downloads\tibo_signals_rows.csv`
- Unique input rows: 23
- Primary rows: 22 (ambiguous tweet 2083053369351090254 excluded)
- Provisional-all rows: 23
- Gemini models evaluated: gemini-2.0-flash, gemini-flash-latest, gemini-2.0-flash-lite, gemini-1.5-flash-latest
- Model with valid classifications: gemini-flash-latest
- API input mode: one CSV row per request; tweet text is never batched with another post.
- API key: configured (value omitted)
- API success: 17 / 23
- First-attempt success: 17 / 23
- Final dataset rows: success=17, unavailable=6
- The per-row metrics below use the latest saved result for each tweet; earlier model attempts are summarized separately.

## Executive summary

- `gemini-flash-latest` returned valid classifications for 17 of 23 posts (73.9% availability).
- All 17 valid Gemini classifications matched the provisional Gold label: valid-response accuracy 100% (17/17).
- Gemini detected all three `reset_executed` Gold examples correctly.
- The only `teaser` Gold example did not receive a valid Gemini response, so Gemini teaser performance remains untested.
- The dataset has no `official_notice` Gold example, so official notice performance remains untested.
- Counting unavailable API responses as incorrect, Gemini end-to-end accuracy is 73.9% on all 23 rows and 72.7% on the 22-row primary set.
- Gemini + rule fallback reaches 95.7% provisional-all accuracy and 95.5% primary accuracy.
- The rule classifier's primary mistake is tweet `2081899343091843463` (Gold=`teaser`, rule=`irrelevant`). The ambiguous tweet `2083053369351090254` is also misclassified by the rule as `teaser`, but is excluded from the primary set.

## Model attempt history

| Model | Posts targeted | Valid classifications | Result |
|---|---:|---:|---|
| `gemini-2.0-flash` | Initial candidate-order probe | 0 | No valid classification; evaluation moved to the next candidate. |
| `gemini-flash-latest` | All 23 posts | 17 | 17 valid classifications, all correct; 6 returned `rate_limited`. |
| `gemini-flash-latest` retry | Remaining 6 posts | 0 | All 6 again returned `rate_limited`. |
| `gemini-2.0-flash-lite` | Remaining 6 posts | 0 | All 6 returned `rate_limited`. |
| `gemini-1.5-flash-latest` | Remaining 6 posts | 0 | All 6 returned `api_error`. The current client does not expose the underlying HTTP status. |
| `gemini-pro-latest` | Not tested | - | Next candidate in the existing list. |

## Gold labels

- irrelevant: 19
- reset_executed: 3
- teaser: 1

`official_notice` has zero gold examples, so its class-level metrics are undefined in a statistical sense and are shown as 0 for the fixed four-class macro average. Macro metrics average all four fixed classes, including that zero-support class.

## Primary 22-row comparison

| classifier | accuracy | macro precision | macro recall | macro F1 | valid / total |
|---|---:|---:|---:|---:|---:|
| rule | 95.5% | 48.7% | 50.0% | 49.3% | 22 / 22 |
| Gemini | 72.7% | 50.0% | 43.1% | 46.0% | 16 / 22 |
| Gemini + rule fallback | 95.5% | 48.7% | 50.0% | 49.3% | 22 / 22 |

### Binary metrics

| classifier | precision | recall | F1 | false positive | false negative | invalid |
|---|---:|---:|---:|---:|---:|---:|
| rule / reset-related | 100.0% | 75.0% | 85.7% | 0 | 1 | 0 |
| Gemini / reset-related | 100.0% | 75.0% | 85.7% | 0 | 1 | 6 |
| fallback / reset-related | 100.0% | 75.0% | 85.7% | 0 | 1 | 0 |
| rule / reset-executed | 100.0% | 100.0% | 100.0% | 0 | 0 | 0 |
| Gemini / reset-executed | 100.0% | 100.0% | 100.0% | 0 | 0 | 6 |
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
| reset_executed | 3 | 100.0% | 100.0% | 100.0% |
| official_notice | 0 | 0.0% | 0.0% | 0.0% |
| teaser | 1 | 0.0% | 0.0% | 0.0% |
| irrelevant | 18 | 100.0% | 72.2% | 83.9% |

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
| reset_executed | 3 | 0 | 0 | 0 | 0 |
| official_notice | 0 | 0 | 0 | 0 | 0 |
| teaser | 0 | 0 | 0 | 0 | 1 |
| irrelevant | 0 | 0 | 0 | 13 | 5 |

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
| Gemini | 73.9% | 50.0% | 43.4% | 46.2% | 17 / 23 |
| Gemini + rule fallback | 95.7% | 48.8% | 50.0% | 49.4% | 23 / 23 |

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
| reset_executed | 3 | 0 | 0 | 0 | 0 |
| official_notice | 0 | 0 | 0 | 0 | 0 |
| teaser | 0 | 0 | 0 | 0 | 1 |
| irrelevant | 0 | 0 | 0 | 14 | 5 |

#### Fallback confusion matrix

| gold \ predicted | reset_executed | official_notice | teaser | irrelevant | no valid prediction |
|---|---:|---:|---:|---:|---:|
| reset_executed | 3 | 0 | 0 | 0 | 0 |
| official_notice | 0 | 0 | 0 | 0 | 0 |
| teaser | 0 | 0 | 0 | 1 | 0 |
| irrelevant | 0 | 0 | 0 | 19 | 0 |

## API operations

- Valid response rate: 73.9%
- Average latency: 4108 ms
- p50 latency: 4053 ms
- p95 latency: 4775 ms
- Token usage: unavailable because the current production Gemini classifier does not expose usageMetadata.

## Gemini classification results

- 2083048892405604681: Gemini=irrelevant, confidence=1, gold=irrelevant, correct=true, model=gemini-flash-latest
- 2082883808194707792: Gemini=irrelevant, confidence=0.98, gold=irrelevant, correct=true, model=gemini-flash-latest
- 2082883636177916306: Gemini=irrelevant, confidence=1, gold=irrelevant, correct=true, model=gemini-flash-latest
- 2083395449814229287: Gemini=reset_executed, confidence=1, gold=reset_executed, correct=true, model=gemini-flash-latest
- 2082326593532473523: Gemini=irrelevant, confidence=1, gold=irrelevant, correct=true, model=gemini-flash-latest
- 2082317452755751098: Gemini=reset_executed, confidence=1, gold=reset_executed, correct=true, model=gemini-flash-latest
- 2081839118531834176: Gemini=irrelevant, confidence=1, gold=irrelevant, correct=true, model=gemini-flash-latest
- 2081979033261412537: Gemini=irrelevant, confidence=1, gold=irrelevant, correct=true, model=gemini-flash-latest
- 2083053369351090254: Gemini=irrelevant, confidence=0.95, gold=irrelevant, correct=true, model=gemini-flash-latest
- 2082895472184987985: Gemini=irrelevant, confidence=0.95, gold=irrelevant, correct=true, model=gemini-flash-latest
- 2081860991210631476: Gemini=irrelevant, confidence=1, gold=irrelevant, correct=true, model=gemini-flash-latest
- 2083373529081291076: Gemini=irrelevant, confidence=1, gold=irrelevant, correct=true, model=gemini-flash-latest
- 2082655731204096275: Gemini=irrelevant, confidence=0.95, gold=irrelevant, correct=true, model=gemini-flash-latest
- 2081940052154933696: Gemini=reset_executed, confidence=1, gold=reset_executed, correct=true, model=gemini-flash-latest
- 2082578335167807775: Gemini=irrelevant, confidence=1, gold=irrelevant, correct=true, model=gemini-flash-latest
- 2082574687020966126: Gemini=irrelevant, confidence=1, gold=irrelevant, correct=true, model=gemini-flash-latest
- 2083378916203343920: Gemini=irrelevant, confidence=0.95, gold=irrelevant, correct=true, model=gemini-flash-latest

## Mistakes and disagreements

### Rule classification mistakes
- 2083053369351090254: gold=irrelevant, rule=teaser
- 2081899343091843463: gold=teaser, rule=irrelevant

### Gemini classification mistakes
- None among valid Gemini responses

### Gemini + rule fallback mistakes
- 2081899343091843463: gold=teaser, fallback=irrelevant

### Rule/Gemini disagreements
- 2083053369351090254: rule=teaser, Gemini=irrelevant, evidence=`Resets.`

### Gemini classification unavailable
- 2082981910209540352: no classification result (api_error)
- 2081899343091843463: no classification result (api_error)
- 2083387677945036995: no classification result (api_error)
- 2082637967852806207: no classification result (api_error)
- 2082609662231502932: no classification result (api_error)
- 2082241164850364555: no classification result (api_error)

## Interpretation and recommendation

- The gold set contains no `official_notice` examples, so notice performance cannot be evaluated.
- API failures are never converted to `irrelevant`; they remain explicit statuses. For overall accuracy, invalid predictions count as incorrect. The confusion matrix keeps them in a separate `no_valid_prediction` column.
- 現時点ではルール継続またはGemini Shadow継続を推奨します。reset_executedのRecall、リセット関連Recall、False Positive、API安定性を追加データで確認してから主分類器を決めます。

## Scope and safety

This evaluation reads the CSV, calls the existing rule and Gemini classification functions, and writes only the two report files. It does not call the production webhook, write Supabase, update `tibo_signals`, modify classifier prompts/rules, or change `classification_source`.

## Re-run

```text
npm run eval:tibo-classifiers -- --input "C:\Users\Yura\Downloads\tibo_signals_rows.csv"
```
