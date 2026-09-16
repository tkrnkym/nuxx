import { Check } from "lucide-react";
import * as React from "react";

import type {
  WaitlistAnswers,
  WaitlistStep,
} from "@/features/waitlist/waitlist-model";
import { cn } from "@/shared/lib/cn";
import { Input } from "@/shared/ui/input";

/** The card a choice is picked from — selected, and the resting state. */
const CHOICE_CLASS =
  "flex cursor-pointer items-center justify-between gap-3 rounded-lg border px-4 py-3 text-sm transition-colors has-[:focus-visible]:ring-1 has-[:focus-visible]:ring-ring";

/**
 * The input for one waitlist step.
 *
 * Split from the dialog because the dialog's job is the step machine — which
 * question, can it be left, what does the button say — and none of that reads
 * well through four branches of markup.
 *
 * Mounted fresh per question: the dialog keys this on the step id, which is what
 * lets the focus below be a plain mount effect rather than something that has to
 * track the step index.
 */
export function WaitlistStepField({
  answers,
  onChange,
  onCommit,
  step,
}: {
  answers: WaitlistAnswers;
  onChange: (patch: Partial<WaitlistAnswers>) => void;
  /**
   * Enter on a single-line field, or a pick on a choice: advance if valid.
   *
   * Takes the patch rather than reading it back off `answers`, because a choice
   * commits in the same event that sets it and `answers` is a render behind.
   */
  onCommit: (patch?: Partial<WaitlistAnswers>) => void;
  step: WaitlistStep;
}) {
  const fieldId = React.useId();
  // The question can be answered by typing as soon as it appears — the whole
  // point of one-at-a-time is that the keyboard never has to leave the field.
  //
  // A callback ref rather than a ref plus a mount effect, because the control it
  // lands on is an input on four steps and a textarea on the last: one
  // `RefObject` cannot be both without a cast at every use. Typed on the union's
  // base, which a ref for either element accepts.
  const focusOnMount = React.useCallback((node: HTMLElement | null) => {
    node?.focus();
  }, []);

  const enterAdvances = (event: React.KeyboardEvent) => {
    if (event.key !== "Enter") return;
    event.preventDefault();
    onCommit();
  };

  if (step.kind === "name") {
    return (
      <div className="grid gap-3 sm:grid-cols-2">
        <div className="grid gap-1.5">
          <label
            className="text-2xs font-medium text-muted-foreground"
            htmlFor={`${fieldId}-first`}
          >
            ファーストネーム
          </label>
          <Input
            autoComplete="given-name"
            className="h-11 text-base"
            id={`${fieldId}-first`}
            onChange={(event) => onChange({ firstName: event.target.value })}
            onKeyDown={enterAdvances}
            placeholder="太郎"
            ref={focusOnMount}
            value={answers.firstName}
          />
        </div>
        <div className="grid gap-1.5">
          <label
            className="text-2xs font-medium text-muted-foreground"
            htmlFor={`${fieldId}-last`}
          >
            ラストネーム
          </label>
          <Input
            autoComplete="family-name"
            className="h-11 text-base"
            id={`${fieldId}-last`}
            onChange={(event) => onChange({ lastName: event.target.value })}
            onKeyDown={enterAdvances}
            placeholder="山田"
            value={answers.lastName}
          />
        </div>
      </div>
    );
  }

  if (step.kind === "choice") {
    const selected = answers[step.field];
    return (
      // Real radios rather than buttons wearing `role="radio"`: it is the group
      // the arrow keys already know how to walk, and the one a screen reader
      // announces as "1 of 5" without being told to.
      <fieldset className="grid gap-2">
        <legend className="sr-only">{step.question}</legend>
        {step.options.map((option, optionIndex) => {
          const active = selected === option;
          return (
            <label
              className={cn(
                CHOICE_CLASS,
                active
                  ? "border-primary bg-primary/10 text-foreground"
                  : "border-input hover:bg-accent hover:text-accent-foreground",
              )}
              key={option}
            >
              <input
                checked={active}
                className="sr-only"
                name={`${fieldId}-${step.id}`}
                onChange={() =>
                  onCommit({ [step.field]: option } as Partial<WaitlistAnswers>)
                }
                ref={optionIndex === 0 ? focusOnMount : undefined}
                type="radio"
                value={option}
              />
              <span>{option}</span>
              {active && <Check aria-hidden className="size-4 text-primary" />}
            </label>
          );
        })}
      </fieldset>
    );
  }

  if (step.kind === "textarea") {
    return (
      <textarea
        aria-label={step.question}
        className="min-h-28 w-full rounded-md border border-input bg-transparent px-3 py-2 text-base shadow-xs transition-colors placeholder:text-muted-foreground focus-visible:outline-hidden focus-visible:ring-1 focus-visible:ring-ring"
        onChange={(event) => onChange({ [step.field]: event.target.value })}
        onKeyDown={(event) => {
          // Enter is a newline here — it is the one field where a line break is
          // a legitimate answer. Cmd/Ctrl+Enter keeps the keyboard path open.
          if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) {
            event.preventDefault();
            onCommit();
          }
        }}
        placeholder={step.placeholder}
        ref={focusOnMount}
        rows={4}
        value={answers[step.field]}
      />
    );
  }

  return (
    <Input
      aria-label={step.question}
      autoComplete={step.kind === "email" ? "email" : "organization"}
      className="h-11 text-base"
      inputMode={step.kind === "email" ? "email" : undefined}
      onChange={(event) => onChange({ [step.field]: event.target.value })}
      onKeyDown={enterAdvances}
      placeholder={step.placeholder}
      ref={focusOnMount}
      type={step.kind === "email" ? "email" : "text"}
      value={answers[step.field]}
    />
  );
}
