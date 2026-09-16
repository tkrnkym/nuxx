import { createFileRoute } from "@tanstack/react-router";

import { WaitlistPage } from "@/features/waitlist/ui/WaitlistPage";

/**
 * The waitlist form, outside the app shell.
 *
 * It publishes nothing and reads nothing from the relay — the submission goes
 * to a hosted form relay — so it wants neither the shell's socket nor its
 * sidebar. Someone who has not been let into the beta yet has no community to
 * put in a rail.
 */
export const Route = createFileRoute("/waitlist")({
  component: WaitlistPage,
});
