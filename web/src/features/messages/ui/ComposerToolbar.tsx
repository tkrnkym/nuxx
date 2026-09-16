import { useEditorState, type Editor } from "@tiptap/react";
import {
  Bold,
  Braces,
  Code,
  Italic,
  Link2,
  List,
  ListOrdered,
  Strikethrough,
  Unlink,
} from "lucide-react";
import { useState } from "react";

import { cn } from "@/shared/lib/cn";

/**
 * Formatting controls for the composer.
 *
 * Every control here produces something that survives `serializeToMarkdown` and
 * comes back out of the renderer — that is the whole selection rule, and it is
 * why there is no underline button: markdown has no underline, so the mark would
 * look applied while typing and be gone from the message anyone receives.
 *
 * The active states come through `useEditorState` rather than from the editor
 * directly. `useEditor` does not re-render on a transaction, so reading
 * `editor.isActive` in the render body would draw the states of whatever the
 * document looked like the last time something else re-rendered this tree.
 */
export function ComposerToolbar({
  disabled = false,
  editor,
}: {
  disabled?: boolean;
  editor: Editor | null;
}) {
  const [linkDraft, setLinkDraft] = useState<string | null>(null);

  const active = useEditorState({
    editor,
    selector: ({ editor: instance }) => ({
      bold: instance?.isActive("bold") ?? false,
      bulletList: instance?.isActive("bulletList") ?? false,
      code: instance?.isActive("code") ?? false,
      codeBlock: instance?.isActive("codeBlock") ?? false,
      italic: instance?.isActive("italic") ?? false,
      link: instance?.isActive("link") ?? false,
      orderedList: instance?.isActive("orderedList") ?? false,
      strike: instance?.isActive("strike") ?? false,
    }),
  });

  if (!editor) return null;

  const run = (apply: (chain: ReturnType<Editor["chain"]>) => void) => {
    const chain = editor.chain().focus();
    apply(chain);
  };

  const applyLink = () => {
    const href = linkDraft?.trim() ?? "";
    setLinkDraft(null);
    if (!href) return;
    // Only the schemes the renderer will activate — see `link-safety.ts`. A
    // bare domain is the common case, and left alone it would resolve against
    // this app's own origin.
    const url = /^(https?|mailto):/i.test(href) ? href : `https://${href}`;
    run((chain) => chain.extendMarkRange("link").setLink({ href: url }).run());
  };

  return (
    <div className="flex flex-col gap-1 border-b border-border px-1.5 py-1">
      <div className="flex flex-wrap items-center gap-0.5">
        <ToolbarButton
          active={active?.bold}
          disabled={disabled}
          label="太字"
          onClick={() => run((chain) => chain.toggleBold().run())}
        >
          <Bold aria-hidden className="size-3.5" />
        </ToolbarButton>
        <ToolbarButton
          active={active?.italic}
          disabled={disabled}
          label="斜体"
          onClick={() => run((chain) => chain.toggleItalic().run())}
        >
          <Italic aria-hidden className="size-3.5" />
        </ToolbarButton>
        <ToolbarButton
          active={active?.strike}
          disabled={disabled}
          label="取り消し線"
          onClick={() => run((chain) => chain.toggleStrike().run())}
        >
          <Strikethrough aria-hidden className="size-3.5" />
        </ToolbarButton>

        <Divider />

        <ToolbarButton
          active={active?.link || linkDraft !== null}
          disabled={disabled}
          label={active?.link ? "リンクを編集" : "リンク"}
          onClick={() => {
            if (linkDraft !== null) {
              setLinkDraft(null);
              return;
            }
            const href = editor.getAttributes("link").href;
            setLinkDraft(typeof href === "string" ? href : "");
          }}
        >
          <Link2 aria-hidden className="size-3.5" />
        </ToolbarButton>
        {active?.link && (
          <ToolbarButton
            disabled={disabled}
            label="リンクを外す"
            onClick={() =>
              run((chain) => chain.extendMarkRange("link").unsetLink().run())
            }
          >
            <Unlink aria-hidden className="size-3.5" />
          </ToolbarButton>
        )}

        <Divider />

        <ToolbarButton
          active={active?.orderedList}
          disabled={disabled}
          label="番号付きリスト"
          onClick={() => run((chain) => chain.toggleOrderedList().run())}
        >
          <ListOrdered aria-hidden className="size-3.5" />
        </ToolbarButton>
        <ToolbarButton
          active={active?.bulletList}
          disabled={disabled}
          label="箇条書き"
          onClick={() => run((chain) => chain.toggleBulletList().run())}
        >
          <List aria-hidden className="size-3.5" />
        </ToolbarButton>

        <Divider />

        <ToolbarButton
          active={active?.code}
          disabled={disabled}
          label="インラインコード"
          onClick={() => run((chain) => chain.toggleCode().run())}
        >
          <Code aria-hidden className="size-3.5" />
        </ToolbarButton>
        <ToolbarButton
          active={active?.codeBlock}
          disabled={disabled}
          label="コードブロック"
          onClick={() => run((chain) => chain.toggleCodeBlock().run())}
        >
          <Braces aria-hidden className="size-3.5" />
        </ToolbarButton>
      </div>

      {/* An inline field rather than a popup: the selection the link applies to
          is in the editor, and anything that takes focus through a portal has to
          restore it exactly, or the mark lands on the wrong range. */}
      {linkDraft !== null && (
        <div className="flex items-center gap-1 pb-0.5">
          <input
            aria-label="リンク先"
            className="min-w-0 flex-1 rounded-md border border-input bg-transparent px-2 py-1 text-xs focus:outline-none focus:ring-1 focus:ring-ring"
            onChange={(event) => setLinkDraft(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter") {
                event.preventDefault();
                applyLink();
              }
              if (event.key === "Escape") {
                event.preventDefault();
                setLinkDraft(null);
              }
            }}
            placeholder="https://example.com"
            // Focused on mount rather than through `autoFocus`: the field is
            // rendered only while the reader is filling it in, so there is no
            // moment where it steals focus from something they were using.
            ref={(node) => node?.focus()}
            value={linkDraft}
          />
          <button
            className="rounded-md px-2 py-1 text-xs text-muted-foreground hover:bg-accent hover:text-foreground"
            onClick={applyLink}
            type="button"
          >
            適用
          </button>
        </div>
      )}
    </div>
  );
}

function Divider() {
  return <span aria-hidden className="mx-1 h-4 w-px bg-border" />;
}

function ToolbarButton({
  active = false,
  children,
  disabled,
  label,
  onClick,
}: {
  active?: boolean;
  children: React.ReactNode;
  disabled?: boolean;
  label: string;
  onClick: () => void;
}) {
  return (
    <button
      aria-label={label}
      aria-pressed={active}
      className={cn(
        "flex size-7 items-center justify-center rounded-md text-muted-foreground",
        "hover:bg-accent hover:text-foreground disabled:opacity-50",
        active && "bg-accent text-foreground",
      )}
      disabled={disabled}
      // The button must not take focus: the editor's selection is what the
      // command applies to, and a blur collapses it.
      onMouseDown={(event) => event.preventDefault()}
      onClick={onClick}
      title={label}
      type="button"
    >
      {children}
    </button>
  );
}
