import { useState } from "react";

import type { TimelineRow } from "@/features/chat/timeline";
import { MessageContent } from "@/features/chat/ui/MessageContent";
import type { ThreadSummary } from "@/features/messages/lib/thread-summary";
import { MessageActionBar } from "@/features/messages/ui/MessageActionBar";
import { MessageEditor } from "@/features/messages/ui/MessageEditor";
import { MessageReactions } from "@/features/messages/ui/MessageReactions";
import { MessageTimestamp } from "@/features/messages/ui/MessageTimestamp";
import { ThreadSummaryRow } from "@/features/messages/ui/ThreadSummaryRow";
import { MessageModerationMenu } from "@/features/moderation/ui/MessageModerationMenu";
import {
  resolveAvatarUrl,
  resolveUserLabel,
  type ProfileLookup,
} from "@/features/profile/profile-model";
import type { CustomEmoji, EmojiCatalog } from "@/features/emoji/emoji-model";
import { cn } from "@/shared/lib/cn";
import { PresenceBadge } from "@/shared/ui/PresenceBadge";
import { PubkeyAvatar } from "@/shared/ui/PubkeyAvatar";

/** Width of the avatar gutter. Continuations align their time inside it. */
const GUTTER = "w-9";

export interface MessageRowActions {
  /** Presence for an author, or null when unknown. */
  statusOf: (pubkey: string) => string | null;
  /** The workspace emoji palette, for the reaction picker. */
  emojiCatalog: EmojiCatalog;
  onToggleReaction: (input: {
    messageId: string;
    emoji: string;
    myReactionId?: string;
    /** A custom emoji's definition, which the kind:7 has to carry. */
    definition?: CustomEmoji;
  }) => void;
  onReply: (row: TimelineRow) => void;
  onOpenThread: (rootId: string) => void;
  onCopyLink: (row: TimelineRow) => void;
  onEdit: (input: { messageId: string; content: string }) => void;
  onDelete: (row: TimelineRow) => void;
  /** The reading user, for edit/delete permission. */
  myPubkey: string | null;
  /**
   * Resolved kind:0 metadata, for names and avatars.
   *
   * The whole cache rather than a per-row slice: rows read it by key, and
   * slicing per row would hand each one a fresh object on every delivered event.
   */
  profiles: ProfileLookup;
  pending?: boolean;
}

/**
 * One message, ported from the desktop client's `MessageRow`.
 *
 * A continuation — same author, inside the grouping window — drops the avatar
 * and the author line and shows only a hover-revealed time in the gutter. That
 * is the single biggest difference between a timeline that reads as conversation
 * and one that reads as a log, which is why the decision is made in
 * `timeline-items.ts` and tested there rather than guessed at here.
 */
