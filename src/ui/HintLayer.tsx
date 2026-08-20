/**
 * One hover hint for every control on the page, after a deliberate pause.
 *
 * ## Why not just leave it to `title`
 *
 * Every control here already carries a `title`, and the browser already shows
 * it — badly, and differently on every platform. The native tip fires after
 * about a second, renders in the OS's own type at the OS's own size, wraps
 * where it likes, and cannot be styled at all. On a screen where the controls
 * are 0.85 rem and the panels are a measured pair, an unstyled system tooltip
 * is the one element that looks like it came from somewhere else.
 *
 * ## Why there is a delay at all
 *
 * A hint that appears immediately appears while the pointer is on its way
 * somewhere else, so a sweep across a control row leaves a trail of cards. The
 * pause is what makes a hint an answer to a question rather than noise.
 *
 * ## Concise, and where the words come from
 *
 * A card is a LABEL, not a paragraph. Most `title`s here carry the reasoning as
 * well as the action, because that is where the reasoning belongs, and a card
 * that reproduced all of it would be worse than the native tip it replaced. So:
 * an authored `data-hint` wins, otherwise the first sentence of the title, and
 * if even that runs long the hint is dropped rather than truncated — half a
 * sentence in a card is worse than no card, and it is the signal to write a
 * `data-hint` for that control.
 *
 * The `title` is MOVED to `data-hint-stash` while the pointer is over the
 * element and put back when it leaves, because leaving it in place would show
 * the native tip first and this one on top of it. Restoring is belt and braces
 * — on leave, on scroll, on pointer cancel, and on unmount — since a control
 * whose `title` was borrowed and never returned would lose its accessible
 * description.
 *
 * A control that should not have a hint opts out with `data-hint-skip`.
 *
 * ## What it does not cover
 *
 * The affordances drawn INSIDE the canvas — the cut-plane handles and the probe
 * arrow — are not DOM elements and have no `title` to borrow. They are the
 * draggable things a hint would help most with, and reaching them needs the
 * scene to publish what is under the pointer. Not built; recorded in
 * `docs/observations.md`.
 */
import { useEffect, useRef, useState } from 'react';
import { HINT_DELAY_MS, conciseHint } from './hintText.ts';

/** Gap between the control and the card, in pixels. */
const OFFSET_PX = 8;

interface Hint {
  text: string;
  /** Viewport coordinates of the control the hint belongs to. */
  x: number;
  y: number;
  /** Whether the card sits below the control rather than above it. */
  below: boolean;
}

/**
 * The element a hint would describe, or null.
 *
 * Walks up from the event target, because the pointer usually lands on a glyph
 * `<span>` inside the button rather than on the button. Stops at the first
 * ancestor that carries a title, so a control inside a titled container
 * describes itself rather than its container.
 */
function hintSource(start: EventTarget | null): HTMLElement | null {
  let element = start instanceof HTMLElement ? start : null;
  while (element) {
    if (element.dataset.hintSkip !== undefined) return null;
    if (element.title.trim() !== ''
      || element.dataset.hint !== undefined
      || element.dataset.hintStash !== undefined) return element;
    element = element.parentElement;
  }
  return null;
}

export default function HintLayer() {
  const [hint, setHint] = useState<Hint | null>(null);
  /** The element whose `title` is currently borrowed, so it can be given back. */
  const borrowed = useRef<HTMLElement | null>(null);
  const timer = useRef<number | null>(null);

  useEffect(() => {
    const giveBack = () => {
      const element = borrowed.current;
      borrowed.current = null;
      if (!element) return;
      const stashed = element.dataset.hintStash;
      if (stashed !== undefined) {
        element.title = stashed;
        delete element.dataset.hintStash;
      }
    };

    const cancel = () => {
      if (timer.current !== null) {
        window.clearTimeout(timer.current);
        timer.current = null;
      }
      giveBack();
      setHint(null);
    };

    const onOver = (event: PointerEvent) => {
      const element = hintSource(event.target);
      if (element === borrowed.current) return;
      cancel();
      if (!element) return;

      const title = element.dataset.hintStash ?? element.title;
      const text = conciseHint(element.dataset.hint, title);
      if (text === '') return;

      // Borrow the title so the native tip cannot fire under ours. Stashed
      // under its own key, because `data-hint` is the AUTHORED short form and
      // overwriting it would replace a considered label with a paragraph.
      element.dataset.hintStash = title;
      element.title = '';
      borrowed.current = element;

      timer.current = window.setTimeout(() => {
        timer.current = null;
        const box = element.getBoundingClientRect();
        // Below the control when there is not room above it, which is most of
        // the header row.
        const below = box.top < 120;
        setHint({
          text,
          x: box.left + box.width / 2,
          y: below ? box.bottom + OFFSET_PX : box.top - OFFSET_PX,
          below,
        });
      }, HINT_DELAY_MS);
    };

    document.addEventListener('pointerover', onOver);
    document.addEventListener('pointerdown', cancel);
    document.addEventListener('pointercancel', cancel);
    document.addEventListener('pointerleave', cancel);
    window.addEventListener('scroll', cancel, true);
    window.addEventListener('blur', cancel);

    return () => {
      document.removeEventListener('pointerover', onOver);
      document.removeEventListener('pointerdown', cancel);
      document.removeEventListener('pointercancel', cancel);
      document.removeEventListener('pointerleave', cancel);
      window.removeEventListener('scroll', cancel, true);
      window.removeEventListener('blur', cancel);
      cancel();
    };
  }, []);

  if (hint === null) return null;

  return (
    <div
      className={hint.below ? 'hint hint--below' : 'hint'}
      style={{ left: `${hint.x}px`, top: `${hint.y}px` }}
      /*
       * Not a live region and not focusable. It duplicates a description the
       * control already carries through `aria-label` or its own text, so
       * announcing it again would read every control twice.
       */
      aria-hidden="true"
      data-testid="hint-card"
    >
      {hint.text}
    </div>
  );
}
