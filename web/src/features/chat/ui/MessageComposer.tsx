import { type FormEvent, useCallback, useRef, useState } from "react";
import { CaseSensitive, Paperclip, Smile, X } from "lucide-react";

import { useMyPubkey, useSendMessage } from "@/features/chat/use-chat";
import { formatBytes } from "@/features/chat/upload";
import { useUpload } from "@/features/chat/use-upload";
import { useDirectory } from "@/features/directory/use-directory";
import { UserPicker } from "@/features/directory/ui/UserPicker";
import {
  activeEmojiQuery,
  emojiInsertText,
  emojiTagsForContent,
} from "@/features/emoji/emoji-model";
import { EmojiPicker } from "@/features/emoji/ui/EmojiPicker";
import { useEmojiCatalog } from "@/features/emoji/use-emoji";
import { serializeToMarkdown } from "@/features/messages/lib/markdown-serializer";
import {
  RichComposerEditor,
  type RichEditorHandle,
} from "@/features/messages/ui/RichComposerEditor";
import {
  readToolbarPreference,
  writeToolbarPreference,
} from "@/features/messages/lib/toolbar-preference";
import { useDraft } from "@/features/messages/use-draft";
import { ComposerTimeoutBanner } from "@/features/moderation/ui/ComposerTimeoutBanner";
import {
  clearTimeoutState,
  recordTimeoutFromRejection,
  useTimeoutState,
} from "@/features/moderation/timeout-store";
import {
  activeMentionQuery,
  mentionInsertText,
  mentionRecipients,
  mentionTags,
  survivingMentions,
} from "@/features/messages/lib/mentions";
import { useProfiles } from "@/features/profile/profile-store";
import { useUserLabels } from "@/features/profile/use-user-label";
import { Button } from "@/shared/ui/button";
import { Popover, PopoverAnchor, PopoverContent } from "@/shared/ui/popover";

export interface ReplyTarget {
  rootId: string;
  parentId: string;
  authorPubkey: string;
  preview: string;
}

/** Stable empty list, so the label hook is not re-run on every render. */
const EMPTY_PUBKEYS: string[] = [];

