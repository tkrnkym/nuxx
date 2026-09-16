/**
 * Who is in one channel.
 *
 * The directory's `membersFromEvents` deliberately flattens every channel into
 * a single pubkey→role map, because the question it answers is "who can this
 * reader address". The question here is the other one — "who is in *this*
 * room" — and a map keyed by person cannot answer it, so the `d` tag has to be
 * read rather than discarded.
 *
 * Same source either way: the NIP-29 member list, kind:39002, addressable by
 * `d` = the channel id.
 */

import { sortAgents } from "@/features/agents/agent-model";
import { normalizePubkey } from "@/features/profile/profile-model";
import type { AgentStatus, ShowcaseAgent } from "@/mock/showcase";
import { KIND_NIP29_GROUP_MEMBERS } from "@/shared/constants/kinds";
import type { NostrEvent, NostrFilter } from "@/shared/lib/nostr-client";

export interface ChannelMember {
  pubkey: string;
  /** NIP-29 role: owner, admin, or member. */
  role: string;
}

const ROLE_RANK: Record<string, number> = { owner: 0, admin: 1, member: 2 };

/**
 * Sort weight for a role, seniority first.
 *
 * Unknown roles sort last rather than being dropped: the relay may grow a role
 * this client has not heard of, and a member list that silently omits people is
 * worse than one that lists them under a name it does not recognise.
 */
export function channelRoleRank(role: string): number {
  return ROLE_RANK[role] ?? 99;
}

/** The member list of a single channel. */
export function buildChannelMemberFilter(
  channelId: string,
): NostrFilter | null {
  if (!channelId) return null;
  return { kinds: [KIND_NIP29_GROUP_MEMBERS], "#d": [channelId] };
}

/**
 * Members of `channelId`, strongest role first.
 *
 * Events for other channels are ignored rather than trusted to be absent: the
 * relay answers a filter, and one query's results outliving a channel switch in
 * a shared cache is exactly the kind of thing that puts a stranger in the list.
 */
export function membersOfChannel(
  events: NostrEvent[],
  channelId: string,
): ChannelMember[] {
  const roles = new Map<string, string>();

  for (const event of events) {
    if (event.kind !== KIND_NIP29_GROUP_MEMBERS) continue;
    const scope = event.tags.find((tag) => tag[0] === "d")?.[1];
    if (scope !== channelId) continue;

    for (const tag of event.tags) {
      // NIP-29 convention: ["p", pubkey, relay_url, role].
      if (tag[0] !== "p" || typeof tag[1] !== "string") continue;
      const pubkey = normalizePubkey(tag[1]);
      if (!pubkey) continue;
      const role = typeof tag[3] === "string" && tag[3] ? tag[3] : "member";
      const current = roles.get(pubkey);
      // A person named twice in one list keeps the stronger role, for the same
      // reason the directory does: listing an owner as a plain member because
      // that line came last is the worse of the two errors.
      if (
        current === undefined ||
        channelRoleRank(role) < channelRoleRank(current)
      ) {
        roles.set(pubkey, role);
      }
    }
  }

  return [...roles]
    .map(([pubkey, role]) => ({ pubkey, role }))
    .sort(
      (left, right) =>
        channelRoleRank(left.role) - channelRoleRank(right.role) ||
        left.pubkey.localeCompare(right.pubkey),
    );
}

/**
 * An agent in the roster.
 *
 * A narrow shape rather than the whole `ShowcaseAgent`: the members dialog shows
 * a name, a run state and what it is doing, and nothing here should grow a
 * dependency on the demo record's other fields.
 */
export interface ChannelAgent {
  pubkey: string;
  name: string;
  status: AgentStatus;
  /** What it is doing right now, when working. */
  activity: string | null;
}

export interface ChannelRoster {
  /** People, strongest role first. */
  people: ChannelMember[];
  /** Agents added to this channel. */
  agents: ChannelAgent[];
}

/**
 * Who is in this room, split into people and agents.
 *
 * Two sources, because the two kinds of member are recorded differently: a
 * person is on the NIP-29 member list, while an agent is registered with the
 * channels it was added to. An agent that is *also* on the member list is
 * listed once, as an agent — it is the same participant either way, and a row
 * saying only "member" would hide the one fact a reader opened this list for.
 */
export function buildChannelRoster(input: {
  members: ChannelMember[];
  agents?: ShowcaseAgent[];
  /** The channel's name, which is how an agent records its channels. */
  channelName?: string | null;
}): ChannelRoster {
  const { agents = [], channelName, members } = input;
  const memberKeys = new Set(members.map((member) => member.pubkey));

  const inChannel = agents.filter(
    (agent) =>
      (channelName ? agent.channels.includes(channelName) : false) ||
      memberKeys.has(normalizePubkey(agent.pubkey)),
  );
  const agentKeys = new Set(
    inChannel.map((agent) => normalizePubkey(agent.pubkey)),
  );

  return {
    people: members.filter((member) => !agentKeys.has(member.pubkey)),
    agents: sortAgents(inChannel).map((agent) => ({
      pubkey: normalizePubkey(agent.pubkey),
      name: agent.name,
      status: agent.status,
      activity: agent.activity,
    })),
  };
}
