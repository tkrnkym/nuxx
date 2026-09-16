import { useQuery } from "@tanstack/react-query";
import { useMemo } from "react";

import {
  buildChannelMemberFilter,
  buildChannelRoster,
  membersOfChannel,
  type ChannelMember,
  type ChannelRoster,
} from "@/features/channels/channel-members";
import { useShowcase } from "@/features/showcase/use-showcase";
import { postRelayQuery } from "@/shared/api/relay-http";

const EMPTY_MEMBERS: ChannelMember[] = [];

/**
 * The member list of one channel.
 *
 * Kept apart from `useMemberRoles`, which fetches every channel the reader is in
 * at once: that query answers "who can I address" and is cached under a key made
 * of all of them, so reusing it here would mean a channel switch either refetches
 * everything or reads a list that is not this room's.
 */
export function useChannelMembers(channelId: string | null): ChannelMember[] {
  const query = useQuery({
    queryKey: ["channels", "members", channelId],
    queryFn: async () => {
      const filter = channelId ? buildChannelMemberFilter(channelId) : null;
      if (!filter || !channelId) return EMPTY_MEMBERS;
      return membersOfChannel(await postRelayQuery([filter]), channelId);
    },
    enabled: Boolean(channelId),
    // Membership changes rarely next to how often a channel is opened, and a
    // stale list here costs a name, not a permission — nothing is authorized on
    // what this returns.
    staleTime: 60_000,
  });

  return query.data ?? EMPTY_MEMBERS;
}

/** People and agents in one channel, ready to render. */
export function useChannelRoster(
  channelId: string | null,
  channelName: string | null,
): ChannelRoster {
  const members = useChannelMembers(channelId);
  const showcase = useShowcase();
  const agents = showcase?.agents;

  return useMemo(
    () => buildChannelRoster({ agents, channelName, members }),
    [agents, channelName, members],
  );
}