export function MessageComposer({
  channelId,
  channelName,
  channelParticipants,
  isDm = false,
  replyTo,
  onCancelReply,
  onComposing,
  onSent,
}: {
  channelId: string;
  channelName: string;
  /** A DM's participants, who are addressed whether or not the text names them. */
  channelParticipants?: string[];
  /** A DM is addressed by a person's name, not by a hashed channel name. */
  isDm?: boolean;
  replyTo: ReplyTarget | null;
  onCancelReply: () => void;
  /** Called as the user types; throttling is the caller's business. */
  onComposing: (thread?: { rootId: string; parentId: string }) => void;
  /** Called once a message lands, so this author stops showing as typing. */
  onSent: (input: { pubkey: string; threadHeadId: string | null }) => void;
}) {
  // The composer's text lives in `useDraft`: it survives a channel switch and a
  // reload, and stays in this browser rather than becoming an event — see
  // `lib/drafts.ts` for why.
  const {
    text: draft,
    setText: updateDraft,
    clear: clearDraft,
  } = useDraft({
    channelId,
    threadRootId: replyTo?.rootId ?? null,
  });
  const sendMessage = useSendMessage(channelId);
  // A community timeout is learned from a refused send, not read ahead of time —
  // see `moderation-model`. So the composer stays enabled until the relay says
  // otherwise, and the banner appears on the first refusal.
  const timeoutState = useTimeoutState();
  const upload = useUpload();
  const fileInput = useRef<HTMLInputElement>(null);
  const editorRef = useRef<RichEditorHandle | null>(null);
  const myPubkey = useMyPubkey();
  const directory = useDirectory();
  const directoryProfiles = useProfiles([]);
  const emojiCatalog = useEmojiCatalog();
  // Shown unless the reader has turned it off — see `toolbar-preference` for
  // why that is the default and why the choice is local.
  const [showToolbar, setShowToolbar] = useState(readToolbarPreference);
  const [emojiOpen, setEmojiOpen] = useState(false);
  /** The `:name` token being typed, which completes without opening the grid. */
  const [emojiQuery, setEmojiQuery] = useState<{
    query: string;
    from: number;
  } | null>(null);
  /**
   * Mentions inserted through the picker, with the label each one wrote.
   *
   * Kept here rather than derived from the text on send: two people can share a
   * display name, so parsing `@Name` back to a pubkey is ambiguous. What the
   * author *chose* is unambiguous, and `survivingMentions` drops any whose text
   * they then deleted.
   */
  const insertedMentions = useRef<{ pubkey: string; label: string }[]>([]);
  const [mention, setMention] = useState<{
    query: string;
    from: number;
  } | null>(null);
  const pickerKeyHandler = useRef<((event: KeyboardEvent) => boolean) | null>(
    null,
  );

  /**
   * Re-read the token under the caret from the editor.
   *
   * Both autocompletes work on the plain text of the block the caret is in.
   * That is the honest unit: a mention cannot span a paragraph, and reading the
   * whole document would make an `@` two blocks up look like the one being
   * typed.
   */
  const syncQueries = useCallback(() => {
    const context = editorRef.current?.caretContext();
    if (!context) return;
    const mentionAt = activeMentionQuery(context.text, context.caret);
    setMention(mentionAt);
    // A mention wins: `@` and `:` cannot both be the token under the caret, and
    // showing two floating lists at once would be a guess about which.
    setEmojiQuery(
      mentionAt ? null : activeEmojiQuery(context.text, context.caret),
    );
  }, []);

  /** Insert at the caret, replacing the `:name` token if one is open. */
  const insertEmoji = useCallback(
    (text: string) => {
      const editor = editorRef.current;
      if (!editor) return;
      if (emojiQuery) {
        const caret = editor.caretContext().caret;
        editor.replaceRange(emojiQuery.from, caret, text);
      } else {
        editor.insert(text);
      }
      setEmojiQuery(null);
      setEmojiOpen(false);
    },
    [emojiQuery],
  );

  const pickMention = useCallback(
    (entry: { pubkey: string; label: string }) => {
      const editor = editorRef.current;
      if (!mention || !editor) return;
      const caret = editor.caretContext().caret;
      editor.replaceRange(mention.from, caret, mentionInsertText(entry.label));
      insertedMentions.current = [
        ...insertedMentions.current,
        { pubkey: entry.pubkey, label: entry.label },
      ];
      setMention(null);
      setEmojiQuery(null);
    },
    [mention],
  );
  // The person being replied to. `labelOf`, so replying to yourself reads
  // "Reply to You" rather than repeating your own name back at you.
  const { labelOf } = useUserLabels(
    replyTo ? [replyTo.authorPubkey] : EMPTY_PUBKEYS,
  );
  const replyToLabel = replyTo ? labelOf(replyTo.authorPubkey) : "";

  const onPickFile = async (file: File | undefined) => {
    if (!file) return;
    const markdown = await upload.attach(file);
    // The renderer keys `imeta` off the URL in the body, so an attachment that
    // never reaches the text is invisible however complete its tag is.
    if (markdown) editorRef.current?.insert(markdown);
  };

  const submit = (submitEvent?: FormEvent) => {
    submitEvent?.preventDefault();
    const content = draft.trim();
    // An attachment is a message on its own; requiring a caption would mean a
    // picture could not be posted without one.
    if (
      (!content && upload.attachments.length === 0) ||
      sendMessage.isPending
    ) {
      return;
    }
    const recipients = mentionRecipients({
      channelParticipants,
      explicitMentions: survivingMentions(content, insertedMentions.current),
      isDm,
      senderPubkey: myPubkey,
    });

    // Clear only after the relay accepts: a rejected send must not lose the
    // author's text or make them upload again.
    sendMessage.mutate(
      {
        content,
        attachments: [
          ...upload.attachments.map((attachment) => attachment.imeta),
          ...mentionTags(recipients),
          // NIP-30 requires the definition to travel with the event: a reader
          // whose client has never seen the author's set still has to render it.
          ...emojiTagsForContent(content, emojiCatalog),
        ],
        ...(replyTo
          ? { thread: { rootId: replyTo.rootId, parentId: replyTo.parentId } }
          : {}),
      },
      {
        onError: (error) => {
          // A timeout refusal becomes the banner instead of a toast: the reason
          // the send failed is a state the author is in, not a one-off event, and
          // a toast that vanishes leaves them retyping into a composer that is
          // still blocked.
          recordTimeoutFromRejection(
            error instanceof Error ? error.message : null,
          );
        },
        onSuccess: (event) => {
          // An accepted send is proof the block is gone, which is the only signal
          // there is — the relay never announces the end of a timeout.
          clearTimeoutState();
          // Only on success: a rejected send has to leave the text where the
          // author can still see it.
          clearDraft();
          editorRef.current?.clear();
          upload.clear();
          insertedMentions.current = [];
          setMention(null);
          setEmojiQuery(null);
          onSent({
            pubkey: event.pubkey,
            threadHeadId: replyTo?.parentId ?? null,
          });
          // The reply target deliberately survives the send. It is bound to the
          // open thread panel now, so clearing it here would drop the reader out
          // of the thread they are in the middle of — and their next message
          // would land in the channel instead. Closing the panel is what ends
          // the reply.
        },
      },
    );
  };

  const label = replyTo
    ? `Reply to ${replyToLabel}`
    : // No hash for a DM: the label is a person's name, and "Message #Alice" reads
      // as a channel that does not exist.
      `Message ${isDm ? "" : "#"}${channelName}`;

  return (
    <form
      onSubmit={submit}
      className="flex flex-col gap-1 border-t border-border px-4 py-3"
    >
      {timeoutState.active && (
        <ComposerTimeoutBanner expiresAtMs={timeoutState.expiresAtMs} />
      )}

      {replyTo && (
        <div className="flex items-center gap-2 rounded-md bg-secondary px-2 py-1">
          <span className="min-w-0 flex-1 truncate text-2xs text-secondary-foreground">
            Replying to {replyToLabel}: {replyTo.preview}
          </span>
          <button
            type="button"
            onClick={onCancelReply}
            aria-label="Cancel reply"
            className="text-muted-foreground hover:text-foreground"
          >
            <X aria-hidden className="size-3.5" />
          </button>
        </div>
      )}

      {upload.attachments.length > 0 && (
        <ul className="flex flex-wrap gap-1.5">
          {upload.attachments.map((attachment) => (
            <li
              key={attachment.descriptor.sha256}
              className="flex items-center gap-1.5 rounded-md bg-secondary px-2 py-1"
            >
              <span className="max-w-40 truncate text-2xs text-secondary-foreground">
                {attachment.filename}
              </span>
              <span className="text-2xs text-muted-foreground">
                {formatBytes(attachment.descriptor.size)}
              </span>
              <button
                type="button"
                onClick={() => upload.remove(attachment.descriptor.sha256)}
                aria-label={`Remove ${attachment.filename}`}
                className="text-muted-foreground hover:text-foreground"
              >
                <X aria-hidden className="size-3" />
              </button>
            </li>
          ))}
        </ul>
      )}

      {mention && (
        <div className="relative">
          <UserPicker
            className="absolute bottom-1 left-0 w-72"
            emptyLabel="Nobody here matches that."
            entries={directory}
            onPick={pickMention}
            profiles={directoryProfiles}
            query={mention.query}
            registerKeyHandler={(handler) => {
              pickerKeyHandler.current = handler;
            }}
          />
        </div>
      )}

      {/* Anchored to the composer rather than opened by a trigger: the picker
          also appears from typing `:shortcode`, so its open state is the
          composer's, not a button's. `onOpenAutoFocus` is prevented because the
          reader is still typing into the editor — moving focus into the panel
          would end the very query that opened it. */}
      <Popover
        onOpenChange={(open) => {
          if (open) return;
          // Both sources have to be cleared, or dismissing a panel that a typed
          // `:shortcode` opened would reopen it on the next render.
          setEmojiOpen(false);
          setEmojiQuery(null);
        }}
        open={emojiOpen || emojiQuery !== null}
      >
        <PopoverAnchor />
        <PopoverContent
          align="start"
          className="w-64 p-2"
          onOpenAutoFocus={(event) => event.preventDefault()}
          side="top"
        >
          <EmojiPicker
            catalog={emojiCatalog}
            onPick={(choice) =>
              insertEmoji(
                choice.emoji
                  ? emojiInsertText(choice.emoji.shortcode)
                  : choice.text,
              )
            }
          />
        </PopoverContent>
      </Popover>

      {/* Bottom-aligned: with the formatting toolbar shown the field is two rows
          tall, and centring would float the send button against the middle of
          it rather than beside the line being typed. */}
      <div className="flex items-end gap-2">
        <input
          ref={fileInput}
          type="file"
          className="sr-only"
          aria-label="Attach a file"
          onChange={(changeEvent) => {
            void onPickFile(changeEvent.target.files?.[0]);
            // Reset so picking the same file again still fires a change.
            changeEvent.target.value = "";
          }}
        />
        <Button
          type="button"
          variant="ghost"
          size="icon"
          aria-label="Attach a file"
          disabled={upload.isUploading || sendMessage.isPending}
          onClick={() => fileInput.current?.click()}
        >
          <Paperclip aria-hidden className="size-4" />
        </Button>
        <Button
          type="button"
          variant="ghost"
          size="icon"
          aria-label="書式ツールバー"
          aria-pressed={showToolbar}
          className={showToolbar ? "bg-accent text-foreground" : undefined}
          data-testid="toggle-composer-toolbar"
          onClick={() =>
            setShowToolbar((visible) => {
              writeToolbarPreference(!visible);
              return !visible;
            })
          }
        >
          <CaseSensitive aria-hidden className="size-4" />
        </Button>
        <Button
          type="button"
          variant="ghost"
          size="icon"
          aria-label="Add an emoji"
          data-testid="open-emoji-picker"
          disabled={sendMessage.isPending}
          onClick={() => {
            setEmojiQuery(null);
            setEmojiOpen((open) => !open);
          }}
        >
          <Smile aria-hidden className="size-4" />
        </Button>
        <RichComposerEditor
          ariaLabel={label}
          // Remounted when the composer is re-pointed, so the editor is seeded
          // with the draft belonging to the room it now writes into.
          key={`${channelId}:${replyTo?.rootId ?? ""}`}
          disabled={sendMessage.isPending}
          handleRef={editorRef}
          initialMarkdown={draft}
          onChange={({ editor }) => {
            const markdown = serializeToMarkdown(editor.getJSON());
            updateDraft(markdown);
            syncQueries();
            if (markdown.trim()) {
              onComposing(
                replyTo
                  ? { rootId: replyTo.rootId, parentId: replyTo.parentId }
                  : undefined,
              );
            }
          }}
          onKeyDown={(keyEvent) => {
            // The picker moves its own highlight but never takes focus: pulling
            // focus off the field to arrow through a list would interrupt
            // typing, and in a rich editor it would also drop the selection.
            if (mention && pickerKeyHandler.current?.(keyEvent)) return true;
            if (keyEvent.key === "Escape" && (mention || emojiQuery)) {
              setMention(null);
              setEmojiQuery(null);
              return true;
            }
            return false;
          }}
          onSubmit={() => submit()}
          placeholder={label}
          showToolbar={showToolbar}
        />
        <Button
          type="submit"
          disabled={
            (!draft.trim() && upload.attachments.length === 0) ||
            sendMessage.isPending
          }
        >
          {sendMessage.isPending ? "Sending…" : "Send"}
        </Button>
      </div>

      {upload.isUploading && (
        <p className="text-2xs text-muted-foreground">Uploading…</p>
      )}

      {upload.error && (
        <p className="text-2xs text-destructive">
          {upload.error}{" "}
          <button
            type="button"
            onClick={upload.dismissError}
            className="underline"
          >
            Dismiss
          </button>
        </p>
      )}

      {/* Suppressed while timed out: the banner above already says why, and the
          relay's raw refusal ("restricted: you are timed out until 1750…") is not
          a sentence to show anyone. */}
      {sendMessage.error && !timeoutState.active && (
        <p className="text-2xs text-destructive">
          {sendMessage.error instanceof Error
            ? sendMessage.error.message
            : "Send failed"}
        </p>
      )}
    </form>
  );
}
