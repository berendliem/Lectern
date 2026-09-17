/**
 * What a keypress means in a study session, before the session decides what
 * to do about it. Shared by the review deck and the quiz so the two agree on
 * the one rule that matters: a key typed into a text field is text, not a
 * command — except Cmd/Ctrl+Enter, which is how a field is submitted.
 */
export type SessionKey =
  | { type: "enter" }
  | { type: "space" }
  | { type: "digit"; n: number }
  | { type: "prev" }
  | { type: "next" };

export type KeyInput = {
  key: string;
  metaKey: boolean;
  ctrlKey: boolean;
  /** Focus is in an input, textarea, select or contenteditable. */
  inField: boolean;
  /** Focus is on a button: Enter and Space already press it, so they are left alone. */
  onButton: boolean;
  /** Auto-repeat from a held key: one press is one command, however long it is held. */
  repeat?: boolean;
};

export function sessionKey({ key, metaKey, ctrlKey, inField, onButton, repeat }: KeyInput): SessionKey | null {
  if (repeat) return null;
  if (key === "Enter") {
    if (inField) return metaKey || ctrlKey ? { type: "enter" } : null;
    return onButton ? null : { type: "enter" };
  }
  if (inField || metaKey || ctrlKey) return null;
  if (key === " ") return onButton ? null : { type: "space" };
  if (/^[1-9]$/.test(key)) return { type: "digit", n: Number(key) };
  if (key === "ArrowLeft") return { type: "prev" };
  if (key === "ArrowRight") return { type: "next" };
  return null;
}

export function keyInputFromEvent(e: KeyboardEvent): KeyInput {
  const target = e.target as HTMLElement | null;
  const tag = target?.tagName;
  return {
    key: e.key,
    metaKey: e.metaKey,
    ctrlKey: e.ctrlKey,
    repeat: e.repeat,
    inField:
      tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT" || target?.isContentEditable === true,
    onButton: tag === "BUTTON" || tag === "A",
  };
}
