import { createFileRoute } from "@tanstack/react-router";

import { WaitlistThanks } from "@/features/waitlist/ui/WaitlistThanks";

/** The waitlist confirmation, given its own URL so it can be linked and measured. */
export const Route = createFileRoute("/waitlist/thanks")({
  component: WaitlistThanks,
});
