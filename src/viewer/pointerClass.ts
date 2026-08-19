/**
 * Pointer class, and the reveal rule every direct-manipulation handle obeys.
 *
 * One module rather than a rule per control, because the rule is the same rule
 * and the failure mode of restating it is a control that is reachable with a
 * mouse and invisible on a phone.
 *
 * **Fine pointer** (mouse, trackpad, stylus): a handle is hidden until the
 * pointer comes within a proximity radius, then fades in, and highlights when
 * the pointer is close enough to grab it. Hover exists, so the affordance can
 * be earned rather than always occupying the picture.
 *
 * **Coarse pointer** (finger): handles are always visible, at a hit target
 * sized for a thumb. There is no hover on a touch screen, so a proximity-
 * revealed handle is simply an invisible control — the pointer's first contact
 * with the screen is already the press.
 *
 * Hit-testing is in CSS pixels against the handle's projected screen position,
 * so the radii below are screen distances and mean the same thing on every
 * device pixel ratio.
 */

/** The media query that decides the class. Exported so tests can state it. */
export const COARSE_POINTER_QUERY = '(pointer: coarse)';

/**
 * How close the pointer must come to grab a handle, in CSS pixels.
 *
 * The coarse figure is a radius, so the hit target is ~52 px across — inside
 * the 44 px minimum every touch guideline agrees on, with margin, because these
 * targets sit over a scene the same finger also drags to orbit.
 */
export const HIT_RADIUS_FINE_PX = 16;
export const HIT_RADIUS_COARSE_PX = 26;

/**
 * How close the pointer must come before a fine-pointer handle appears at all.
 *
 * Large enough that moving toward a handle reveals it before the hand has to
 * commit, small enough that crossing the panel does not light up every handle
 * at once. A judgement call, logged in `docs/observations.md`.
 */
export const PROXIMITY_RADIUS_PX = 90;

/** Whether this pointer is coarse. False in any non-browser environment. */
export function isCoarsePointer(): boolean {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return false;
  return window.matchMedia(COARSE_POINTER_QUERY).matches;
}

/**
 * Watch the pointer class. Returns an unsubscribe.
 *
 * It really does change under a running page: a tablet gaining a mouse, or a
 * desktop browser's device emulation, both flip the query live.
 */
export function watchPointerClass(onChange: (coarse: boolean) => void): () => void {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return () => {};
  const query = window.matchMedia(COARSE_POINTER_QUERY);
  const listener = (event: MediaQueryListEvent) => onChange(event.matches);
  query.addEventListener('change', listener);
  return () => query.removeEventListener('change', listener);
}

/** Grab radius for the current pointer class, in CSS pixels. */
export function hitRadiusPx(coarse: boolean): number {
  return coarse ? HIT_RADIUS_COARSE_PX : HIT_RADIUS_FINE_PX;
}

/**
 * How visible a handle is, given how far the pointer is from it.
 *
 * `distancePx` of `Infinity` means "the pointer is not in the panel", which is
 * the state a fine pointer is in most of the time and a coarse pointer is in
 * always. That is exactly why coarse returns 1 unconditionally.
 *
 * The fine ramp reaches full opacity at the grab radius rather than at the
 * proximity radius, so a handle finishes appearing at the moment it becomes
 * grabbable — the fade is the affordance, not decoration on top of one.
 */
export function revealFor(distancePx: number, coarse: boolean): number {
  if (coarse) return 1;
  const grab = HIT_RADIUS_FINE_PX;
  if (!Number.isFinite(distancePx) || distancePx >= PROXIMITY_RADIUS_PX) return 0;
  if (distancePx <= grab) return 1;
  return 1 - (distancePx - grab) / (PROXIMITY_RADIUS_PX - grab);
}
