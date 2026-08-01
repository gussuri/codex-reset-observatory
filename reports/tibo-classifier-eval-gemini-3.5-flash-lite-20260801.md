# Tibo classifier evaluation

- Input: `C:\Users\Yura\Downloads\tibo_signals_rows.csv`
- Unique input rows: 23
- Primary rows: 22 (ambiguous tweet 2083053369351090254 excluded)
- Provisional-all rows: 23
- Gemini model configured for this run: gemini-3.5-flash-lite
- Models recorded in CSV (including historical rows): gemini-3.5-flash-lite
- API input mode: one CSV row per request; tweet text is never batched with another post.
- API key: configured (value omitted)
- API success: 23 / 23
- Current run requests: 23
- Current run successes: 23
- Current run first-attempt success: 23
- Total requests: 23
- Retry requests: 0
- Statuses: success=23

## Evaluation run separation

### Historical multi-model attempts

These attempts belong to the earlier exploratory evaluation. They are historical only and were not called during the current fixed-model evaluation.

| model | scope | result |
|---|---|---|
| gemini-2.0-flash | initial candidate-order probe | no valid classification |
| gemini-flash-latest | all 23 posts | 17 valid classifications; 6 rate_limited |
| gemini-flash-latest | remaining 6 retry | 6 rate_limited |
| gemini-2.0-flash-lite | remaining 6 retry | 6 rate_limited |
| gemini-1.5-flash-latest | remaining 6 retry | 6 api_error |

### Fixed-model evaluation

- Model: gemini-3.5-flash-lite
- Requests in this run: 23
- Successful rows preserved from the existing CSV: 0
- Result: all successful

## Gold labels

- irrelevant: 19
- reset_executed: 3
- teaser: 1

`official_notice` has zero gold examples, so its class-level metrics are undefined in a statistical sense and are shown as 0 for the fixed four-class macro average. Macro metrics average all four fixed classes, including that zero-support class.

## Primary 22-row comparison

| classifier | accuracy | macro precision | macro recall | macro F1 | valid / total |
|---|---:|---:|---:|---:|---:|
| rule | 95.5% | 48.7% | 50.0% | 49.3% | 22 / 22 |
| Gemini | 100.0% | 75.0% | 75.0% | 75.0% | 22 / 22 |
| Gemini + rule fallback | 100.0% | 75.0% | 75.0% | 75.0% | 22 / 22 |

### Binary metrics

| classifier | precision | recall | F1 | false positive | false negative | invalid |
|---|---:|---:|---:|---:|---:|---:|
| rule / reset-related | 100.0% | 75.0% | 85.7% | 0 | 1 | 0 |
| Gemini / reset-related | 100.0% | 100.0% | 100.0% | 0 | 0 | 0 |
| fallback / reset-related | 100.0% | 100.0% | 100.0% | 0 | 0 | 0 |
| rule / reset-executed | 100.0% | 100.0% | 100.0% | 0 | 0 | 0 |
| Gemini / reset-executed | 100.0% | 100.0% | 100.0% | 0 | 0 | 0 |
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
| teaser | 1 | 100.0% | 100.0% | 100.0% |
| irrelevant | 18 | 100.0% | 100.0% | 100.0% |

#### Gemini + rule fallback

| class | support | precision | recall | F1 |
|---|---:|---:|---:|---:|
| reset_executed | 3 | 100.0% | 100.0% | 100.0% |
| official_notice | 0 | 0.0% | 0.0% | 0.0% |
| teaser | 1 | 100.0% | 100.0% | 100.0% |
| irrelevant | 18 | 100.0% | 100.0% | 100.0% |

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
| teaser | 0 | 0 | 1 | 0 | 0 |
| irrelevant | 0 | 0 | 0 | 18 | 0 |

#### Fallback confusion matrix

| gold \ predicted | reset_executed | official_notice | teaser | irrelevant | no valid prediction |
|---|---:|---:|---:|---:|---:|
| reset_executed | 3 | 0 | 0 | 0 | 0 |
| official_notice | 0 | 0 | 0 | 0 | 0 |
| teaser | 0 | 0 | 1 | 0 | 0 |
| irrelevant | 0 | 0 | 0 | 18 | 0 |

## Provisional-all 23-row comparison

| classifier | accuracy | macro precision | macro recall | macro F1 | valid / total |
|---|---:|---:|---:|---:|---:|
| rule | 91.3% | 48.7% | 48.7% | 48.7% | 23 / 23 |
| Gemini | 100.0% | 75.0% | 75.0% | 75.0% | 23 / 23 |
| Gemini + rule fallback | 100.0% | 75.0% | 75.0% | 75.0% | 23 / 23 |

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
| teaser | 0 | 0 | 1 | 0 | 0 |
| irrelevant | 0 | 0 | 0 | 19 | 0 |

#### Fallback confusion matrix

| gold \ predicted | reset_executed | official_notice | teaser | irrelevant | no valid prediction |
|---|---:|---:|---:|---:|---:|
| reset_executed | 3 | 0 | 0 | 0 | 0 |
| official_notice | 0 | 0 | 0 | 0 | 0 |
| teaser | 0 | 0 | 1 | 0 | 0 |
| irrelevant | 0 | 0 | 0 | 19 | 0 |

## API operations

- Valid response rate: 100.0%
- Average latency: 1082 ms
- p50 latency: 1061 ms
- p95 latency: 1265 ms
- Token usage: unavailable because the current production Gemini classifier does not expose usageMetadata.

## Gemini classification results

