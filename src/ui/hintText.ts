/**
 * How long a hover hint waits, and how it is kept short.
 *
 * Split out of `HintLayer.tsx` so the rule can be tested without rendering
 * anything: "is this hint short enough to be a hint" is a question about a
 * string, and it is the question that decides whether a control needs a
 * `data-hint` written for it.
 */
/**
 * How long a pointer must rest on a control before its hint appears.
 *
 * One second. Long enough that a sweep across a control row does not leave a
 * trail of cards behind it, and short enough that somebody who has stopped to
 * wonder what a button does gets the answer before they give up and click it to
 * find out. Settled at one second after trying three and one and a half: the
 * longer values were long enough that the pause felt like nothing happening.
 */
export const HINT_DELAY_MS = 1000;

/**
 * Longest hint worth showing. A card is a label, not a paragraph.
 *
 * Controls whose full `title` carries the reasoning — most of them do, and that
 * is where the reasoning belongs — supply a short `data-hint` instead. Where
 * they do not, the FIRST SENTENCE of the title is used, which for a title
 * written as "what it does. why it does it." is exactly the useful half.
 */
const MAX_HINT_CHARS = 84;

/**
 * The concise form of a control's description.
 *
 * An authored `data-hint` wins outright. Otherwise the first sentence of the
 * title, and if even that runs long it is dropped rather than truncated: half a
 * sentence in a card is worse than no card, and a hint too long to be a hint is
 * a control that needs a `data-hint` written for it.
 */
export function conciseHint(authored: string | undefined, title: string): string {
  const short = authored?.trim();
  if (short) return short;

  const full = title.trim();
  if (full === '') return '';
  if (full.length <= MAX_HINT_CHARS) return full;

  const stop = full.search(/[.!?](\s|$)/);
  const first = stop === -1 ? full : full.slice(0, stop + 1);
  return first.length <= MAX_HINT_CHARS ? first : '';
}

