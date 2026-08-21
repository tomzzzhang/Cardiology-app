/**
 * The authoring surface: place a view, recall it, store it, export it.
 *
 * `contracts/authoring-mode.md` — "Gating". This component is rendered behind
 * `AUTHORING_ENABLED`, which is a build-time literal, so with the flag off the
 * `&&` folds to `false`, the reference to this module disappears, and Rollup
 * drops the file and everything it imports. There is no disabled state and no
 * hidden route: in a learner build the surface does not exist, which
 * `scripts/check-authoring-absent.ts` asserts against the built bundle.
 *
 * ## The word is VIEW, not "slot"
 *
 * On screen these are **views** — the schema's word for a saved probe position.
 * The draft canon supplies temporary starter labels, not required content. "Slot" survives in the
 * code only because `PackView` already means the schema type and two things
 * called `View` in one file is worse than one honest piece of jargon; the type
 * `Slot` means "a place a pose can be stored", and it is never shown.
 *
 * ## The layout follows the order the work happens in
 *
 * Four labelled rows: choose the **view** you are placing, **place** the probe,
 * **store** what you placed, and take the **file** away. The first version put
 * the placement button beside the view selector, which reads as though it
 * anchors *to the selected view* — the opposite of what it does. Grouping by
 * what a control acts ON is what stops that.
 *
 * ## What this does NOT do
 *
 * * **It never sees the `Pack`.** It is handed a pack id, content version, schema version, a
 *   fan-and-display template and frozen seeds. There is no object here that
 *   `views[]` could be written through — the same structural guarantee
 *   `freeProbe.ts` makes, for the same reason.
 * * **Storing a working definition never edits the pack.** The authored pose
 *   stays where it was, and the restore action can recover that value bit for
 *   bit. The UI treats the browser-local pose as the view being defined rather
 *   than labelling it as an override.
 * * **It does not write the model's axes either.** The four-chamber pose
 *   DERIVES them and the export carries them out; `meshes.anatomical_frame` is
 *   pack content with a recorded derivation and the v1 ingest ignores that frame.
 */
import { useCallback, useEffect, useState } from 'react';
import type { ProbePose } from '../schema/packV0.ts';
import { anchoredPose, defaultTemplate, type AnchorReport, type ViewAnchor } from './anchor.ts';
import { frameFromFourChamber, type CardiacBasis } from './cardiacFrame.ts';
import {
  MAX_CUSTOM_SLOTS, mergeSlots, nextCustomSlotId, restoredPose,
  type SavedSlot, type Slot, type SlotSeed,
} from './slots.ts';
import { deleteSlot, loadSlots, saveSlot } from './slotStore.ts';
import { buildExport, exportFileName, readExport, type ExportedFrame } from './exportFile.ts';

export interface AuthoringControlsProps {
  packId: string;
  packVersion: string;
  packSchemaVersion: string;
  /** Draft starter views plus whatever this pack authored, frozen by the caller. */
  seeds: readonly SlotSeed[];
  template?: Pick<ProbePose, 'fan' | 'display'>;
  standoffOverrideMm?: number;
  readAnchor: () => ViewAnchor | null;
  /** The pose on screen right now — what "Save centre" would store. */
  currentPose: ProbePose | null;
  /** A presentation-only path is on screen and must never enter the saved store. */
  transitioning?: boolean;
  /** Populated views cannot be applied until the model and transition clock exist. */
  ready?: boolean;
  /** Publish the authoring-only automatic-camera policy to the viewer. */
  onPreventAutoRotationChange: (prevent: boolean) => void;
  /** Replace the working pose from a stored view and face its imaging plane. */
  onActivatePose: (pose: ProbePose, view: AuthoringViewIdentity) => void;
  /** Clear the applied imaging view and return to the unobstructed anatomy presentation. */
  onShowFullHeart: () => void;
  /** Replace only the working pose; camera-derived placement must leave the camera alone. */
  onPose: (pose: ProbePose) => void;
  /** The selected view's pose, so the pad's centre can recall it. */
  onActiveSlotPose: (pose: ProbePose | null, view: AuthoringViewIdentity | null) => void;
  /**
   * The long axis the four-chamber measured, for the horizon lock to hold.
   *
   * Null while no four-chamber pose exists, which puts the pack's declared
   * `orientation.up` back. Published upward rather than reached for, so the
   * viewer keeps no dependency on this module.
   */
  onLevelAxis: (axis: readonly [number, number, number] | null) => void;
}

