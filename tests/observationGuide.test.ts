import assert from "node:assert/strict";
import test from "node:test";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";

import { ObservationGuide } from "../components/ObservationGuide";

test("observation guide renders for all supported locales with guide text and 5 FAQs", () => {
  for (const locale of ["ja", "en", "zh"] as const) {
    const html = renderToStaticMarkup(
      React.createElement(ObservationGuide, { locale }),
    );

    // Guide section
    assert.match(html, /aria-labelledby="observation-guide-title"/);

    // FAQ schema
    assert.match(html, /"FAQPage"/);
    assert.match(html, /"Question"/);
    assert.match(html, /"Answer"/);

    // Accordion details tag
    const detailsCount = (html.match(/<details/g) ?? []).length;
    assert.strictEqual(detailsCount, 5, `expected 5 FAQ items for locale ${locale}`);

    // FAQ link
    const expectedLink = locale === "ja" ? 'href="/faq"' : `href="/${locale}/faq"`;
    assert.match(html, new RegExp(expectedLink));
  }
});

test("keeps the guide focused on FAQs without repeating the homepage forecast explainer", () => {
  const content = {
    ja: {
      guide: "Codexリセット観測ガイド",
      heading: "よくある質問（FAQ）",
      description: "Codex・ChatGPT Workの利用枠とリセットに関する回答です。",
      faqLink: "/faq",
      question: "リセット期待度とは何ですか？どのように計算されますか？",
      duplicatedHeading: "利用枠上限への備えと予測シグナルの読み解き方",
    },
    en: {
      guide: "Codex Reset Observatory Guide",
      heading: "Frequently Asked Questions",
      description: "Answers about Codex and ChatGPT Work usage limits and resets.",
      faqLink: "/en/faq",
      question: "What is the reset likelihood and how is it calculated?",
      duplicatedHeading: "Preparing for usage limits and reading forecast signals",
    },
    zh: {
      guide: "Codex 重置观测指南",
      heading: "常见问题解答（FAQ）",
      description: "汇总 Codex 与 ChatGPT Work 使用额度及重置相关问题。",
      faqLink: "/zh/faq",
      question: "重置可能性是什么意思？如何计算？",
      duplicatedHeading: "应对使用额度上限与理解预测信号",
    },
  } as const;

  for (const locale of ["ja", "en", "zh"] as const) {
    const html = renderToStaticMarkup(
      React.createElement(ObservationGuide, { locale }),
    );

    assert.ok(html.includes(content[locale].guide));
    assert.ok(html.includes(content[locale].heading));
    assert.ok(html.includes(content[locale].description));
    assert.ok(html.includes(content[locale].question));
    assert.ok(html.includes(`href="${content[locale].faqLink}"`));
    assert.ok(!html.includes(content[locale].duplicatedHeading));
  }
});
