import { useNavigate } from "@tanstack/react-router";
import { ArrowLeft, ArrowRight, CornerDownLeft, Send } from "lucide-react";
import * as React from "react";

import { WaitlistStepField } from "@/features/waitlist/ui/WaitlistStepField";
import {
  isWaitlistConfigured,
  submitWaitlist,
} from "@/features/waitlist/waitlist-api";
import {
  EMPTY_WAITLIST_ANSWERS,
  WAITLIST_RECIPIENT,
  WAITLIST_STEPS,
  WAITLIST_THANKS_PATH,
  type WaitlistAnswers,
  canSubmit,
  firstIncompleteStep,
  stepError,
} from "@/features/waitlist/waitlist-model";
import { Button } from "@/shared/ui/button";
import { Dialog } from "@/shared/ui/dialog";

/** How long a picked choice stays visible before the form moves on. */
const CHOICE_ADVANCE_MS = 220;

/**
 * The private-beta waitlist, asked one question at a time.
 *
 * Built on the native-`<dialog>` primitive rather than a hand-rolled overlay,
 * which is what gets the focus trap, the inert background, and Escape-to-close
 * for free — all three matter more here than usual, because the form owns the
 * keyboard: Enter is "next", and a stray Tab that escapes the panel would land
 * on the page behind it mid-answer.
 *
 * Answers survive a close and reopen. Someone who dismissed the dialog to check
 * their company's headcount should come back to the question they left, not to
 * an empty first field.
 */
