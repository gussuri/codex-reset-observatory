import assert from "node:assert/strict";
import test from "node:test";

import {
  listMissingTiboTranslations,
  reconcileMissingTiboTranslations,
  type MissingTiboTranslationRow,
  type TiboTranslationStoreClient,
} from "../lib/radar/tiboTranslationReconciliation";

type FakeRow = Omit<MissingTiboTranslationRow, "signalType"> & {
  signalType: MissingTiboTranslationRow["signalType"] | "irrelevant";
  classification_reason: string;
  temporal_kind: string;
};

function makeStore(initialRows: FakeRow[]) {
  const rows = initialRows.map((row) => ({ ...row }));
  const store = {
    from(table: string) {
      assert.equal(table, "tibo_signals");
      const state: {
        update?: Record<string, unknown>;
        tweetId?: string;
        selected?: boolean;
        signalTypes?: string[];
        limit?: number;
        expectedValues?: Record<string, string>;
        allowEmpty?: boolean;
      } = {};
      const query: any = {
        select() {
          state.selected = true;
          return query;
        },
        in(_column: string, values: string[]) {
          state.signalTypes = values;
          return query;
        },
        or() {
          state.allowEmpty = true;
          return query;
        },
        order() {
          return query;
        },
        limit(value: number) {
          state.limit = value;
          return query;
        },
        update(values: Record<string, unknown>) {
          state.update = values;
          return query;
        },
        eq(column: string, value: string) {
          if (column === "tweet_id") state.tweetId = value;
          else {
            state.expectedValues ??= {};
            state.expectedValues[column] = value;
          }
          return query;
        },
        then(resolve: (value: unknown) => unknown, reject: (reason: unknown) => unknown) {
          try {
            if (state.update) {
              const row = rows.find((candidate) => candidate.tweetId === state.tweetId);
              if (!row) return resolve({ data: [], error: null });
              const [column, value] = Object.entries(state.update)[0];
              const current = column === "translated_text_ja"
                ? row.translatedTextJa
                : row.translatedTextZh;
              const expected = state.expectedValues?.[column];
              const matches = expected === undefined
                ? state.allowEmpty && !current
                : current === expected;
              if (!matches) return resolve({ data: [], error: null });
              if (column === "translated_text_ja") row.translatedTextJa = String(value);
              if (column === "translated_text_zh") row.translatedTextZh = String(value);
              return resolve({ data: [{ tweet_id: row.tweetId }], error: null });
            }

            const data = rows
              .filter((row) => !state.signalTypes || state.signalTypes.includes(row.signalType))
              .slice(0, state.limit ?? rows.length)
              .map((row) => ({
                tweet_id: row.tweetId,
                signal_type: row.signalType,
                text: row.text,
                tweet_created_at: row.tweetCreatedAt,
                translated_text_ja: row.translatedTextJa,
                translated_text_zh: row.translatedTextZh,
              }));
            return resolve({ data, error: null });
          } catch (error) {
            return reject(error);
          }
        },
      };
      return query;
    },
    rows,
  } as unknown as TiboTranslationStoreClient & { rows: FakeRow[] };
  return store;
}

function row(overrides: Partial<FakeRow> = {}): FakeRow {
  return {
    tweetId: "2090000000000000001",
    signalType: "official_notice",
    text: "A reset is coming tomorrow.",
    tweetCreatedAt: "2026-09-20T00:00:00.000Z",
    translatedTextJa: null,
    translatedTextZh: null,
    classification_reason: "keep this semantic field",
    temporal_kind: "relative_day",
    ...overrides,
  };
}

function success(textJa: string, textZh: string) {
  return async () => ({
    textJa,
    textZh,
    model: "test-model",
    status: "success" as const,
    translatedAt: "2026-09-20T00:01:00.000Z",
  });
}

test("lists only relevant rows with at least one missing translation", async () => {
  const store = makeStore([
    row(),
    row({ tweetId: "2090000000000000002", signalType: "irrelevant" }),
    row({ tweetId: "2090000000000000003", translatedTextJa: "既存", translatedTextZh: "已有" }),
  ]);

  const rows = await listMissingTiboTranslations(store);
  assert.deepEqual(rows.map((item) => item.tweetId), ["2090000000000000001"]);
});

test("lists a non-null source copy as a repair candidate while keeping valid locales", async () => {
  const source = "A reset is coming tomorrow.";
  const rows = await listMissingTiboTranslations(makeStore([
    row({
      text: source,
      translatedTextJa: source,
      translatedTextZh: "明天会进行重置。",
    }),
    row({
      tweetId: "2090000000000000004",
      text: source,
      translatedTextJa: "明日、リセットが実施されます。",
      translatedTextZh: "明天会进行重置。",
    }),
  ]));

  assert.deepEqual(rows.map((item) => item.tweetId), ["2090000000000000001"]);
  assert.equal(rows[0]?.translatedTextJa, source);
  assert.equal(rows[0]?.translatedTextZh, "明天会进行重置。");
});

