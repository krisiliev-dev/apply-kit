// Discoverable shortcut binding for the inline-comments feature. The
// keyboard handler lives in `useEditorShortcuts`; this file just exports
// the binding metadata so the infra-polish agent's cheatsheet modal can
// pick it up (or any future help-surface) without having to grep the
// editor shortcuts file.

export const OPEN_COMMENT_SHORTCUT = {
  key: "C",
  label: "Add comment on selected node",
  scope: "editor" as const,
  /**
   * Clients can dispatch this event on `window` to open the comment thread
   * anchored to `nodeId` — the CommentLayer listens for it.
   */
  event: "cv:open-comment-thread" as const,
};

export type OpenCommentEventDetail = { nodeId: string };
