import Placeholder from "@tiptap/extension-placeholder";
import { EditorContent, useEditor, type Editor } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import { useEffect, useImperativeHandle, useRef, type Ref } from "react";

import { ComposerToolbar } from "@/features/messages/ui/ComposerToolbar";
import { cn } from "@/shared/lib/cn";

/**
 * The editing surface: TipTap, configured for chat.
 *
 * Split from `MessageComposer` on purpose. The composer owns what a message
 * *is* — recipients, attachments, drafts, the send — and this owns only how
 * text is entered. Keeping them apart is what lets the composer stay readable
 * now that it also drives two autocompletes.
 *
 * The document model is deliberately small: bold, italic, strike, inline code,
 * links, code blocks, lists, blockquotes and headings. Everything in it
 * survives the trip through `serializeToMarkdown` and back out through the
 * renderer, which is the only test that matters — a message is text on an
 * event, readable by clients that know nothing about this editor.
 */

export interface RichEditorHandle {
  /** Replace the range `[from, to)` of the current text block with `text`. */
  replaceRange: (from: number, to: number, text: string) => void;
  /** Insert at the caret. */
  insert: (text: string) => void;
  focus: () => void;
  clear: () => void;
  /** Plain text of the block the caret is in, and the caret's offset in it. */
  caretContext: () => { text: string; caret: number };
}

/** What the caller needs from a keystroke it might want to intercept. */
export type EditorKeyHandler = (event: KeyboardEvent) => boolean;

export function RichComposerEditor({
  ariaLabel,
  className,
  disabled = false,
  handleRef,
  initialMarkdown,
  onChange,
  onKeyDown,
  onSubmit,
  placeholder,
  showToolbar = false,
}: {
  ariaLabel: string;
  className?: string;
  disabled?: boolean;
  handleRef?: Ref<RichEditorHandle>;
  /**
   * Text to seed the editor with, as the author last left it.
   *
   * Inserted as text rather than parsed: the input rules turn `**bold**` back
   * into bold as it is typed, but a restored draft is not typing. Round-tripping
   * markdown would need a second parser, and losing the formatting is a smaller
   * lie than restoring it wrong.
   */
  initialMarkdown: string;
  onChange: (markdownSource: { editor: Editor }) => void;
  /** Return true to swallow the key — used by the mention and emoji pickers. */
  onKeyDown?: EditorKeyHandler;
  onSubmit: () => void;
  placeholder: string;
  /**
   * Show the formatting controls above the field.
   *
   * The toolbar lives here rather than in the composer because the editor
   * instance does — the commands it runs are the editor's, and handing that
   * instance out would make every consumer responsible for not holding it past
   * a remount.
   */
  showToolbar?: boolean;
}) {
  /**
   * The current callbacks, read through refs.
   *
   * `editorProps` and `onUpdate` are captured when the editor is created and are
   * not re-read on re-render, so calling the props directly would run the ones
   * from the first render forever — with the first render's `draft`, which is
   * empty. Enter-to-send silently did nothing until this was a ref.
   */
  const callbacks = useRef({ onChange, onKeyDown, onSubmit });
  callbacks.current = { onChange, onKeyDown, onSubmit };

  const editor = useEditor({
    editable: !disabled,
    extensions: [
      StarterKit.configure({
        // Headings above three have no styling in the renderer, so offering
        // them would produce text that looks like a heading here and like
        // nothing anywhere else.
        heading: { levels: [1, 2, 3] },
        link: {
          openOnClick: false,
          autolink: true,
          // Only the schemes the renderer will actually activate — see
          // `link-safety.ts`. Anything else would render as dead text.
          protocols: ["http", "https", "mailto"],
        },
      }),
      Placeholder.configure({ placeholder }),
    ],
    content: initialMarkdown
      ? { type: "doc", content: paragraphs(initialMarkdown) }
      : "",
    editorProps: {
      attributes: {
        "aria-label": ariaLabel,
        class: cn(
          "max-h-48 min-h-9 overflow-y-auto px-3 py-1.5 text-sm focus:outline-none",
          "[&_p]:min-h-5 [&_pre]:rounded-md [&_pre]:bg-muted [&_pre]:p-2 [&_pre]:text-2xs",
          "[&_code]:rounded [&_code]:bg-muted [&_code]:px-1 [&_blockquote]:border-l-2",
          "[&_blockquote]:border-border [&_blockquote]:pl-2 [&_ul]:list-disc [&_ul]:pl-5",
          "[&_ol]:list-decimal [&_ol]:pl-5",
        ),
        role: "textbox",
      },
      handleKeyDown: (_view, event) => {
        if (callbacks.current.onKeyDown?.(event)) return true;
        // Enter sends; Shift+Enter is a line break. A chat box where Enter
        // inserts a newline makes sending a two-key operation for every message.
        if (event.key === "Enter" && !event.shiftKey) {
          event.preventDefault();
          callbacks.current.onSubmit();
          return true;
        }
        return false;
      },
    },
    onUpdate: ({ editor: instance }) =>
      callbacks.current.onChange({ editor: instance }),
  });

  useEffect(() => {
    editor?.setEditable(!disabled);
  }, [editor, disabled]);

  useImperativeHandle(
    handleRef,
    (): RichEditorHandle => ({
      replaceRange: (from, to, text) => {
        if (!editor) return;
        const base = blockStart(editor);
        editor
          .chain()
          .focus()
          .insertContentAt({ from: base + from, to: base + to }, text)
          .run();
      },
      insert: (text) => editor?.chain().focus().insertContent(text).run(),
      focus: () => editor?.chain().focus().run(),
      clear: () => editor?.commands.clearContent(true),
      caretContext: () => {
        if (!editor) return { text: "", caret: 0 };
        const { $from } = editor.state.selection;
        return {
          text: $from.parent.textBetween(
            0,
            $from.parent.content.size,
            "\n",
            "",
          ),
          caret: $from.parentOffset,
        };
      },
    }),
    [editor],
  );

  return (
    <div
      className={cn(
        "min-w-0 flex-1 rounded-md border border-input bg-transparent shadow-xs",
        "focus-within:ring-1 focus-within:ring-ring",
        disabled && "cursor-not-allowed opacity-50",
        className,
      )}
      data-testid="rich-composer"
    >
      {showToolbar && <ComposerToolbar disabled={disabled} editor={editor} />}
      <EditorContent editor={editor} />
    </div>
  );
}

/** Offset of the current text block's first character in the document. */
function blockStart(editor: Editor): number {
  const { $from } = editor.state.selection;
  return $from.start();
}

/** Seed content: one paragraph per line, with no markup interpreted. */
function paragraphs(text: string) {
  return text.split("\n").map((line) => ({
    type: "paragraph",
    ...(line ? { content: [{ type: "text", text: line }] } : {}),
  }));
}