test("scans the bounded audit window before applying the repair limit", async () => {
  const source = "A reset is coming tomorrow.";
  const rows = await listMissingTiboTranslations(makeStore([
    row({
      text: source,
      translatedTextJa: "明日、リセットが実施されます。",
      translatedTextZh: "明天会进行重置。",
    }),
    row({
      tweetId: "2090000000000000005",
      text: source,
      translatedTextJa: source,
      translatedTextZh: source,
    }),
  ]), 1);

  assert.deepEqual(rows.map((item) => item.tweetId), ["2090000000000000005"]);
});

test("repairs both locales and preserves existing partial translations and semantic fields", async () => {
  const store = makeStore([
    row(),
    row({
      tweetId: "2090000000000000002",
      translatedTextJa: "既存の日本語",
      translatedTextZh: null,
    }),
  ]);
  let calls = 0;
  const invalidations: string[] = [];
  const result = await reconcileMissingTiboTranslations({
    store,
    translate: async () => {
      calls += 1;
      return {
        textJa: "新しい日本語",
        textZh: "新的中文",
        model: "test-model",
        status: "success",
        translatedAt: "2026-09-20T00:01:00.000Z",
      };
    },
    invalidateRadarData: () => {
      invalidations.push("radar-data");
    },
  });

  assert.equal(calls, 2);
  assert.equal(result.writes, 3);
  assert.deepEqual(invalidations, ["radar-data"]);
  assert.equal(store.rows[0].translatedTextJa, "新しい日本語");
  assert.equal(store.rows[0].translatedTextZh, "新的中文");
  assert.equal(store.rows[1].translatedTextJa, "既存の日本語");
  assert.equal(store.rows[1].translatedTextZh, "新的中文");
  assert.equal(store.rows[0].classification_reason, "keep this semantic field");
  assert.equal(store.rows[0].temporal_kind, "relative_day");
});

test("rate limits stop the bounded batch without attempting later rows", async () => {
  const store = makeStore([
    row(),
    row({ tweetId: "2090000000000000002" }),
  ]);
  let calls = 0;
  const result = await reconcileMissingTiboTranslations({
    store,
    translate: async () => {
      calls += 1;
      return {
        textJa: null,
        textZh: null,
        model: "test-model",
        status: "rate_limited",
        translatedAt: "2026-09-20T00:01:00.000Z",
      };
    },
  });

  assert.equal(calls, 1);
  assert.equal(result.geminiRequests, 1);
  assert.equal(result.rateLimited, true);
  assert.equal(result.writes, 0);
  assert.equal(result.outcomes[0]?.status, "rate_limited");
});

test("repairs only the invalid locale and uses the observed invalid value as a CAS", async () => {
  const source = "A reset is coming tomorrow.";
  const store = makeStore([row({ text: source, translatedTextJa: source, translatedTextZh: "已有中文" })]);
  const result = await reconcileMissingTiboTranslations({
    store,
    translate: success("明日、リセットが実施されます。", "新的中文"),
  });

  assert.equal(result.writes, 1);
  assert.equal(store.rows[0]?.translatedTextJa, "明日、リセットが実施されます。");
  assert.equal(store.rows[0]?.translatedTextZh, "已有中文");
});

test("uses the observed whitespace-only value as the empty-translation CAS", async () => {
  const source = "A reset is coming tomorrow.";
  const store = makeStore([row({ text: source, translatedTextJa: "  \n", translatedTextZh: "已有中文" })]);
  const result = await reconcileMissingTiboTranslations({
    store,
    translate: success("明日、リセットが実施されます。", "新的中文"),
  });

  assert.equal(result.writes, 1);
  assert.equal(store.rows[0]?.translatedTextJa, "明日、リセットが実施されます。");
  assert.equal(store.rows[0]?.translatedTextZh, "已有中文");
});

test("does not overwrite a valid translation written after candidate audit", async () => {
  const source = "A reset is coming tomorrow.";
  const store = makeStore([row({ text: source, translatedTextJa: source, translatedTextZh: "已有中文" })]);
  const auditedRow = row({
    text: source,
    translatedTextJa: source,
    translatedTextZh: "已有中文",
    signalType: "official_notice",
  }) as MissingTiboTranslationRow;
  const result = await reconcileMissingTiboTranslations({
    store,
    rows: [auditedRow],
    translate: async () => {
      store.rows[0]!.translatedTextJa = "別の正常な日本語";
      return {
        textJa: "新しい日本語",
        textZh: "新的中文",
        model: "test-model",
        status: "success" as const,
        translatedAt: "2026-09-20T00:01:00.000Z",
      };
    },
  });

  assert.equal(result.writes, 0);
  assert.equal(store.rows[0]?.translatedTextJa, "別の正常な日本語");
  assert.equal(store.rows[0]?.translatedTextZh, "已有中文");
});

test("a second reconciliation sees no duplicate candidate after a successful repair", async () => {
  const store = makeStore([row()]);
  const translate = success("日本語", "中文");
  const first = await reconcileMissingTiboTranslations({ store, translate });
  const second = await reconcileMissingTiboTranslations({ store, translate });

  assert.equal(first.writes, 2);
  assert.equal(second.candidates, 0);
  assert.equal(second.geminiRequests, 0);
});
