# Tibo X 投稿監視の取得可能性メモ

確認日: 2026-06-17

目的:
Tibo 氏（@thsottiaux）の X 投稿を、X 公式 API を使わずに取得できるか検証する。取得できた場合は、Codex のリセット予告や障害・容量到達・rate limit 異常投稿を `official_notice` / `official_incident_hint` の候補にする。

## 実測結果

検証スクリプト:

```powershell
node scripts\probe-tibo-x-feeds.mjs --fixtures
```

結果:

- 実投稿として使える「本文・投稿日時・投稿 URL」が揃った取得先は、今回のローカル検証では 0 件。
- xcancel は RSS XML を返したが、実投稿ではなく RSS reader のホワイトリスト案内のみだったため不採用。
- 複数の Nitter 系インスタンスは 403、bot check、空レスポンス、または接続失敗。
- RSSHub 公開インスタンスは 404 / 503。
- Open RSS は 503。
- X syndication endpoint は 429。
- Jina Reader 経由の X / Twitter 取得は 451。
- 分類器のサンプル確認では、リセット予告系と障害・容量到達系の分類自体は可能。

今回の時点では、無料の公開エンドポイントだけで Tibo 氏の最新投稿を安定取得する方法は見つかっていない。

## 候補ごとの評価

### RSSHub

メリット:

- RSS / Atom として扱えるため、取得後の処理が簡単。
- ルートが `/twitter/user/:id` 形式で分かりやすい。
- 自前でホストできれば、監視処理に組み込みやすい。

デメリット:

- 公開インスタンスでは今回 404 / 503 で取得できなかった。
- X / Twitter 系ルートは認証情報や cookie が必要になる可能性が高い。
- 自前ホストしても X 側の変更で壊れやすい。

### Nitter 系

メリット:

- URL 形式が `https://instance.example/username/rss` で単純。
- 動くインスタンスがあれば、本文・日時・URL を RSS として取りやすい。
- X 公式 API は不要。

デメリット:

- 公開インスタンスは 403、bot check、空レスポンスになりやすい。
- xcancel は RSS reader のホワイトリストが必要。
- インスタンスの生存確認と切り替えが必要。

### Open RSS

メリット:

- URL に `openrss.org/` を付けるだけで使える設計。
- 成功すれば RSS として扱える。

デメリット:

- 今回は 503 で取得できなかった。
- Open RSS 側でも Twitter / X 取得はブロックや制限の影響を受ける。

### その他の公開取得手段

候補:

- X syndication endpoint
- Jina Reader 経由の X / Twitter ページ取得
- TwitRSS 系の古いサービス
- X ページの直接スクレイピング

評価:

- 今回の実測では 429、451、521、Cloudflare などで失敗。
- 直接スクレイピングは壊れやすく、運用負荷も高い。
- 本番予測の主要入力にするには不安定。

## 分類方針

取得に成功した投稿は、まず以下のように候補分類する。

- `official_notice`: `limits reset`, `usage limits`, `within 24 hours`, `reset`
- `official_incident_hint`: `capacity`, `rate limit`, `high error rate`, `reached capacity`, `limit anomaly`, `errors`

ただし `reset` は広すぎるため、`no reset` / `not ... reset` / `without ... reset` のような否定文脈は除外する。

## 次のステップ案

1. まずは自動本番連携しない。
2. xcancel の RSS whitelist が可能か確認する。
3. Nitter インスタンス候補を定期的にヘルスチェックする。
4. 取得できる手段が見つかったら、保存前に手動確認できる `official_notice` / `official_incident_hint` 候補リストとして扱う。
5. 安定性が数日確認できてから、予測ロジックへの自動反映を検討する。

現時点のおすすめ:

- 短期: Tibo 氏の投稿は手動入力または半自動候補化に留める。
- 中期: xcancel の RSS whitelist か、自前 RSSHub / RSS Bridge の検証を行う。
- 本番連携: 取得成功率と遅延を数日記録してから判断する。

## 参考

- Nitter RSS 形式: https://docs.feedly.com/article/655-how-to-find-rss-for-a-nitter-account
- Open RSS の Twitter RSS 説明: https://openrss.org/blog/twitter-rss-feeds
- Open RSS の概要: https://openrss.org/
- RSSHub Twitter ルート例: https://github.com/DIYgod/RSSHub/issues/20796
- Twitter RSS 代替手段の整理: https://www.fivefilters.org/2021/twitter-rss/
