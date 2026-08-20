/**
 * The rule that keeps a hover hint a hint.
 *
 * A card is a LABEL, not a paragraph. Most `title`s in this app carry the
 * reasoning as well as the action — that is where the reasoning belongs — and a
 * card reproducing all of it would be worse than the native tooltip it
 * replaced. This is the rule that decides which controls need a short
 * `data-hint` written for them, and the Playwright suite applies it to every
 * control on the page.
 */
import { describe, expect, it } from 'vitest';
import { HINT_DELAY_MS, conciseHint } from '../../src/ui/hintText.ts';

describe('the delay', () => {
  it('is one second', () => {
    // Long enough that a sweep across a control row leaves no trail of cards;
    // short enough that a pause gets an answer before the learner clicks to
    // find out instead.
    expect(HINT_DELAY_MS).toBe(1000);
  });
});

describe('an authored hint wins outright', () => {
  it('is used even when a long title is also present', () => {
    expect(conciseHint('Reverse the cut.', 'A paragraph about why. '.repeat(12)))
      .toBe('Reverse the cut.');
  });

  it('is trimmed', () => {
    expect(conciseHint('  Reverse the cut.  ', '')).toBe('Reverse the cut.');
  });
});

describe('otherwise the title, cut at the first sentence if it must be', () => {
  it('uses a short title whole', () => {
    expect(conciseHint(undefined, 'Hold the heart’s long axis vertical while orbiting'))
      .toBe('Hold the heart’s long axis vertical while orbiting');
  });

  it('takes the first sentence of a long one', () => {
    const title = 'Turn the model to face the echo’s imaging plane. Camera only, and the '
      + 'model does not move under the learner.';
    expect(conciseHint(undefined, title))
      .toBe('Turn the model to face the echo’s imaging plane.');
  });

  it('DROPS a hint whose first sentence is itself too long, rather than truncating', () => {
    // Half a sentence in a card is worse than no card. An empty result is the
    // signal to write a `data-hint` for that control, which is what the
    // Playwright check turns into a failure.
    const title = 'Put the probe on the axis you are looking down, aimed at the model, at a '
      + 'standoff derived from the model and the fan angle.';
    expect(conciseHint(undefined, title)).toBe('');
  });

  it('is empty when there is nothing to say', () => {
    expect(conciseHint(undefined, '')).toBe('');
    expect(conciseHint('   ', '   ')).toBe('');
  });

  it('handles a title with no sentence-ending punctuation at all', () => {
    const title = 'x'.repeat(200);
    expect(conciseHint(undefined, title)).toBe('');
    expect(conciseHint(undefined, 'x'.repeat(80))).toBe('x'.repeat(80));
  });
});
