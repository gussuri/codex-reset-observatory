# Tibo teaser strength evaluation

This is an evaluation-only UI-label experiment. Production `signal_type`, prompts, rules, database rows, probability, and UI were not changed.

- Evaluation started: 2026-08-07T10:55:35.388Z
- Gemini model: gemini-3.5-flash-lite
- Dataset: 35 posts (18 Supabase actual posts + 1 user-provided example + 16 synthetic examples)
- Requested runs: 3
- Completed runs: 3
- API requests: 105
- Successful responses: 105
- Rate-limited responses: 0

## Gold distribution

- strong: 5
- weak: 10
- none: 20


## Metrics by run (actual + synthetic)

| run | accuracy | valid response rate | strong P/R | weak P/R | none P/R |
|---:|---:|---:|---:|---:|---:|
| 1 | 100.0% | 100.0% | 100.0% / 100.0% | 100.0% / 100.0% | 100.0% / 100.0% |
| 2 | 100.0% | 100.0% | 100.0% / 100.0% | 100.0% / 100.0% | 100.0% / 100.0% |
| 3 | 100.0% | 100.0% | 100.0% / 100.0% | 100.0% / 100.0% | 100.0% / 100.0% |
| all | 100.0% | 100.0% | 100.0% / 100.0% | 100.0% / 100.0% | 100.0% / 100.0% |

## Metrics by run (actual posts only)

| run | accuracy | valid response rate | strong P/R | weak P/R | none P/R |
|---:|---:|---:|---:|---:|---:|
| 1 | 100.0% | 100.0% | 100.0% / 100.0% | 100.0% / 100.0% | 100.0% / 100.0% |
| 2 | 100.0% | 100.0% | 100.0% / 100.0% | 100.0% / 100.0% | 100.0% / 100.0% |
| 3 | 100.0% | 100.0% | 100.0% / 100.0% | 100.0% / 100.0% | 100.0% / 100.0% |
| all | 100.0% | 100.0% | 100.0% / 100.0% | 100.0% / 100.0% | 100.0% / 100.0% |

## Metrics by run (synthetic only)

| run | accuracy | valid response rate | strong P/R | weak P/R | none P/R |
|---:|---:|---:|---:|---:|---:|
| 1 | 100.0% | 100.0% | 100.0% / 100.0% | 100.0% / 100.0% | 100.0% / 100.0% |
| 2 | 100.0% | 100.0% | 100.0% / 100.0% | 100.0% / 100.0% | 100.0% / 100.0% |
| 3 | 100.0% | 100.0% | 100.0% / 100.0% | 100.0% / 100.0% | 100.0% / 100.0% |
| all | 100.0% | 100.0% | 100.0% / 100.0% | 100.0% / 100.0% | 100.0% / 100.0% |

## Evidence quote validation (actual + synthetic)

| run | classified | evidence valid | invalid_evidence | unknown | valid rate |
|---:|---:|---:|---:|---:|---:|
| 1 | 35 | 35 | 0 | 0 | 100.0% |
| 2 | 35 | 35 | 0 | 0 | 100.0% |
| 3 | 35 | 35 | 0 | 0 | 100.0% |
| all | 105 | 105 | 0 | 0 | 100.0% |
- Expected strong evidence valid: 15/15 (100.0%); invalid_evidence=0.
- Expected weak evidence valid: 30/30 (100.0%); invalid_evidence=0.
- Expected none evidence valid: 60/60 (100.0%); invalid_evidence=0.

## Evidence quote validation (actual posts only)

| run | classified | evidence valid | invalid_evidence | unknown | valid rate |
|---:|---:|---:|---:|---:|---:|
| 1 | 19 | 19 | 0 | 0 | 100.0% |
| 2 | 19 | 19 | 0 | 0 | 100.0% |
| 3 | 19 | 19 | 0 | 0 | 100.0% |
| all | 57 | 57 | 0 | 0 | 100.0% |
- Expected strong evidence valid: 3/3 (100.0%); invalid_evidence=0.
- Expected weak evidence valid: 3/3 (100.0%); invalid_evidence=0.
- Expected none evidence valid: 51/51 (100.0%); invalid_evidence=0.

