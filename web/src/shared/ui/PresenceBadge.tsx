import { cn } from "@/shared/lib/cn";

/**
 * Presence marker beside an identity disc.
 *
 * Unknown presence renders nothing rather than a grey dot: the relay only knows
 * who is currently connected, so "no status" means "not established", not
 * "offline", and showing them as away would be a claim the client cannot make.
 */
export function PresenceBadge({ status }: { status: string | null }) {
  if (status === null || status === "offline") return null;
  return (
    <span
      aria-label={`Status: ${status}`}
      className={cn(
        "absolute -bottom-0.5 -right-0.5 size-2.5 rounded-full ring-2 ring-background",
        status === "online" ? "bg-primary" : "bg-muted-foreground",
      )}
      role="img"
      title={status}
    />
  );
}
