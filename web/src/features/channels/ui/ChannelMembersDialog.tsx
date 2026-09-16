import { Bot } from "lucide-react";

import {
  AGENT_STATUS_DOT,
  AGENT_STATUS_LABELS,
} from "@/features/agents/agent-model";
import type {
  ChannelAgent,
  ChannelRoster,
} from "@/features/channels/channel-members";
import {
  resolveAvatarUrl,
  resolveUserLabel,
  resolveUserSecondaryLabel,
  type ProfileLookup,
} from "@/features/profile/profile-model";
import { cn } from "@/shared/lib/cn";
import { Dialog } from "@/shared/ui/dialog";
import { PresenceBadge } from "@/shared/ui/PresenceBadge";
import { PubkeyAvatar } from "@/shared/ui/PubkeyAvatar";

/**
 * Who is in this channel.
 *
 * People and agents in two sections rather than one mixed list, because the two
 * answer different questions: a person is someone to address, and an agent is
 * something that is either running or not. Merging them would mean one column of
 * status meaning two things.
 *
 * Roles are shown only where they are not the default. A column of "member"
 * chips is the same information as no chips at all, and it buries the one or two
 * rows that do carry authority.
 */
export function ChannelMembersDialog({
  channelLabel,
  myPubkey,
  onClose,
  open,
  presenceOf,
  profiles,
  roster,
}: {
  /** The channel's name, for the dialog's subtitle. */
  channelLabel: string | null;
  onClose: () => void;
  open: boolean;
  presenceOf: (pubkey: string) => string | null;
  profiles: ProfileLookup;
  roster: ChannelRoster;
  /** The reader, so their own row reads as themselves. */
  myPubkey?: string | null;
}) {
  const total = roster.people.length + roster.agents.length;

  return (
    <Dialog
      description={channelLabel ? `#${channelLabel} · ${total}人` : undefined}
      onClose={onClose}
      open={open}
      testId="channel-members-dialog"
      title="チャンネルのメンバー"
    >
      {total === 0 ? (
        <p className="py-6 text-center text-xs text-muted-foreground">
          メンバーはまだいません。
        </p>
      ) : (
        <div className="flex max-h-[60vh] flex-col gap-4 overflow-y-auto">
          {roster.people.length > 0 && (
            <Section title={`メンバー · ${roster.people.length}`}>
              {roster.people.map((member) => (
                <PersonRow
                  key={member.pubkey}
                  member={member}
                  myPubkey={myPubkey}
                  presence={presenceOf(member.pubkey)}
                  profiles={profiles}
                />
              ))}
            </Section>
          )}

          {roster.agents.length > 0 && (
            <Section title={`エージェント · ${roster.agents.length}`}>
              {roster.agents.map((agent) => (
                <AgentRow agent={agent} key={agent.pubkey} />
              ))}
            </Section>
          )}
        </div>
      )}
    </Dialog>
  );
}

function Section({
  children,
  title,
}: {
  children: React.ReactNode;
  title: string;
}) {
  return (
    <section>
      <h3 className="px-1 pb-1 text-2xs font-medium uppercase tracking-wide text-muted-foreground">
        {title}
      </h3>
      <ul className="flex flex-col">{children}</ul>
    </section>
  );
}

function PersonRow({
  member,
  myPubkey,
  presence,
  profiles,
}: {
  member: { pubkey: string; role: string };
  myPubkey?: string | null;
  presence: string | null;
  profiles: ProfileLookup;
}) {
  const label = resolveUserLabel({
    currentPubkey: myPubkey,
    profiles,
    pubkey: member.pubkey,
  });
  const handle = resolveUserSecondaryLabel({ profiles, pubkey: member.pubkey });

  return (
    <li className="flex items-center gap-2 rounded-md px-1 py-1.5">
      <PubkeyAvatar
        avatarUrl={resolveAvatarUrl(member.pubkey, profiles)}
        badge={<PresenceBadge status={presence} />}
        className="rounded-full"
        label={label}
        pubkey={member.pubkey}
        size="md"
      />
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm">{label}</p>
        {handle && (
          <p className="truncate text-2xs text-muted-foreground">{handle}</p>
        )}
      </div>
      {member.role !== "member" && (
        <span className="shrink-0 rounded-full border border-border px-2 py-0.5 text-badge text-muted-foreground">
          {member.role}
        </span>
      )}
    </li>
  );
}

function AgentRow({ agent }: { agent: ChannelAgent }) {
  return (
    <li className="flex items-center gap-2 rounded-md px-1 py-1.5">
      <PubkeyAvatar
        className="rounded-full"
        label={agent.name}
        pubkey={agent.pubkey}
        size="md"
      />
      <div className="min-w-0 flex-1">
        <p className="flex min-w-0 items-center gap-1 text-sm">
          <span className="truncate">{agent.name}</span>
          <Bot
            aria-label="エージェント"
            className="size-3.5 shrink-0 text-muted-foreground"
          />
        </p>
        {agent.activity && (
          <p className="truncate text-2xs text-muted-foreground">
            {agent.activity}
          </p>
        )}
      </div>
      <span className="flex shrink-0 items-center gap-1.5 text-badge text-muted-foreground">
        <span
          aria-hidden
          className={cn(
            "size-1.5 rounded-full",
            AGENT_STATUS_DOT[agent.status],
          )}
        />
        {AGENT_STATUS_LABELS[agent.status]}
      </span>
    </li>
  );
}