export function MessageRow({
  actions,
  isContinuation,
  isFollowedByContinuation,
  row,
  threadSummary,
}: {
  actions: MessageRowActions;
  isContinuation: boolean;
  isFollowedByContinuation: boolean;
  row: TimelineRow;
  threadSummary?: ThreadSummary;
}) {
  const { message } = row;
  const [editing, setEditing] = useState(false);

  if (row.deleted) {
    // A tombstone is shown rather than the row vanishing: a reader following a
    // reply needs to see that the parent existed and was removed.
    return (
      <div className="flex gap-2 px-4 py-1">
        <span aria-hidden className={cn(GUTTER, "shrink-0")} />
        <p className="text-sm italic text-muted-foreground">
          Message deleted
          {row.deletedReason ? ` — ${row.deletedReason}` : ""}
        </p>
      </div>
    );
  }

  const isMine =
    actions.myPubkey !== null &&
    message.pubkey.toLowerCase() === actions.myPubkey.toLowerCase();
  // The author's own name, never "You": a timeline where your messages are
  // labelled "You" and everyone else's carry a name reads as two conversations.
  const authorLabel = resolveUserLabel({
    pubkey: message.pubkey,
    profiles: actions.profiles,
    preferResolvedSelfLabel: true,
  });

  return (
    // A `div`, not an `li`: the virtualizer supplies the list item wrapper, and
    // nesting one here would put an `li` inside an `li`.
    <div
      className={cn(
        "group/message relative flex gap-2 px-4 hover:bg-accent/40",
        isContinuation ? "pt-0.5" : "pt-2",
        isFollowedByContinuation ? "pb-0.5" : "pb-1.5",
      )}
      data-message-id={message.id}
      data-testid={`message-${message.id}`}
    >
      <div className={cn(GUTTER, "shrink-0 pt-0.5")}>
        {isContinuation ? (
          // The time takes the avatar's place, revealed on approach so a burst
          // of messages stays a clean column while reading.
          <span className="flex justify-end pr-1 opacity-0 transition-opacity group-hover/message:opacity-100">
            <MessageTimestamp createdAt={message.createdAt} hideDayPeriod />
          </span>
        ) : (
          <PubkeyAvatar
            avatarUrl={resolveAvatarUrl(message.pubkey, actions.profiles)}
            badge={<PresenceBadge status={actions.statusOf(message.pubkey)} />}
            label={authorLabel}
            pubkey={message.pubkey}
          />
        )}
      </div>

      <div className="min-w-0 flex-1">
        {!isContinuation && (
          <div className="flex items-baseline gap-2">
            <span className="text-base font-semibold">{authorLabel}</span>
            <MessageTimestamp createdAt={message.createdAt} />
            {row.edited && (
              <span className="text-2xs text-muted-foreground">(edited)</span>
            )}
          </div>
        )}

        {editing ? (
          <MessageEditor
            initialContent={row.content}
            onCancel={() => setEditing(false)}
            onSubmit={(content) => {
              actions.onEdit({ messageId: message.id, content });
              setEditing(false);
            }}
            pending={actions.pending}
          />
        ) : (
          <div className="break-words">
            <MessageContent
              content={row.content}
              emojiUrls={message.emoji}
              imeta={message.imeta}
            />
            {/* On a continuation the "(edited)" marker has no header to live in,
                so it trails the body instead of being dropped. */}
            {isContinuation && row.edited && (
              <span className="ml-1 text-2xs text-muted-foreground">
                (edited)
              </span>
            )}
          </div>
        )}

        <MessageReactions
          disabled={actions.pending}
          onToggle={({ emoji, myReactionId }) =>
            actions.onToggleReaction({
              messageId: message.id,
              emoji,
              myReactionId,
            })
          }
          reactions={row.reactions}
        />

        {threadSummary && (
          <ThreadSummaryRow
            onOpenThread={() => actions.onOpenThread(message.id)}
            profiles={actions.profiles}
            summary={threadSummary}
          />
        )}
      </div>

      {!editing && (
        <MessageActionBar
          canManage={isMine}
          disabled={actions.pending}
          emojiCatalog={actions.emojiCatalog}
          onCopyLink={() => actions.onCopyLink(row)}
          onDelete={() => actions.onDelete(row)}
          onEdit={() => setEditing(true)}
          onReact={(emoji, definition) => {
            const existing = row.reactions.find(
              (reaction) => reaction.emoji === emoji,
            );
            actions.onToggleReaction({
              messageId: message.id,
              emoji,
              myReactionId: existing?.mine ? existing.myReactionId : undefined,
              ...(definition ? { definition } : {}),
            });
          }}
          onReply={() => actions.onReply(row)}
          reactedEmojis={row.reactions.map((reaction) => reaction.emoji)}
          // Omitted on the reader's own message: there is nothing on that menu
          // that applies to yourself, and mounting it would still run its queries.
          moderationMenu={
            isMine ? undefined : (
              <MessageModerationMenu
                authorPubkey={message.pubkey}
                messageId={message.id}
              />
            )
          }
        />
      )}
    </div>
  );
}