## Evidence quote validation (synthetic only)

| run | classified | evidence valid | invalid_evidence | unknown | valid rate |
|---:|---:|---:|---:|---:|---:|
| 1 | 16 | 16 | 0 | 0 | 100.0% |
| 2 | 16 | 16 | 0 | 0 | 100.0% |
| 3 | 16 | 16 | 0 | 0 | 100.0% |
| all | 48 | 48 | 0 | 0 | 100.0% |
- Expected strong evidence valid: 12/12 (100.0%); invalid_evidence=0.
- Expected weak evidence valid: 27/27 (100.0%); invalid_evidence=0.
- Expected none evidence valid: 9/9 (100.0%); invalid_evidence=0.

## Stability

- Complete valid cases: 35 / 35
- All-run unanimous cases: 35 / 35 (100.0%)
- Pairwise agreement: 105 / 105 (100.0%)
- Actual-only unanimous cases: 19 / 19 (100.0%)
- Synthetic-only unanimous cases: 16 / 16 (100.0%)

## Per-post results

| tweet | source | text excerpt | expected | run 1 | run 2 | run 3 | reason (run 1) |
|---|---|---|---|---|---|---|---|
| 2085221386713198988 | supabase | I asked Codex to pull up some stats and I receive on average one DM or email every 6 or so minutes to ask for a reset. I occasionally do oblige if it comes with really solid feedba | weak | weak (0.90) | weak (0.90) | weak (0.90) | 著者が条件付きでリセットを行う現在の意志を第一人称で明確に述べているため。 |
| 2081899343091843463 | supabase | We’re celebrating the fast adoption of chatGPT Work and all the incredible effort that went into it today. I’m feeling like a limit reset. Hold on tight to your ultra and /fast and | strong | strong (0.95) | strong (0.95) | strong (0.95) | 数時間後にラップトップに戻るという明確な今後の行動予告と、リセットの意向を示しているため。 |
| 2083053369351090254 | supabase | The day we develop really good models. There will be signs. Reliability increasing despite load going up and up. Sudden efficiency gains. Things getting faster. Resets. These kinds | none | none (1.00) | none (1.00) | none (1.00) | 今後のトボ自身によるリセットの予告や条件付きの意思表示ではなく、AIモデル発達の一般的な兆候について述べているため。 |
| 2083556636455752050 | supabase | The week was for efficiency. The weekend is for 10 major breakthroughs in science. There will be signs. | none | none (1.00) | none (1.00) | none (1.00) | 今後のリセットに関する具体的な示唆や自身の決定への言及はなく、抽象的な表現に留まっているため。 |
| 2082326593532473523 | supabase | One day we created the reset button and the rest is history. | none | none (1.00) | none (1.00) | none (1.00) | リSETボタンを作った過去の事実についての言及であり、今後のリセットを示唆するものではないため。 |
| 2083378916203343920 | supabase | And yet, I don't see a reset button there. | none | none (1.00) | none (1.00) | none (1.00) | リセットボタンのUIや機能への言及であり、今後のリセットを暗示するものではないため。 |
| 2081940052154933696 | supabase | Back at the laptop. The usage limits have been reset for all paid users of Codex and ChatGPT Work. Weeeeeeeee. It's a good day! | none | none (1.00) | none (1.00) | none (1.00) | すでにリセットが完了した事象についての報告であり、将来のリセットを暗示するものではないため。 |
| 2082317452755751098 | supabase | Hello people of Sol! I've reset usage limits for all ChatGPT Work and Codex users. Together with that, a quick update on GPT-5.6 Sol usage limits. Over the past few weeks, many of  | none | none (1.00) | none (1.00) | none (1.00) | すでに実行されたリセットの報告であるため、将来のリセットのヒントには該当しません。 |
| 2083395449814229287 | supabase | To celebrate a week of efficiency and let you run 100'000 Luna threads this weekend... that's right... wait for it... I have reset usage limits for Codex and ChatGPT Work. Enjoy. | none | none (1.00) | none (1.00) | none (1.00) | すでにリセットが完了したことを報告しているため、未来のリセットを示唆するものではありません。 |
| 2085597685948813610 | supabase | You can just ask Codex with GPT-5.6 Sol the wildest things and it will just do it. I talk to it for 5 minutes straight with things that just seem to require weeks of work, get up t | none | none (1.00) | none (1.00) | none (1.00) | AIの能力について語っているだけで、リセットに関する言及やヒントは一切含まれていないため。 |
| 2085610231707623750 | supabase | Free users of ChatGPT now have unlimited text chats, powered by GPT-5.6 Luna | none | none (1.00) | none (1.00) | none (1.00) | ChatGPTの無料ユーザー向けの新機能に関する一般的な告知であり、リセットに関する言及はありません。 |
| 2085432978856083964 | supabase | Agent Plugins. A standard for (most) of your agents out there, including Codex and ChatGPT. | none | none (1.00) | none (1.00) | none (1.00) | リセットに関する言及はなく、エージェントプラグインについての一般的な紹介であるため。 |
| 2085246081609171296 | supabase | Cool analysis | none | none (1.00) | none (1.00) | none (1.00) | リセットに関する言及が一切含まれていないため。 |
| 2084196918071357707 | supabase | Crazy thing about OpenAI is you just open your laptop, codex a PR into existence and ship an improvement to 1B users. Just like that. | none | none (1.00) | none (1.00) | none (1.00) | リセットに関する言及がなく、OpenAIや製品に関する一般的な感想であるため。 |
| 2083699879650463756 | supabase | Fun fact, users use /fast less during the weekend. The weekend is for relaxation, even for the model. | none | none (1.00) | none (1.00) | none (1.00) | 週末の利用動向に関する一般的な事実述べるのみであり、リセットの予告や示唆は含まれていないため。 |
| 2082655731204096275 | supabase | This week is all about intelligence too cheap to meter. Tomorrow we ship again. | none | none (0.95) | none (1.00) | none (1.00) | 明日のアップデートや機能追加への言及はあるものの、リセットに関する言及や示唆は含まれていないため。 |
| 2082637967852806207 | supabase | Terrific work by @ilanbigio and @sandersted on the investigation and post. Seems like it was a lot of fun. Take care of your harnesses out there, your model will thank you. | none | none (1.00) | none (1.00) | none (1.00) | リセットに関する言及や予告が含まれていないため。 |
| 2082241164850364555 | supabase | More opensource goodness. We have just released a CLI and TypeScript SDK for finding, validating, and fixing security vulnerabilities in your code. Scan repositories, review change | none | none (1.00) | none (1.00) | none (1.00) | オープンソースのツールやSDKのリリースに関する内容であり、リセットに関する言及が一切含まれていないため。 |
| user-provided-no-reset-tonight | user_provided | No reset tonight. | none | none (1.00) | none (1.00) | none (1.00) | 今夜はリセットしないと明確に否定しているため、将来のリセットの示唆には該当しません。 |
| synthetic-strong-01 | synthetic | I might reset everyone's limits in a few hours. Stay tuned. | strong | strong (0.95) | strong (0.95) | strong (0.95) | 数時間後に制限をリセットする可能性があると明確に示唆しており、近い将来の実行予定や待機を促す内容が含まれているため。 |
| synthetic-strong-02 | synthetic | Hold tight, I'll reset Codex tonight when I'm back at my laptop. | strong | strong (0.95) | strong (1.00) | strong (1.00) | 今夜ノートPCに戻った際にCodexをリセットすると明言しており、近いうちにリセットが行われる強い示唆が含まれているため。 |
| synthetic-strong-03 | synthetic | Thinking about pushing the reset button this evening. I'll let you know. | strong | strong (0.95) | strong (0.95) | strong (0.95) | 今夜リセットボタンを押すことを考えており、近い将来のリセットを示唆する明確な言及があるため。 |
| synthetic-strong-04 | synthetic | I'll reset all paid users tomorrow morning. | strong | strong (1.00) | strong (1.00) | strong (1.00) | 翌朝に全有料ユーザーのリセットを行うという明確かつ近未来の意図が示されているため。 |
| synthetic-weak-01 | synthetic | I sometimes reset limits when people send really good feedback. | weak | weak (0.90) | weak (0.90) | weak (0.90) | 著者が現在の意思や条件付きの許容としてリセットを行う可能性について言及しているため。 |
| synthetic-weak-02 | synthetic | If the feedback keeps coming, I may reset a few accounts. | weak | weak (0.90) | weak (0.90) | weak (0.90) | 著者が現在の自分の意志や条件付きの意図としてリセットの可能性に言及しているため、weakと判定します。 |
| synthetic-weak-03 | synthetic | I can occasionally reset limits for people who bring great banter. | weak | weak (0.90) | weak (0.90) | weak (0.90) | 著者が現在の意志として、条件付きでリセットを行う可能性があることを自ら述べているため。 |
| synthetic-weak-04 | synthetic | Maybe I'll press that reset button if this keeps up, but no promises. | weak | weak (0.90) | weak (0.90) | weak (0.90) | 著者が条件付きで将来リセットを実行する可能性に言及しているため弱いです。 |
| synthetic-weak-05 | synthetic | I do listen when users ask nicely; a reset is not out of the question. | weak | weak (0.90) | weak (0.90) | weak (0.90) | 著者が現在の意思として条件付きでのリセットの可能性に言及しているため。 |
| synthetic-weak-06 | synthetic | When the feedback is solid, I sometimes help by resetting limits. | weak | weak (0.90) | weak (0.95) | weak (0.90) | 作者自身の現在形の裁量や条件付きの許可を示しているため、weakに該当します。 |
| synthetic-weak-07 | synthetic | I might give the reset button a push at some point, but there is no timing yet. | weak | weak (0.90) | weak (0.85) | weak (0.85) | 作者自身の意志や裁量で将来リセットする可能性があることに言及しているが、具体的な時期や強い切迫感はないためweakとなる。 |
| synthetic-weak-08 | synthetic | Requests like these sometimes convince me to reset limits. | weak | weak (0.90) | weak (0.90) | weak (0.90) | 著者が条件次第で制限をリセットする可能性を現在形の一人称で示しているため。 |
| synthetic-weak-09 | synthetic | I have the discretion to reset limits for good feedback. | weak | weak (0.90) | weak (0.90) | weak (0.90) | 著者が良好なフィードバックに対して制限をリセットする裁量を持っていると1人称で述べているため。 |
| synthetic-none-01 | synthetic | One day we created the reset button and the rest is history. | none | none (1.00) | none (1.00) | none (1.00) | 過去の出来事についての回想であり、今後のリセットを示唆する内容ではないため。 |
| synthetic-none-02 | synthetic | The reset button is just a UI control; I don't see it there. | none | none (1.00) | none (1.00) | none (1.00) | リセットボタンのUI機能についての言及であり、将来のリセットを示唆するものではないため。 |
| synthetic-none-03 | synthetic | We reset limits yesterday, and the incident is over. | none | none (1.00) | none (1.00) | none (1.00) | 昨時点でリセットが完了しているため、将来のリセットを示唆する内容ではありません。 |

## Misclassified or unstable posts

No misclassified or unstable posts in the completed runs.

## Design assessment

- The DM/email post (2085221386713198988) expected weak: weak, weak, weak.
- The revised weak definition explicitly includes present-tense discretion or willingness to grant a reset under conditions, without requiring a date.
- Synthetic examples are useful for prompt diagnosis but must not be treated as production performance evidence.
- Weak false positives should be reviewed before exposing a UI label. A single reset keyword, historical statement, UI button mention, or completed reset is not sufficient evidence.
- No production adoption decision is made by this script.

## Safety

The script performs a read-only Supabase query for the selected posts and calls Gemini directly. It does not update `tibo_signals`, production classification, webhooks, probability, or UI.
