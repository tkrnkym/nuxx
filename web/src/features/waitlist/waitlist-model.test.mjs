import assert from "node:assert/strict";
import test from "node:test";

import {
  AI_BUDGET_OPTIONS,
  EMPTY_WAITLIST_ANSWERS,
  HEADCOUNT_OPTIONS,
  WAITLIST_STEPS,
  canSubmit,
  firstIncompleteStep,
  stepError,
  waitlistMailPayload,
} from "@/features/waitlist/waitlist-model";

const complete = {
  email: "taro@example.co.jp",
  firstName: "太郎",
  lastName: "山田",
  company: "株式会社ヌックス",
  headcount: HEADCOUNT_OPTIONS[1],
  aiBudget: AI_BUDGET_OPTIONS[2],
  notes: "",
};

const stepById = (id) => WAITLIST_STEPS.find((step) => step.id === id);

test("the questions are asked in the order the form was specified in", () => {
  assert.deepEqual(
    WAITLIST_STEPS.map((step) => step.id),
    ["email", "name", "company", "headcount", "aiBudget", "notes"],
  );
});

test("an empty required step reports why it cannot be left", () => {
  assert.equal(
    stepError(stepById("company"), EMPTY_WAITLIST_ANSWERS),
    "この項目は必須です。",
  );
});

test("the free-text last step is optional, so an empty one passes", () => {
  // "ご不明点や相談" is the one question someone may have no answer to; blocking
  // the submit on it would strand people who simply have no questions.
  assert.equal(stepError(stepById("notes"), EMPTY_WAITLIST_ANSWERS), null);
  assert.equal(canSubmit(complete), true);
});

test("an address without an @ or a domain dot is rejected", () => {
  const step = stepById("email");
  assert.notEqual(stepError(step, { ...complete, email: "taro" }), null);
  assert.notEqual(
    stepError(step, { ...complete, email: "taro@example" }),
    null,
  );
  assert.equal(stepError(step, complete), null);
});

test("both halves of the name are required, not just one", () => {
  const step = stepById("name");
  assert.notEqual(stepError(step, { ...complete, lastName: "  " }), null);
  assert.notEqual(stepError(step, { ...complete, firstName: "" }), null);
  assert.equal(stepError(step, complete), null);
});

test("a choice step only accepts one of its own options", () => {
  const step = stepById("headcount");
  assert.notEqual(stepError(step, { ...complete, headcount: "5人" }), null);
  assert.equal(stepError(step, complete), null);
});

test("submission resumes at the first question still missing an answer", () => {
  assert.equal(firstIncompleteStep(EMPTY_WAITLIST_ANSWERS), 0);
  assert.equal(firstIncompleteStep({ ...complete, aiBudget: "" }), 4);
  assert.equal(firstIncompleteStep(complete), -1);
});

test("the mail carries every answer under its Japanese label", () => {
  const payload = waitlistMailPayload(complete);
  assert.equal(payload.メールアドレス, "taro@example.co.jp");
  // Family name first, the order the label is read in Japanese.
  assert.equal(payload.担当者名, "山田 太郎");
  assert.equal(payload.企業名, "株式会社ヌックス");
  assert.equal(payload.社員数, HEADCOUNT_OPTIONS[1]);
  assert.equal(payload.現時点で利用しているAI予算, AI_BUDGET_OPTIONS[2]);
  // An empty optional field is spelled out, so a blank row is not read as a
  // formatting failure in the inbox.
  assert.equal(payload.ご不明点や相談, "（なし）");
  assert.match(payload.subject, /株式会社ヌックス/);
  // Replies from the inbox should reach the person who filled the form.
  assert.equal(payload.email, "taro@example.co.jp");
  assert.match(payload.message, /社員数: 11〜50名/);
});
