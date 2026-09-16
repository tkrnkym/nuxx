import { Link } from "@tanstack/react-router";

import nuxxAppIcon from "@/assets/app-icon@3x.png";
import { WAITLIST_RECIPIENT } from "@/features/waitlist/waitlist-model";
import { Button } from "@/shared/ui/button";

/**
 * The screen someone lands on once their waitlist form has been mailed.
 *
 * A route of its own rather than a final panel inside the dialog, so the
 * confirmation has a URL: it is the address an analytics goal is set on, the
 * one someone can be sent back to, and the one that survives the reload people
 * reflexively perform when they are unsure a form went through.
 *
 * It is reachable directly, by anyone, at any time — so it confirms without
 * asserting anything it cannot know. It does not name the submitter or claim a
 * timeline; the mail is the record, this is the receipt.
 */
export function WaitlistThanks() {
  return (
    <div className="flex min-h-dvh flex-1 flex-col items-center justify-center bg-background px-4 py-16">
      <div className="w-full max-w-md text-center">
        <div className="flex items-center justify-center gap-3">
          <div
            className="size-12 overflow-hidden bg-black"
            // Matches the app icon's own corner curve, as the invite page does.
            style={{ borderRadius: "22.37%" }}
          >
            <img alt="" className="size-full" src={nuxxAppIcon} />
          </div>
          <span className="text-2xl font-semibold tracking-tight">nuxx</span>
        </div>

        <h1 className="mt-8 text-2xl font-semibold tracking-tight">
          ご登録ありがとうございました。
        </h1>
        <p className="mt-4 text-sm leading-relaxed text-muted-foreground">
          ご提供可能になり次第、ご入力いただいたメールアドレス宛に無料で試用可能なご招待リンクを送付いたします。
          今しばらくお待ちください。
        </p>
        <p className="mt-4 text-sm leading-relaxed text-muted-foreground">
          お問い合わせは{" "}
          <a
            className="text-primary underline-offset-4 hover:underline"
            href={`mailto:${WAITLIST_RECIPIENT}`}
          >
            {WAITLIST_RECIPIENT}
          </a>{" "}
          まで。
        </p>

        <Button asChild className="mt-8" variant="outline">
          <Link to="/waitlist">Waitlist のトップへ戻る</Link>
        </Button>
      </div>
    </div>
  );
}
