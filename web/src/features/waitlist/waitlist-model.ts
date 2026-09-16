/**
 * The private-beta waitlist form: its steps, its validation, and the shape of
 * the mail that goes to the team.
 *
 * The form is asked one question at a time rather than as a single page of
 * fields. That is a deliberate trade: a six-field form on one screen reads as
 * paperwork, and the two questions we actually need answered to triage an
 * invite — headcount and current AI spend — are the two people skip when they
 * can see how long the page is. One question at a time hides the length and
 * makes each answer feel cheap.
 *
 * Kept pure — no React, no `fetch`, no DOM — so the step machine and the
 * per-step validation are testable on their own, and so the mail body has one
 * definition rather than one per caller.
 */

/** Every answer the form collects. Strings throughout: this is form input. */
export interface WaitlistAnswers {
  email: string;
  firstName: string;
  lastName: string;
  company: string;
  /** One of {@link HEADCOUNT_OPTIONS}. */
  headcount: string;
  /** One of {@link AI_BUDGET_OPTIONS}. */
  aiBudget: string;
  notes: string;
}

export const EMPTY_WAITLIST_ANSWERS: WaitlistAnswers = {
  email: "",
  firstName: "",
  lastName: "",
  company: "",
  headcount: "",
  aiBudget: "",
  notes: "",
};

export const HEADCOUNT_OPTIONS = [
  "1〜10名",
  "11〜50名",
  "51〜200名",
  "201〜1,000名",
  "1,001名以上",
] as const;

export const AI_BUDGET_OPTIONS = [
  "まだ利用していない",
  "〜10万円 / 月",
  "10〜50万円 / 月",
  "50〜200万円 / 月",
  "200万円以上 / 月",
] as const;

export type WaitlistStepId =
  | "email"
  | "name"
  | "company"
  | "headcount"
  | "aiBudget"
  | "notes";

export type WaitlistStep =
  /** A single free-text answer, written straight into `field`. */
  | {
      id: WaitlistStepId;
      kind: "email" | "text" | "textarea";
      question: string;
      hint?: string;
      placeholder?: string;
      required: boolean;
      field: keyof WaitlistAnswers;
    }
  /** Two fields on one screen — first and last name split the same question. */
  | {
      id: WaitlistStepId;
      kind: "name";
      question: string;
      hint?: string;
      required: boolean;
    }
  /** A fixed answer set, so headcount and spend come back aggregatable. */
  | {
      id: WaitlistStepId;
      kind: "choice";
      question: string;
      hint?: string;
      required: boolean;
      field: keyof WaitlistAnswers;
      options: readonly string[];
    };

export const WAITLIST_STEPS: readonly WaitlistStep[] = [
  {
    id: "email",
    kind: "email",
    question: "メールアドレス",
    hint: "ご招待リンクの送付先です。",
    placeholder: "you@company.co.jp",
    required: true,
    field: "email",
  },
  {
    id: "name",
    kind: "name",
    question: "担当者名",
    hint: "ファーストネーム / ラストネーム",
    required: true,
  },
  {
    id: "company",
    kind: "text",
    question: "企業名",
    placeholder: "株式会社ヌックス",
    required: true,
    field: "company",
  },
  {
    id: "headcount",
    kind: "choice",
    question: "社員数",
    required: true,
    field: "headcount",
    options: HEADCOUNT_OPTIONS,
  },
  {
    id: "aiBudget",
    kind: "choice",
    question: "現時点で利用しているAI予算",
    hint: "おおよそで構いません。",
    required: true,
    field: "aiBudget",
    options: AI_BUDGET_OPTIONS,
  },
  {
    id: "notes",
    kind: "textarea",
    question: "ご不明点や相談",
    hint: "任意です。空欄のまま送信いただけます。",
    placeholder: "例）既存のSlackやGitHubとの連携について相談したい",
    required: false,
    field: "notes",
  },
];

/**
 * Deliberately loose: one `@`, something on each side, a dot in the domain.
 *
 * The form cannot tell a deliverable address from an undeliverable one, and a
 * stricter pattern only ever produces false rejections of addresses that are
 * in fact fine. The real check is whether the invite mail lands.
 */
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/**
 * Why this step cannot be left yet, or null when it can.
 *
 * Returned as the message rather than a boolean so the caller has something to
 * show; an "invalid" state with no explanation is the form equivalent of a
 * locked door with no sign.
 */
export function stepError(
  step: WaitlistStep,
  answers: WaitlistAnswers,
): string | null {
  if (step.kind === "name") {
    if (!answers.firstName.trim() || !answers.lastName.trim()) {
      return "ファーストネームとラストネームをご入力ください。";
    }
    return null;
  }

  const value = answers[step.field].trim();

  if (!value) {
    return step.required ? "この項目は必須です。" : null;
  }
  if (step.kind === "email" && !EMAIL_PATTERN.test(value)) {
    return "メールアドレスの形式をご確認ください。";
  }
  if (step.kind === "choice" && !step.options.includes(value)) {
    return "選択肢からお選びください。";
  }
  return null;
}

/** Whether every step passes — the gate on the submit button. */
export function canSubmit(answers: WaitlistAnswers): boolean {
  return WAITLIST_STEPS.every((step) => stepError(step, answers) === null);
}

/** The first step that still needs an answer, or -1 when the form is complete. */
export function firstIncompleteStep(answers: WaitlistAnswers): number {
  return WAITLIST_STEPS.findIndex((step) => stepError(step, answers) !== null);
}

/** Where the address bar sends someone whose submission went through. */
export const WAITLIST_THANKS_PATH = "/waitlist/thanks";

/** Who the submission is delivered to. */
export const WAITLIST_RECIPIENT = "hello@nuxx.ai";

/**
 * The submission as the form-relay service will mail it.
 *
 * Japanese labels as keys because the services that back this form render the
 * payload as a table of key/value pairs in the mail body — the keys *are* the
 * labels the reader sees. `subject` and `message` are the two fields those
 * services treat specially, so they are named in English and set explicitly.
 */
export function waitlistMailPayload(
  answers: WaitlistAnswers,
): Record<string, string> {
  const fullName =
    `${answers.lastName.trim()} ${answers.firstName.trim()}`.trim();
  const notes = answers.notes.trim() || "（なし）";

  return {
    subject: `【Waitlist】${answers.company.trim()} / ${fullName}`,
    // A `from_name`/`email` pair lets a reply from the inbox go straight back
    // to the person who filled the form instead of to the relay service.
    from_name: fullName,
    email: answers.email.trim(),
    メールアドレス: answers.email.trim(),
    担当者名: fullName,
    企業名: answers.company.trim(),
    社員数: answers.headcount,
    現時点で利用しているAI予算: answers.aiBudget,
    ご不明点や相談: notes,
    // Plain-text mirror, for the services that mail `message` verbatim rather
    // than building a table.
    message: [
      `メールアドレス: ${answers.email.trim()}`,
      `担当者名: ${fullName}`,
      `企業名: ${answers.company.trim()}`,
      `社員数: ${answers.headcount}`,
      `現時点で利用しているAI予算: ${answers.aiBudget}`,
      `ご不明点や相談: ${notes}`,
    ].join("\n"),
  };
}