export function WaitlistDialog({
  onClose,
  open,
}: {
  onClose: () => void;
  open: boolean;
}) {
  const navigate = useNavigate();
  const [started, setStarted] = React.useState(false);
  const [index, setIndex] = React.useState(0);
  const [answers, setAnswers] = React.useState<WaitlistAnswers>(
    EMPTY_WAITLIST_ANSWERS,
  );
  const [error, setError] = React.useState<string | null>(null);
  const [submitError, setSubmitError] = React.useState<string | null>(null);
  const [submitting, setSubmitting] = React.useState(false);

  const advanceTimer = React.useRef<ReturnType<typeof setTimeout> | null>(null);

  const step = WAITLIST_STEPS[index];
  const isLast = index === WAITLIST_STEPS.length - 1;

  const cancelAdvance = React.useCallback(() => {
    if (advanceTimer.current === null) return;
    clearTimeout(advanceTimer.current);
    advanceTimer.current = null;
  }, []);

  // A pending auto-advance outlives the dialog otherwise, and fires a state
  // update into an unmounted tree.
  React.useEffect(() => cancelAdvance, [cancelAdvance]);

  const submit = React.useCallback(
    async (final: WaitlistAnswers) => {
      // Guard rather than trust the caller: the submit button is also reachable
      // by Enter, and a step skipped by a bad merge would post a half-form.
      const incomplete = firstIncompleteStep(final);
      if (incomplete !== -1) {
        setIndex(incomplete);
        setError(stepError(WAITLIST_STEPS[incomplete], final));
        return;
      }
      setSubmitError(null);
      setSubmitting(true);
      try {
        await submitWaitlist(final);
        navigate({ to: WAITLIST_THANKS_PATH });
      } catch (cause) {
        setSubmitError(
          cause instanceof Error
            ? cause.message
            : `送信できませんでした。お手数ですが ${WAITLIST_RECIPIENT} まで直接ご連絡ください。`,
        );
      } finally {
        setSubmitting(false);
      }
    },
    [navigate],
  );

  /**
   * Leave the current step, if its answer holds up.
   *
   * `patch` carries the value that triggered the commit for a choice, which is
   * set and acted on in the same event — `answers` would still be a render
   * behind, and the step would refuse to advance on its own selection.
   */
  const commit = (patch?: Partial<WaitlistAnswers>) => {
    if (submitting) return;
    const merged = patch ? { ...answers, ...patch } : answers;
    if (patch) setAnswers(merged);

    const problem = stepError(step, merged);
    setError(problem);
    if (problem) return;

    if (isLast) {
      void submit(merged);
      return;
    }
    // A picked choice gets a beat to show as picked before the form moves on;
    // an advance that is instant reads as "did that register?".
    cancelAdvance();
    if (patch) {
      advanceTimer.current = setTimeout(() => {
        advanceTimer.current = null;
        setIndex((current) => Math.min(current + 1, WAITLIST_STEPS.length - 1));
      }, CHOICE_ADVANCE_MS);
      return;
    }
    setIndex(index + 1);
  };

  const goBack = () => {
    cancelAdvance();
    setError(null);
    setSubmitError(null);
    if (index === 0) {
      setStarted(false);
      return;
    }
    setIndex(index - 1);
  };

  const change = (patch: Partial<WaitlistAnswers>) => {
    setAnswers((current) => ({ ...current, ...patch }));
    // Clearing on edit rather than re-validating on every keystroke: an error
    // that reappears letter by letter while someone types their address is
    // scolding, not helping.
    if (error) setError(null);
  };

  const progress = ((index + 1) / WAITLIST_STEPS.length) * 100;

  return (
    <Dialog
      className="w-[min(34rem,calc(100vw-2rem))]"
      onClose={onClose}
      open={open}
      testId="waitlist-dialog"
      title="Nuxx プライベートベータ Waitlist"
    >
      {!started ? (
        <div className="space-y-4" data-testid="waitlist-intro">
          <p className="text-sm leading-relaxed text-foreground">
            現在はプライベートベータ版として限定された企業様にご提供しています。
          </p>
          <p className="text-sm leading-relaxed text-foreground">
            ご提供可能になった際に無料で試用可能なご招待リンクを送付させていただきます。
          </p>
          <p className="text-sm leading-relaxed text-muted-foreground">
            以下の情報をご入力ください。所要時間は1分ほどです。
          </p>
          {!isWaitlistConfigured() && (
            <p className="rounded-md border border-border bg-muted px-3 py-2 text-2xs text-muted-foreground">
              このビルドは送信先が未設定です（
              <code>VITE_WAITLIST_ACCESS_KEY</code>
              ）。入力はできますが送信は失敗します。
            </p>
          )}
          <Button
            className="w-full"
            data-testid="waitlist-start"
            onClick={() => setStarted(true)}
          >
            入力をはじめる
            <ArrowRight aria-hidden />
          </Button>
        </div>
      ) : (
        <div className="space-y-5">
          <div className="space-y-2">
            <div
              aria-label={`全${WAITLIST_STEPS.length}問中 ${index + 1}問目`}
              className="h-1 w-full overflow-hidden rounded-full bg-muted"
              role="progressbar"
              aria-valuemax={WAITLIST_STEPS.length}
              aria-valuemin={1}
              aria-valuenow={index + 1}
            >
              <div
                className="h-full rounded-full bg-primary transition-[width] duration-300 motion-reduce:transition-none"
                style={{ width: `${progress}%` }}
              />
            </div>
            <p className="text-2xs text-muted-foreground">
              {index + 1} / {WAITLIST_STEPS.length}
            </p>
          </div>

          {/* Keyed by step so the entrance replays on every question. */}
          <div
            className="space-y-3 animate-in fade-in-0 slide-in-from-bottom-2 duration-200 motion-reduce:animate-none"
            key={step.id}
          >
            <div className="space-y-1">
              <h3 className="text-lg font-semibold leading-snug">
                {step.question}
                {step.required && (
                  <span aria-hidden className="ml-1 text-destructive">
                    *
                  </span>
                )}
              </h3>
              {step.hint && (
                <p className="text-sm text-muted-foreground">{step.hint}</p>
              )}
            </div>

            <WaitlistStepField
              answers={answers}
              onChange={change}
              onCommit={commit}
              step={step}
            />

            {error && (
              <p className="text-sm text-destructive" role="alert">
                {error}
              </p>
            )}
          </div>

          {submitError && (
            <p
              className="rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive"
              role="alert"
            >
              {submitError}
            </p>
          )}

          <div className="flex items-center justify-between gap-3 border-t border-border pt-4">
            <Button
              disabled={submitting}
              onClick={goBack}
              type="button"
              variant="ghost"
            >
              <ArrowLeft aria-hidden />
              戻る
            </Button>
            <div className="flex items-center gap-3">
              <span className="hidden items-center gap-1 text-2xs text-muted-foreground sm:flex">
                <CornerDownLeft aria-hidden className="size-3" />
                Enter で次へ
              </span>
              <Button
                data-testid="waitlist-next"
                disabled={submitting || (isLast && !canSubmit(answers))}
                onClick={() => commit()}
                type="button"
              >
                {isLast ? (
                  <>
                    {submitting ? "送信中…" : "送信する"}
                    <Send aria-hidden />
                  </>
                ) : (
                  <>
                    次へ
                    <ArrowRight aria-hidden />
                  </>
                )}
              </Button>
            </div>
          </div>
        </div>
      )}
    </Dialog>
  );
}
