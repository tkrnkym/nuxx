import { useMemo, useState } from "react";

import { ChannelMembersDialog } from "@/features/channels/ui/ChannelMembersDialog";
import { useChannelRoster } from "@/features/channels/use-channel-members";
import { usePresence } from "@/features/chat/use-presence";
import { useMyPubkey } from "@/features/chat/use-chat";
import {
  resolveAvatarUrl,
  resolveUserLabel,
} from "@/features/profile/profile-model";
import { useProfiles } from "@/features/profile/profile-store";
import { PresenceBadge } from "@/shared/ui/PresenceBadge";
import { PubkeyAvatar } from "@/shared/ui/PubkeyAvatar";

/** How many faces the header shows before it stops and counts instead. */
const FACES = 3;

/**
 * The header facepile: who is in this channel, and a way into the full list.
 *
 * A button rather than a row of avatars with a click handler on each, because
 * the whole pile is one control with one action — `PubkeyAvatar` carries a
 * tooltip and is deliberately not a button, so the target has to be supplied
 * here.
 *
 * Renders nothing at all when the channel has no member list. An empty pile
 * opening an empty dialog is a control that promises something the relay has
 * not told us, and this header already has two status indicators competing for
 * the same corner.
 */
export function ChannelMembersButton({
  channelId,
  channelLabel,
}: {
  channelId: string | null;
  /** The channel's name, which is how an agent records its channels. */
  channelLabel: string | null;
}) {
  const [open, setOpen] = useState(false);
  const myPubkey = useMyPubkey();
  const roster = useChannelRoster(channelId, channelLabel);

  const pubkeys = useMemo(
    () => [
      ...roster.people.map((member) => member.pubkey),
      ...roster.agents.map((agent) => agent.pubkey),
    ],
    [roster],
  );
  const profiles = useProfiles(pubkeys);
  // Only the people: an agent's run state comes from its own record, and asking
  // the relay whether a harness is "online" would answer a different question.
  const presencePubkeys = useMemo(
    () => roster.people.map((member) => member.pubkey),
    [roster],
  );
  const presence = usePresence(presencePubkeys);

  // An agent's name comes from its own record, not from kind:0 — the harness
  // does not publish a profile, so resolving it like a person would put a
  // truncated pubkey where the reader expects a name.
  const faces = useMemo(
    () =>
      [
        ...roster.people.map((member) => ({
          label: resolveUserLabel({ profiles, pubkey: member.pubkey }),
          pubkey: member.pubkey,
        })),
        ...roster.agents.map((agent) => ({
          label: agent.name,
          pubkey: agent.pubkey,
        })),
      ].slice(0, FACES),
    [profiles, roster],
  );

  const total = pubkeys.length;
  if (total === 0) return null;

  return (
    <>
      <button
        aria-label={`メンバー ${total}人`}
        className="flex items-center gap-1.5 rounded-md px-1.5 py-1 hover:bg-accent"
        data-testid="channel-members-button"
        onClick={() => setOpen(true)}
        type="button"
      >
        <span className="flex -space-x-1.5">
          {faces.map((face) => (
            <PubkeyAvatar
              avatarUrl={resolveAvatarUrl(face.pubkey, profiles)}
              badge={<PresenceBadge status={presence.statusOf(face.pubkey)} />}
              className="rounded-full ring-2 ring-background"
              key={face.pubkey}
              label={face.label}
              pubkey={face.pubkey}
              size="sm"
            />
          ))}
        </span>
        <span className="text-2xs tabular-nums text-muted-foreground">
          {total}
        </span>
      </button>

      <ChannelMembersDialog
        channelLabel={channelLabel}
        myPubkey={myPubkey}
        onClose={() => setOpen(false)}
        open={open}
        presenceOf={presence.statusOf}
        profiles={profiles}
        roster={roster}
      />
    </>
  );
}
