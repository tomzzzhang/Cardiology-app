/**
 * Temporary starter slots copied from the DRAFT `docs/view_canon.md`, present
 * whether a pack has authored them or not.
 *
 * ## Why the slots exist before the poses do
 *
 * Standard slots used to be derived from a pack's own `views[]`, which meant
 * that a pack with no views had no slots — and those are exactly the packs an
 * author opens the tool to work on. `normal-vhl-heart0102` carries one view and
 * it is the ingest reference pose, so the apical four-chamber the author wanted
 * to place was not offered anywhere. A slot with nothing in it is not an empty
 * gesture: it is a convenient current work list. It is not the platform's
 * definition of completeness, and custom slots remain available.
 *
 * An empty canon slot is not pack content and claims nothing. It holds no pose,
 * `Restore` is dead on it, and saving into it writes an ordinary local slot
 * that leaves for the pack through an export and an ingest like every other.
 *
 * ## B1 is special, and it is special for a reason that is not clinical rank
 *
 * The apical four-chamber is the one view whose pose IS a statement about the
 * model's axes. The transducer sits at the apex and the beam runs to the base,
 * so `beam_axis` is the cardiac long axis with the sign the atria are on; the
 * fan plane is the four-chamber plane, so the in-plane axis is the septum-to-
 * lateral-wall direction and the plane normal is anterior-posterior. Place that
 * one view and the model has a frame. See `cardiacFrame.ts`.
 *
 * That matters here more than it would elsewhere, because **eight of the nine
 * packs on the shelf declare `orientation: up=+y, anterior=+z, patient_left=+x`
 * and only `normal-rodero` carries any derivation behind it.** The other eight
 * carry the ingest's default triple. They are not measured; they are a guess
 * that happens to be written down in the same field a measurement would be.
 */

export interface CanonView {
  family: string;
  /** The pack's `view_id`. Matches `views[i].view_id` where a pack authored one. */
  viewId: string;
  name: string;
  /** True for the one view whose pose defines the model's axes. */
  definesFrame?: true;
}

/**
 * The provisional starter taxonomy, in the draft canon's current order.
 *
 * Names are the canon's, shortened only where the canon's own heading carries a
 * parenthetical. `view_id` follows the ids the Rodero pack already uses
 * (`b1-apical-four-chamber`, `c1-parasternal-long-axis`,
 * `c2-parasternal-short-axis`), so an authored view matches its canon slot by
 * id rather than by a name somebody retyped.
 */
export const VIEW_CANON: readonly CanonView[] = Object.freeze([
  { family: 'A', viewId: 'a1-subcostal-coronal-situs', name: 'A1 Subcostal coronal situs' },
  { family: 'A', viewId: 'a2-subcostal-sagittal-ivc', name: 'A2 Subcostal sagittal IVC/DAo' },
  { family: 'A', viewId: 'a3-subcostal-coronal', name: 'A3 Subcostal coronal long axis' },
  { family: 'A', viewId: 'a4-subcostal-sagittal', name: 'A4 Subcostal sagittal short axis' },
  { family: 'A', viewId: 'a5-subcostal-rao', name: 'A5 Subcostal right anterior oblique' },
  { family: 'A', viewId: 'a6-subcostal-lao', name: 'A6 Subcostal left anterior oblique' },

  {
    family: 'B',
    viewId: 'b1-apical-four-chamber',
    name: 'B1 Apical four-chamber',
    definesFrame: true,
  },
  { family: 'B', viewId: 'b2-apical-five-chamber', name: 'B2 Apical five-chamber' },
  { family: 'B', viewId: 'b3-apical-two-chamber', name: 'B3 Apical two-chamber' },
  { family: 'B', viewId: 'b4-apical-three-chamber', name: 'B4 Apical three-chamber' },
  { family: 'B', viewId: 'b5-apical-rv-focused', name: 'B5 Apical RV-focused' },

  { family: 'C', viewId: 'c1-parasternal-long-axis', name: 'C1 Parasternal long axis' },
  { family: 'C', viewId: 'c2-parasternal-short-axis', name: 'C2 Parasternal short axis' },

  { family: 'D', viewId: 'd1-high-parasternal-ductal', name: 'D1 High parasternal ductal' },
  { family: 'D', viewId: 'd2-high-parasternal-transverse', name: 'D2 High parasternal transverse' },

  { family: 'E', viewId: 'e1-suprasternal-long-axis', name: 'E1 Suprasternal long axis' },
  { family: 'E', viewId: 'e2-suprasternal-short-axis', name: 'E2 Suprasternal short axis' },

  { family: 'F', viewId: 'f1-right-parasternal-bicaval', name: 'F1 Right parasternal bicaval' },
  { family: 'F', viewId: 'f2-right-parasternal-transverse', name: 'F2 Right parasternal transverse' },
]);

/** The one canon view whose pose defines the model's axes. */
export const FRAME_VIEW_ID = 'b1-apical-four-chamber';

export function isFrameView(viewId: string): boolean {
  return viewId === FRAME_VIEW_ID;
}