- 2083048892405604681: Gemini=irrelevant, confidence=1, gold=irrelevant, correct=true, model=gemini-3.5-flash-lite
- 2082883808194707792: Gemini=irrelevant, confidence=0.99, gold=irrelevant, correct=true, model=gemini-3.5-flash-lite
- 2082883636177916306: Gemini=irrelevant, confidence=1, gold=irrelevant, correct=true, model=gemini-3.5-flash-lite
- 2083395449814229287: Gemini=reset_executed, confidence=1, gold=reset_executed, correct=true, model=gemini-3.5-flash-lite
- 2082326593532473523: Gemini=irrelevant, confidence=1, gold=irrelevant, correct=true, model=gemini-3.5-flash-lite
- 2082317452755751098: Gemini=reset_executed, confidence=1, gold=reset_executed, correct=true, model=gemini-3.5-flash-lite
- 2081839118531834176: Gemini=irrelevant, confidence=1, gold=irrelevant, correct=true, model=gemini-3.5-flash-lite
- 2081979033261412537: Gemini=irrelevant, confidence=1, gold=irrelevant, correct=true, model=gemini-3.5-flash-lite
- 2083053369351090254: Gemini=irrelevant, confidence=0.98, gold=irrelevant, correct=true, model=gemini-3.5-flash-lite
- 2082895472184987985: Gemini=irrelevant, confidence=1, gold=irrelevant, correct=true, model=gemini-3.5-flash-lite
- 2081860991210631476: Gemini=irrelevant, confidence=1, gold=irrelevant, correct=true, model=gemini-3.5-flash-lite
- 2083373529081291076: Gemini=irrelevant, confidence=1, gold=irrelevant, correct=true, model=gemini-3.5-flash-lite
- 2082655731204096275: Gemini=irrelevant, confidence=1, gold=irrelevant, correct=true, model=gemini-3.5-flash-lite
- 2081940052154933696: Gemini=reset_executed, confidence=1, gold=reset_executed, correct=true, model=gemini-3.5-flash-lite
- 2082981910209540352: Gemini=irrelevant, confidence=1, gold=irrelevant, correct=true, model=gemini-3.5-flash-lite
- 2082578335167807775: Gemini=irrelevant, confidence=1, gold=irrelevant, correct=true, model=gemini-3.5-flash-lite
- 2081899343091843463: Gemini=teaser, confidence=0.95, gold=teaser, correct=true, model=gemini-3.5-flash-lite
- 2083387677945036995: Gemini=irrelevant, confidence=1, gold=irrelevant, correct=true, model=gemini-3.5-flash-lite
- 2082574687020966126: Gemini=irrelevant, confidence=1, gold=irrelevant, correct=true, model=gemini-3.5-flash-lite
- 2082637967852806207: Gemini=irrelevant, confidence=1, gold=irrelevant, correct=true, model=gemini-3.5-flash-lite
- 2082609662231502932: Gemini=irrelevant, confidence=1, gold=irrelevant, correct=true, model=gemini-3.5-flash-lite
- 2083378916203343920: Gemini=irrelevant, confidence=0.95, gold=irrelevant, correct=true, model=gemini-3.5-flash-lite
- 2082241164850364555: Gemini=irrelevant, confidence=1, gold=irrelevant, correct=true, model=gemini-3.5-flash-lite

## Mistakes and disagreements

### Rule classification mistakes
- 2083053369351090254: gold=irrelevant, rule=teaser
- 2081899343091843463: gold=teaser, rule=irrelevant

### Gemini classification mistakes
- None among valid Gemini responses

### Gemini + rule fallback mistakes
- None

### Rule/Gemini disagreements
- 2083053369351090254: rule=teaser, Gemini=irrelevant, evidence=`The day we develop really good models.`
- 2081899343091843463: rule=irrelevant, Gemini=teaser, evidence=`I’m feeling like a limit reset.`

### Gemini classification unavailable
- None

## Interpretation and recommendation

- The gold set contains no `official_notice` examples, so notice performance cannot be evaluated.
- API failures are never converted to `irrelevant`; they remain explicit statuses. For overall accuracy, invalid predictions count as incorrect. The confusion matrix keeps them in a separate `no_valid_prediction` column.
- Gemini主＋ルールfallbackを候補にできます。ただし23件（曖昧除外22件）の小標本で、official_noticeの正解例もないため、直ちに全面移行せずShadow運用で追加データを集めます。

## Verification notes

- The existing test `getLocalResetProbabilityReason formats English summary without un-translated Japanese text for Tibo Teaser` also failed on clean HEAD before this evaluation.
- Clean-HEAD actual value: `The current forecast is 2% within 24 hours and 5% within 48 hours. 0 days have passed since the last reset. No active incidents are currently listed on the official status page. As no Codex incidents occurred during Thursday/Friday and no notice was issued, probability is kept low for the US weekend.`
- Expected text was `Tibo's teaser post stating 'There will be signs... Resets'`.
- No production code or test expectation was changed to make this unrelated failure pass.
- After stabilizing the test fixture, current `npm test`: 65/65 passed.
- Current `npm run lint`: passed.
- Current `npm run build`: passed.

## Scope and safety

This evaluation reads the CSV, calls the existing rule and Gemini classification functions, and writes only the two report files. It does not call the production webhook, write Supabase, update `tibo_signals`, modify classifier prompts/rules, or change `classification_source`.

## Re-run

```text
npm run eval:tibo-classifiers:fixed -- --input "C:\Users\Yura\Downloads\tibo_signals_rows.csv"
```