/** The truthful label/source carried with a pose while it is on screen. */
export interface AuthoringViewIdentity {
  label: string;
  source: 'pack' | 'local';
}

/** Three decimals is a millimetre at model scale and a thousandth of an axis. */
const axisText = (axis: readonly number[]) =>
  `[${axis.map((value) => value.toFixed(3)).join(', ')}]`;

const identityOf = (slot: Slot): AuthoringViewIdentity => ({
  // Standard rows keep the canon label in the selector, but a mounted review
  // file's own label is the more precise identity of the pose being shown.
  label: slot.saved?.label ?? slot.label,
  source: slot.saved ? 'local' : 'pack',
});

export default function AuthoringControls({
  packId, packVersion, packSchemaVersion, seeds, template, standoffOverrideMm,
  readAnchor, currentPose, transitioning = false, ready = true,
  onPreventAutoRotationChange,
  onActivatePose, onShowFullHeart, onPose, onActiveSlotPose, onLevelAxis,
}: AuthoringControlsProps) {
  const [saved, setSaved] = useState<SavedSlot[]>([]);
  const [activeSlotId, setActiveSlotId] = useState('');
  const [report, setReport] = useState<AnchorReport | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [confirming, setConfirming] = useState<string | null>(null);
  const [renaming, setRenaming] = useState<string | null>(null);
  const [draftName, setDraftName] = useState('');
  /** Session-only presentation preference; deliberately absent from slot/export state. */
  const [preventAutoRotation, setPreventAutoRotation] = useState(false);

  const slots = mergeSlots(seeds, saved);
  const active = activeSlotId === ''
    ? null
    : slots.find((slot) => slot.slotId === activeSlotId) ?? null;

  const fail = useCallback((error: unknown) => {
    setProblem(error instanceof Error ? error.message : String(error));
    setNotice(null);
  }, []);

  /* --- the store -------------------------------------------------------- */

  const refresh = useCallback(async () => {
    try {
      setSaved(await loadSlots(packId));
    } catch (error) {
      fail(error);
    }
  }, [packId, fail]);

  useEffect(() => {
    void refresh();
    setActiveSlotId('');
    setConfirming(null);
    setReport(null);
    setProblem(null);
    setNotice(null);
  }, [packId, refresh, seeds]);

  useEffect(() => {
    setPreventAutoRotation(false);
    onPreventAutoRotationChange(false);
  }, [packId, packVersion, onPreventAutoRotationChange]);

  // An armed overwrite cannot survive into an unauthored transition frame.
  useEffect(() => {
    if (transitioning) setConfirming(null);
  }, [transitioning]);

  const activePose = active?.pose ?? null;
  const activeIdentity = activePose && active ? identityOf(active) : null;
  const activeIdentityLabel = activeIdentity?.label ?? '';
  const activeIdentitySource = activeIdentity?.source ?? '';
  useEffect(() => {
    onActiveSlotPose(
      activePose,
      activeIdentityLabel === ''
        ? null
        : { label: activeIdentityLabel, source: activeIdentitySource as 'pack' | 'local' },
    );
  }, [activePose, activeIdentityLabel, activeIdentitySource, onActiveSlotPose]);

  /* --- the model's axes ------------------------------------------------- */

  /**
   * The four-chamber view, and the frame its pose implies.
   *
   * Computed from whatever that view currently holds — the pack's pose, or the
   * author's override — so the readout is about what is actually stored rather
   * than about what is on screen at this instant.
   */
  const frameSlot = slots.find((slot) => slot.definesFrame) ?? null;
  const derivedFrame = frameSlot?.pose ? frameFromFourChamber(frameSlot.pose) : null;

  /*
   * The horizon lock follows the measured long axis once there is one.
   *
   * Reported from the app: "the level selector does not respect the z axis set
   * by the four-chamber view". It did not — it held `meshes.orientation.up`,
   * which on eight of the nine packs is the ingest's default triple with
   * nothing behind it. Once B1 holds a pose, that pose is the only measurement
   * of the long axis there is, so it is what gets levelled.
   *
   * Keyed on the axis's own numbers rather than on the object, so this fires
   * when the axis CHANGES and not on every render.
   */
  const basal = derivedFrame?.basis.basal ?? null;
  const basalKey = basal ? basal.join(',') : '';
  useEffect(() => {
    onLevelAxis(basalKey === '' ? null : basalKey.split(',').map(Number) as [number, number, number]);
  }, [basalKey, onLevelAxis]);

  const exportedFrame = (): ExportedFrame | undefined => {
    if (!frameSlot?.saved || !derivedFrame) return undefined;
    const basis: CardiacBasis = derivedFrame.basis;
    return {
      derived_from_slot: frameSlot.slotId,
      method: 'apical-four-chamber-pose-v1',
      patient_left: basis.patient_left as [number, number, number],
      basal: basis.basal as [number, number, number],
      anterior: basis.anterior as [number, number, number],
      flipped_for_display: derivedFrame.flippedForDisplay,
    };
  };

  /* --- place ------------------------------------------------------------ */

  const placeFromCamera = () => {
    const anchor = readAnchor();
    if (!anchor) {
      setProblem('The model has not finished loading, so there is nothing to aim at yet.');
      setReport(null);
      return;
    }
    try {
      /*
       * The fan comes from the view being placed, when that view has one.
       *
       * Falling back to the pack's first view would copy the four-chamber's
       * sector width and depth onto a parasternal short axis, which is a
       * different claim about a different window. The pack-level template is
       * the fallback, and a model-derived default is the fallback for that.
       */
      const authored = active?.pose ?? null;
      const chosen = authored
        ? { fan: authored.fan, display: authored.display }
        : template ?? defaultTemplate(anchor.radius);
      const result = anchoredPose(anchor, chosen, standoffOverrideMm ?? null);
      setProblem(null);
      setNotice(null);
      setReport(result.report);
      onPose(result.pose);
    } catch (error) {
      fail(error);
      setReport(null);
    }
  };

  const recall = () => {
    if (!active) return;
    const pose = restoredPose(active);
    if (!pose) {
      setProblem('Nothing is stored for that view yet. Place the probe and save it.');
      return;
    }
    setProblem(null);
    setReport(null);
    const identity = identityOf(active);
    setNotice(`Selected ${identity.label}.`);
    onActivatePose(pose, identity);
  };

  /**
   * Choosing a populated view applies it immediately.
   *
   * This belongs in the change event, not an effect: refreshing storage,
   * renaming a row, or resetting for a new pack must not unexpectedly move the
   * probe or camera. None clears the applied imaging view. Empty rows still
   * become the active authoring target, but also show the full heart so the
   * selector never claims one view while another view remains on screen.
   */
  const selectView = (slotId: string) => {
    const target = slots.find((slot) => slot.slotId === slotId) ?? null;
    const pose = target ? restoredPose(target) : null;

    setActiveSlotId(slotId);
    setConfirming(null);
    setRenaming(null);
    setProblem(null);
    setReport(null);
    const identity = target && pose ? identityOf(target) : null;
    setNotice(identity ? `Selected ${identity.label}.` : null);

    if (pose && identity) onActivatePose(pose, identity);
    else onShowFullHeart();
  };

  /* --- store ------------------------------------------------------------ */

  const commitSave = async (slot: Slot) => {
    if (transitioning) {
      setProblem('Wait for the selected view to finish moving before saving.');
      return;
    }
    if (!currentPose) return;
    try {
      await saveSlot({
        packId,
        packVersion,
        slotId: slot.slotId,
        kind: slot.kind,
        label: slot.label,
        pose: structuredClone(currentPose) as ProbePose,
        savedAt: new Date().toISOString(),
      });
      setConfirming(null);
      setProblem(null);
      setNotice(
        slot.overridden || slot.authored !== null
          ? `Saved the working definition for ${slot.label}. The loaded pack is unchanged.`
          : slot.definesFrame
            ? `Saved ${slot.label}. The model's axes now come from this pose.`
            : `Saved ${slot.label}.`,
      );
      await refresh();
    } catch (error) {
      fail(error);
    }
  };

  const addWorkingView = async () => {
    if (transitioning) {
      setProblem('Wait for the selected view to finish moving before saving.');
      return;
    }
    if (!currentPose) return;
    const slotId = nextCustomSlotId(slots);
    if (slotId === null) {
      setProblem(`All ${MAX_CUSTOM_SLOTS} working views are in use. Delete one, or overwrite it.`);
      return;
    }
    const label = draftName.trim() || `Working view ${slotId.replace('custom-', '')}`;
    try {
      await saveSlot({
        packId,
        packVersion,
        slotId,
        kind: 'custom',
        label,
        pose: structuredClone(currentPose) as ProbePose,
        savedAt: new Date().toISOString(),
      });
      setDraftName('');
      setProblem(null);
      setNotice(`Saved ${label}.`);
      setActiveSlotId(slotId);
      await refresh();
    } catch (error) {
      fail(error);
    }
  };

  const rename = async (slot: Slot) => {
    const label = draftName.trim();
    if (!slot.saved || label === '') {
      setRenaming(null);
      return;
    }
    try {
      await saveSlot({ ...slot.saved, label });
      setRenaming(null);
      setDraftName('');
      setNotice(`Renamed to ${label}.`);
      await refresh();
    } catch (error) {
      fail(error);
    }
  };

  const removeSaved = async (slot: Slot) => {
    if (transitioning || !ready) return;
    try {
      await deleteSlot(packId, slot.slotId);
      setConfirming(null);
      setProblem(null);
      setNotice(slot.authored !== null
        ? `Reverted ${slot.label} to the pose the pack authored.`
        : `Cleared ${slot.label}.`);
      if (slot.authored !== null) {
        onActivatePose(structuredClone(slot.authored) as ProbePose, {
          label: slot.label,
          source: 'pack',
        });
      } else {
        onShowFullHeart();
      }
      if (slot.kind === 'custom' || slot.kind === 'orphan') setActiveSlotId('');
      await refresh();
    } catch (error) {
      fail(error);
    }
  };

  /* --- file ------------------------------------------------------------- */

  const exportViews = () => {
    if (saved.length === 0) {
      setProblem('Nothing has been saved for this pack, so there is nothing to export.');
      return;
    }
    try {
      const exportedAt = new Date().toISOString();
      const document = buildExport({
        packId,
        packVersion,
        packSchemaVersion,
        slots: saved,
        exportedAt,
        cardiacFrame: exportedFrame(),
      });
      const blob = new Blob([JSON.stringify(document, null, 2)], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const link = window.document.createElement('a');
      link.href = url;
      link.download = exportFileName(packId, exportedAt);
      link.hidden = true;
      window.document.body.append(link);
      link.click();
      link.remove();
      // Keep the Blob alive until the browser has consumed the synthetic click.
      // Immediate revocation races the download in embedded browsers.
      window.setTimeout(() => URL.revokeObjectURL(url), 0);
      setProblem(null);
      setNotice(
        `Exported ${saved.length} view(s), every pose schema-validated`
        + `${document.cardiac_frame ? ', with the model axes the four-chamber implies' : ''}.`,
      );
    } catch (error) {
      fail(error);
    }
  };

  const importViews = async (file: File) => {
    const result = readExport(await file.text(), packId, packVersion);
    if (!result.ok) {
      setProblem(result.problem);
      return;
    }
    try {
      for (const slot of result.slots) await saveSlot(slot);
      setProblem(null);
      setNotice(`Imported ${result.slots.length} view(s).`);
      await refresh();
    } catch (error) {
      fail(error);
    }
  };

  /* --- render ----------------------------------------------------------- */

  const canSave = !transitioning && currentPose !== null && active !== null;
  const canon = slots.filter((slot) => slot.kind === 'canon');
  const extra = slots.filter((slot) => slot.kind === 'extra');
  const working = slots.filter((slot) => slot.kind === 'custom');
  const orphans = slots.filter((slot) => slot.kind === 'orphan');

  const optionLabel = (slot: Slot) => {
    if (slot.pose === null) return `${slot.label} — empty`;
    return slot.label;
  };

  const state = active === null
    ? 'Full heart. No view selected.'
    : active.overridden
      ? 'Working definition. The loaded pack is unchanged.'
      : active.kind === 'orphan'
        ? 'Stored under an id this build does not use. Clear it or export it.'
        : active.pose === null
          ? 'Nothing placed yet.'
          : active.saved
            ? 'Stored locally.'
            : 'From the pack.';

  return (
    <div
      className="authoring"
      data-testid="authoring-controls"
      data-pack={packId}
      data-prevent-auto-rotation={preventAutoRotation ? 'true' : 'false'}
    >
      <p className="authoring__title">
        Authoring
        <span
          className="authoring__badge"
          title={
            'Authoring mode is a build flag. It is off in every published build, and nothing '
            + 'here writes to the pack.'
          }
        >
          flag
        </span>
      </p>

      {/* 1. WHICH VIEW. The subject of everything below. */}
      <div className="authoring__row">
        <span className="authoring__label">View</span>
        <select
          className="authoring__select"
          value={active?.slotId ?? ''}
          onChange={(event) => selectView(event.target.value)}
          disabled={!ready}
          data-hint="Choose a saved view to apply it, or an empty view to place next."
          data-testid="authoring-slot"
        >
          <option value="">None — full heart</option>
          {/*
            * The current draft starter list, whether or not this pack has
            * authored any of it. It is a convenience, not a required-content
            * list; working views below remain arbitrary.
            */}
          {canon.length > 0 && (
            <optgroup label="Draft starter views">
              {canon.map((slot) => (
                <option key={slot.slotId} value={slot.slotId}>{optionLabel(slot)}</option>
              ))}
            </optgroup>
          )}
          {extra.length > 0 && (
            <optgroup label="In this pack, outside the canon">
              {extra.map((slot) => (
                <option key={slot.slotId} value={slot.slotId}>{optionLabel(slot)}</option>
              ))}
            </optgroup>
          )}
          {working.length > 0 && (
            <optgroup label="Working views (yours)">
              {working.map((slot) => (
                <option key={slot.slotId} value={slot.slotId}>{optionLabel(slot)}</option>
              ))}
            </optgroup>
          )}
          {/*
            * Stored under an id nothing here matches any more. Shown rather
            * than dropped: they are counted in the total and they go into the
            * export, so a row that showed nowhere would be a pose leaving in a
            * file that no screen ever admitted to holding.
            */}
          {orphans.length > 0 && (
            <optgroup label="Stored under a name this build no longer uses">
              {orphans.map((slot) => (
                <option key={slot.slotId} value={slot.slotId}>{optionLabel(slot)}</option>
              ))}
            </optgroup>
          )}
        </select>
        <span className="authoring__state" data-testid="authoring-slot-state">{state}</span>
      </div>

      {/* Presentation only: the stored pose still moves; the anatomy camera does not. */}
      <div className="authoring__row">
        <span className="authoring__label">Mode</span>
        <label
          className="authoring__toggle"
          data-hint="Applying a saved view moves the probe without turning the anatomy."
          title={
            'Keep the current anatomy angle while saved views move the probe, cut plane, '
            + 'and live echo. Manual camera controls remain available.'
          }
        >
          <input
            type="checkbox"
            checked={preventAutoRotation}
            onChange={(event) => {
              const prevent = event.target.checked;
              setPreventAutoRotation(prevent);
              onPreventAutoRotationChange(prevent);
            }}
            disabled={transitioning || !ready}
            data-testid="authoring-prevent-auto-rotation"
          />
          Prevent auto-rotation
        </label>
      </div>

      {/* 2. PLACE the probe. Acts on the PROBE, not on the view above. */}
      <div className="authoring__row">
        <span className="authoring__label">Place</span>
        <button
          type="button"
          className="authoring__button"
          onClick={placeFromCamera}
          disabled={transitioning || !ready || !active}
          data-hint="Put the probe on the axis you are looking down."
          data-testid="authoring-anchor"
          title={
            'Put the probe on the axis you are looking down, aimed at the model, at a '
            + 'standoff derived from the model and the fan angle. Then adjust with the pad '
            + 'on the image.'
          }
        >
          Place from camera
        </button>
        <button
          type="button"
          className="authoring__button"
          onClick={recall}
          disabled={!ready || transitioning || !active || active.pose === null}
          data-hint="Put the probe back exactly where this view has it."
          data-testid="authoring-restore"
          title="Put the probe back exactly where this view has it. The pose is replaced, not merged."
        >
          Recall
        </button>
      </div>

      {/*
        * 3. STORE. Kept apart by a rule, because Save centre overwrites.
        *
        * It sits OUTSIDE the probe control pad with the other buttons rather
        * than inside it: the pad's buttons repeat while held and are pressed
        * dozens of times in a placing session, and a destructive control
        * adjacent to those is a mis-click waiting for a tired hand. It is
        * confirmed before it writes — the press arms it and names what will be
        * overwritten, and a second press does it.
        */}
      <div className="authoring__row authoring__row--danger">
        <span className="authoring__label">Store</span>
        {confirming === active?.slotId ? (
          <>
            <span className="authoring__confirm" data-testid="authoring-confirm">
              {active.authored !== null
                ? `Replace the working definition for ${active.label}?`
                : `Overwrite ${active.label}?`}
            </span>
            <button
              type="button"
              className="authoring__button authoring__button--danger"
              onClick={() => void commitSave(active)}
              disabled={transitioning}
              data-testid="authoring-save-confirm"
            >
              Overwrite
            </button>
            <button
              type="button"
              className="authoring__button"
              onClick={() => setConfirming(null)}
              data-testid="authoring-save-cancel"
            >
              Cancel
            </button>
          </>
        ) : (
          <>
            <button
              type="button"
              className="authoring__button authoring__button--danger"
              onClick={() => { setConfirming(active?.slotId ?? null); setNotice(null); }}
              disabled={!canSave}
              data-hint="Store the pose on screen into the selected view."
            data-testid="authoring-save-centre"
              title={
                transitioning
                  ? 'The pose on screen is an unauthored transition frame and cannot be saved.'
                  : canSave
                  ? 'Write the pose on screen into the selected view. Confirmed before it '
                    + 'writes. A pack view is stored as a browser-local working definition; '
                    + 'the loaded pack itself is never edited.'
                  : 'There is no pose on screen to save. Place the probe first.'
              }
            >
              Save centre
            </button>

            {/*
              * The four-chamber is the ONE view whose pose is a statement about
              * the model rather than only about a window: the transducer sits
              * at the apex and the beam runs to the base, so saving it fixes
              * the long axis. Said here, next to the button that does it, and
              * ONLY here — every other view stores a pose and nothing else.
              */}
            {active?.definesFrame && (
              <span
                className="authoring__hint"
                data-testid="authoring-frame-hint"
                title={
                  'The beam becomes the long axis (z), the fan plane gives left-right (x), '
                  + 'and the plane normal gives anterior-posterior (y). Derived and carried '
                  + 'in the export as review evidence; the current ingest deliberately leaves '
                  + 'pack meshes.anatomical_frame unchanged.'
                }
              >
                sets z axis
              </span>
            )}
          </>
        )}

        {active?.saved && confirming !== active.slotId && (
          <button
            type="button"
            className="authoring__button"
            onClick={() => void removeSaved(active)}
            disabled={transitioning || !ready}
            data-testid="authoring-revert"
            title={active.authored !== null
              ? 'Drop the browser-local working definition. The pack’s authored pose was never '
                + 'changed, so this restores it exactly.'
              : 'Clear what is stored for this view.'}
          >
            {active.authored !== null ? 'Restore pack pose' : 'Clear'}
          </button>
        )}
      </div>

      {/* 3b. A view of the author's own, named. */}
      <div className="authoring__row">
        <span className="authoring__label">New</span>
        <input
          className="authoring__input"
          type="text"
          value={draftName}
          placeholder={renaming ? 'New name' : 'Name a working view'}
          onChange={(event) => setDraftName(event.target.value)}
          aria-label={renaming ? 'New name for this view' : 'Name for a new working view'}
          data-hint="Name for a new working view."
          data-testid="authoring-name"
        />
        {renaming === active?.slotId ? (
          <button
            type="button"
            className="authoring__button"
            onClick={() => void rename(active)}
            data-testid="authoring-rename-commit"
          >
            Rename
          </button>
        ) : (
          <>
            <button
              type="button"
              className="authoring__button"
              onClick={() => void addWorkingView()}
              disabled={transitioning || currentPose === null}
              data-hint="Store the pose on screen as a view of your own."
              data-testid="authoring-add-slot"
              title={
                transitioning
                  ? 'The pose on screen is an unauthored transition frame and cannot be saved.'
                  : 'Store the pose on screen as a view of your own, outside the canon. '
                    + `${MAX_CUSTOM_SLOTS} maximum.`
              }
            >
              Save as new
            </button>
            {active?.saved && (
              <button
                type="button"
                className="authoring__button"
                onClick={() => { setRenaming(active.slotId); setDraftName(active.label); }}
                data-testid="authoring-rename"
              >
                Rename
              </button>
            )}
          </>
        )}
      </div>

      {/* 4. FILE. Off this machine and back. */}
      <div className="authoring__row">
        <span className="authoring__label">File</span>
        <button
          type="button"
          className="authoring__button"
          onClick={exportViews}
          data-hint="Write every stored pose to one JSON file."
          data-testid="authoring-export"
          title={
            'Write one JSON file with every stored pose for this pack, plus the model axes '
            + 'the four-chamber implies. Each pose is validated against the schema first; a '
            + 'file that would not validate is not written.'
          }
        >
          Export
        </button>
        <label
          className="authoring__button authoring__button--file"
          data-hint="Read a previously exported file back in."
        >
          Import
          <input
            type="file"
            accept="application/json,.json"
            className="authoring__file"
            disabled={transitioning}
            onChange={(event) => {
              const file = event.target.files?.[0];
              event.target.value = '';
              if (file) void importViews(file);
            }}
            data-testid="authoring-import"
          />
        </label>
        <span className="authoring__count" data-testid="authoring-count">
          {`${saved.length} stored`}
        </span>
      </div>

      {/*
        * The model's axes, whenever the four-chamber holds a pose.
        *
        * Shown always rather than only while B1 is selected: it is a fact about
        * the MODEL, and every other view is placed against it.
        */}
      {derivedFrame !== null && (
        <p className="authoring__note" data-testid="authoring-frame">
          {`Model axes from ${frameSlot?.label}: `}
          {`z basal ${axisText(derivedFrame.basis.basal)} · `}
          {`x patient-left ${axisText(derivedFrame.basis.patient_left)} · `}
          {`y anterior ${axisText(derivedFrame.basis.anterior)}`}
          {derivedFrame.flippedForDisplay ? ' (x flipped for display.flip_lr)' : ''}
          {' · Level holds z vertical.'}
        </p>
      )}

      {/*
        * The placement report names the one monotonic adjustment the explicit
        * gesture may make. It changes only the local working pose: saving and
        * exporting are still required before a separate ingest can change a
        * pack, and a sufficient source depth is never reduced.
        */}
      {report !== null && (
        <p
          className={report.contains ? 'authoring__note' : 'authoring__note authoring__note--warn'}
          data-testid="authoring-report"
        >
          {`Standoff ${report.standoffMm.toFixed(1)} mm`}
          {report.overrideMm !== null
            ? ` (pack override; derived was ${report.derivedMm.toFixed(1)})`
            : ' (derived)'}
          {report.depthShortCm !== null
            ? `. Fan depth expanded from ${report.sourceDepthCm.toFixed(1)} cm to `
              + `${report.appliedDepthCm.toFixed(1)} cm, the measured minimum that reaches the `
              + 'far side. Working pose only; the loaded pack is unchanged.'
            : report.contains
              ? '. The fan contains the model. Fan depth was not changed.'
              : '. Fan depth reaches the far side, but the fan angle does not contain the model '
                + 'at this standoff. The loaded pack is unchanged.'}
        </p>
      )}

      {transitioning && (
        <p className="authoring__note" data-testid="authoring-transition-note">
          Moving between saved views. This intermediate plane cannot be saved.
        </p>
      )}

      {notice !== null && (
        <p className="authoring__note" data-testid="authoring-notice">{notice}</p>
      )}

      {problem !== null && (
        <p className="authoring__note authoring__note--bad" data-testid="authoring-problem">
          {problem}
        </p>
      )}
    </div>
  );
}
