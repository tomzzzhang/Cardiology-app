const PLACEHOLDERS = ['tbd', 'todo', 'fixme', 'unknown', 'n/a', 'na', 'xxx', 'placeholder', '???'];

/**
 * A value is a placeholder when it *is* one of the tokens above, or *opens* with
 * one at a word boundary — "TBD", "TBD - ask the vetter", "TODO: licence".
 *
 * Anchored at the start rather than matched anywhere in the string on purpose: a
 * substring match would flag legitimate attribution text that merely contains
 * one of these letter sequences, and a false failure on the licence gate is
 * worse than a missed lazy placeholder.
 */
export function isPlaceholder(value: string): boolean {
  const normalized = value.trim().toLowerCase();
  if (normalized.length === 0) return false;
  return PLACEHOLDERS.some(
    (token) =>
      normalized === token ||
      (normalized.startsWith(token) && /^[\s:;,._-]/.test(normalized.slice(token.length))),
  );
}
