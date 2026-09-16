import * as React from "react";

import nuxxAppIcon from "@/assets/app-icon@3x.png";
import { WaitlistDialog } from "@/features/waitlist/ui/WaitlistDialog";
import { Button } from "@/shared/ui/button";

/**
 * The page the waitlist popup opens over.
 *
 * The form itself is a dialog so the landing page can trigger it from anywhere
 * — a hero button, a nav item, a footer link — without a navigation. This page
 * exists so the dialog has a home before that landing page lands: it is a
 * linkable `/waitlist` for mail and social, and it is where the flow can be
 * reviewed. Once the LP is in, it imports {@link WaitlistDialog} directly and
 * this page keeps working as the standalone entry point.
 *
 * Opens on mount, because arriving at `/waitlist` is already the decision to
 * fill the form; a second click to reach it would be a toll booth. Closing
 * leaves the page rather than the site, so the form can be reopened.
 */
export function WaitlistPage() {
  const [open, setOpen] = React.useState(true);

  return (
    <div className="flex min-h-dvh flex-1 flex-col items-center justify-center bg-background px-4 py-16">
      <div className="w-full max-w-md text-center">
        <div className="flex items-center justify-center gap-3">
          <div
            className="size-12 overflow-hidden bg-black"
            style={{ borderRadius: "22.37%" }}
          >
            <img alt="" className="size-full" src={nuxxAppIcon} />
          </div>
          <span className="text-2xl font-semibold tracking-tight">nuxx</span>
        </div>

        <h1 className="mt-8 text-2xl font-semibold tracking-tight">
          プライベートベータ Waitlist
        </h1>
        <p className="mt-4 text-sm leading-relaxed text-muted-foreground">
          現在はプライベートベータ版として限定された企業様にご提供しています。
          ご提供可能になった際に無料で試用可能なご招待リンクを送付させていただきます。
        </p>

        <Button
          className="mt-8"
          data-testid="waitlist-open"
          onClick={() => setOpen(true)}
        >
          Waitlist に登録する
        </Button>
      </div>

      <WaitlistDialog onClose={() => setOpen(false)} open={open} />
    </div>
  );
}
