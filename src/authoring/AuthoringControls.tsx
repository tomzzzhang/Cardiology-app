/**
 * The authoring surface: anchor, slots, save, export. One block, one flag.
 *
 * `contracts/authoring-mode.md` — "Gating". This component is rendered behind
 * `AUTHORING_ENABLED`, which is a build-time literal, so with the flag off the
 * `&&` folds to `false`, the reference to this module disappears, and Rollup
 * drops the file and everything it imports. There is no disabled state and no
 * hidden route: in a learner build the surface does not exist, which
 * `scripts/check-authoring-absent.ts` asserts against the built bundle.
 *
 * What it does NOT do is as much the point as what it does:
 *
 * * **It never sees the `Pack`.** It is handed a pack id, a schema version, a
 *   fan-and-display template and frozen slot seeds. There is no object here
 *   that `views[]` could be written through — the same structural guarantee
 *   `freeProbe.ts` makes, for the same reason.
 * * **Saving over a standard slot writes a local override, never the pack.**
 *   The authored pose stays exactly where it was; the slot says it is
 *   overridden and offers a revert that restores the authored value bit for
 *   bit, because it was never altered to begin with.
 * * **It produces `ProbePose` values** and hands them up through one callback,
 *   the same one the free-probe pad writes through. Nothing downstream can tell
 *   an anchored pose from a nudged one.
 */
import { useCallback, useEffect, useState } from 'react';
import type { ProbePose } from '../schema/packV0.ts';
import { anchoredPose, defaultTemplate, type AnchorReport, type ViewAnchor } from './anchor.ts';
import {
  MAX_CUSTOM_SLOTS, mergeSlots, nextCustomSlotId, restoredPose,
  type SavedSlot, type Slot, type SlotSeed,
} from './slots.ts';
import { deleteSlot, loadSlots, saveSlot } from './slotStore.ts';
import { buildExport, exportFileName, readExport } from './exportFile.ts';

export interface AuthoringControlsProps {
  /** Which pack is loaded. Keys the slots; never used to read content. */
  packId: string;
  /** Stamped into the export, so an ingest knows what the poses were validated against. */
  packSchemaVersion: string;
  /** The pack's authored views, reduced to slot seeds by the caller and frozen. */
  seeds: readonly SlotSeed[];
  /**
   * The fan and display of the view being authored against, when there is one.
   *
   * Copied onto the anchored pose so that anchoring a pack that already has
   * views changes the PLACEMENT and nothing else. Undefined on the packs this
   * unit exists for, and a template is derived from the model instead.
   */
  template?: Pick<ProbePose, 'fan' | 'display'>;
  /** The pack's `interaction.authoring_standoff_mm`, when it authored one. */
  standoffOverrideMm?: number;
  /** Where the camera is and how big the model is, in model space. */
  readAnchor: () => ViewAnchor | null;
  /** The pose on screen right now — what "Save centre" would write. */
  currentPose: ProbePose | null;
  /** The one path a pose leaves here by. */
  onPose: (pose: ProbePose) => void;
  /**
   * The active slot's pose, published upward so the control pad's centre button
   * can restore it without this component reaching into the pad.
   */
  onActiveSlotPose: (pose: ProbePose | null) => void;
}

export default function AuthoringControls({
  packId, packSchemaVersion, seeds, template, standoffOverrideMm,
  readAnchor, currentPose, onPose, onActiveSlotPose,
}: AuthoringControlsProps) {
  const [saved, setSaved] = useState<SavedSlot[]>([]);
  const [activeSlotId, setActiveSlotId] = useState<string>(seeds[0]?.slotId ?? '');
  const [report, setReport] = useState<AnchorReport | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  /** The slot a press of Save is waiting to be confirmed for. */
  const [confirming, setConfirming] = useState<string | null>(null);
  const [renaming, setRenaming] = useState<string | null>(null);
  const [draftName, setDraftName] = useState('');

  const slots = mergeSlots(seeds, saved);
  const active = slots.find((slot) => slot.slotId === activeSlotId) ?? slots[0] ?? null;

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
    // A different pack is a different set of slots, and the selection with it.
    setActiveSlotId(seeds[0]?.slotId ?? '');
    setConfirming(null);
    setReport(null);
    setProblem(null);
    setNotice(null);
  }, [packId, refresh, seeds]);

  /*
   * The active slot's pose goes up to the pad, which owns the centre button.
   * Published rather than reached for: the pad is learner UI and must not grow
   * a dependency on this module.
   */
  useEffect(() => {
    onActiveSlotPose(active?.pose ?? null);
  }, [active, onActiveSlotPose]);

  /* --- anchor ----------------------------------------------------------- */

  const anchorToView = () => {
    const anchor = readAnchor();
    if (!anchor) {
      setProblem('The model has not finished loading, so there is nothing to aim at yet.');
      setReport(null);
      return;
    }
    try {
      const chosen = template ?? defaultTemplate(anchor.radius);
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

  /* --- slots ------------------------------------------------------------ */

  const restore = () => {
    if (!active) return;
    const pose = restoredPose(active);
    if (!pose) {
      setProblem('That slot holds no pose yet.');
      return;
    }
    setProblem(null);
    setNotice(`Restored ${active.label}.`);
    onPose(pose);
  };

  const commitSave = async (slot: Slot) => {
    if (!currentPose) return;
    try {
      await saveSlot({
        packId,
        slotId: slot.slotId,
        kind: slot.kind,
        label: slot.label,
        pose: structuredClone(currentPose) as ProbePose,
        savedAt: new Date().toISOString(),
      });
      setConfirming(null);
      setProblem(null);
      setNotice(slot.kind === 'standard'
        ? `Saved a LOCAL OVERRIDE over ${slot.label}. The pack is unchanged.`
        : `Saved ${slot.label}.`);
      await refresh();
    } catch (error) {
      fail(error);
    }
  };

  const addCustomSlot = async () => {
    if (!currentPose) return;
    const slotId = nextCustomSlotId(slots);
    if (slotId === null) {
      setProblem(
        `All ${MAX_CUSTOM_SLOTS} custom slots are in use. Delete one, or overwrite it.`,
      );
      return;
    }
    const label = draftName.trim() || `Custom ${slotId.replace('custom-', '')}`;
    try {
      await saveSlot({
        packId,
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
    try {
      await deleteSlot(packId, slot.slotId);
      setConfirming(null);
      setProblem(null);
      setNotice(slot.kind === 'standard'
        ? `Reverted ${slot.label} to the pose the pack authored.`
        : `Deleted ${slot.label}.`);
      if (slot.kind === 'custom') setActiveSlotId(seeds[0]?.slotId ?? '');
      await refresh();
    } catch (error) {
      fail(error);
    }
  };

  /* --- export and import ------------------------------------------------ */

  const exportSlots = () => {
    if (saved.length === 0) {
      setProblem('Nothing has been saved for this pack, so there is nothing to export.');
      return;
    }
    try {
      const exportedAt = new Date().toISOString();
      // Validated inside `buildExport`, which throws rather than writing a file
      // whose poses would not survive an ingest.
      const document = buildExport({
        packId, packSchemaVersion, slots: saved, exportedAt,
      });
      const blob = new Blob([JSON.stringify(document, null, 2)], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const link = window.document.createElement('a');
      link.href = url;
      link.download = exportFileName(packId, exportedAt);
      link.click();
      URL.revokeObjectURL(url);
      setProblem(null);
      setNotice(`Exported ${saved.length} slot(s), every pose schema-validated.`);
    } catch (error) {
      fail(error);
    }
  };

  const importSlots = async (file: File) => {
    const result = readExport(await file.text(), packId);
    if (!result.ok) {
      setProblem(result.problem);
      return;
    }
    try {
      for (const slot of result.slots) await saveSlot(slot);
      setProblem(null);
      setNotice(`Imported ${result.slots.length} slot(s).`);
      await refresh();
    } catch (error) {
      fail(error);
    }
  };

  /* --- render ----------------------------------------------------------- */

  const canSave = currentPose !== null;

  return (
    <div className="authoring" data-testid="authoring-controls" data-pack={packId}>
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

      <div className="authoring__row">
        <button
          type="button"
          className="authoring__button"
          onClick={anchorToView}
          data-testid="authoring-anchor"
          title={
            'Put the probe on the axis you are looking down, aimed at the model, at a '
            + 'standoff derived from the model and the fan angle. Then adjust with the pad.'
          }
        >
          Anchor to view
        </button>

        <label className="authoring__field">
          <span className="authoring__label">Slot</span>
          <select
            className="authoring__select"
            value={active?.slotId ?? ''}
            onChange={(event) => {
              setActiveSlotId(event.target.value);
              setConfirming(null);
              setRenaming(null);
            }}
            data-testid="authoring-slot"
          >
            {slots.length === 0 && <option value="">No slots yet</option>}
            {slots.filter((slot) => slot.kind === 'standard').length > 0 && (
              <optgroup label="From the pack">
                {slots.filter((slot) => slot.kind === 'standard').map((slot) => (
                  <option key={slot.slotId} value={slot.slotId}>
                    {slot.overridden ? `${slot.label} — overridden` : slot.label}
                  </option>
                ))}
              </optgroup>
            )}
            {slots.filter((slot) => slot.kind === 'custom').length > 0 && (
              <optgroup label="Yours">
                {slots.filter((slot) => slot.kind === 'custom').map((slot) => (
                  <option key={slot.slotId} value={slot.slotId}>{slot.label}</option>
                ))}
              </optgroup>
            )}
          </select>
        </label>

        <button
          type="button"
          className="authoring__button"
          onClick={restore}
          disabled={active?.pose === undefined || active?.pose === null}
          data-testid="authoring-restore"
          title="Put the probe back exactly where this slot has it. The pose is replaced, not merged."
        >
          Restore
        </button>
      </div>

      {/*
        * The destructive row, kept apart from the rest.
        *
        * Save centre overwrites a saved position, and it sits OUTSIDE the probe
        * control pad with the other buttons rather than inside it, because the
        * pad's buttons are pressed repeatedly and a destructive control must
        * not be adjacent to those. It is confirmed before it writes: the press
        * arms it and names what will be overwritten, and a second press does
        * it. A learner never sees any of this — it does not exist in their
        * build — so the confirmation is for the author's own hour of work.
        */}
      <div className="authoring__row authoring__row--danger">
        {confirming === active?.slotId ? (
          <>
            <span className="authoring__confirm" data-testid="authoring-confirm">
              {active.kind === 'standard'
                ? `Overwrite ${active.label} with a local override?`
                : `Overwrite ${active.label}?`}
            </span>
            <button
              type="button"
              className="authoring__button authoring__button--danger"
              onClick={() => void commitSave(active)}
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
          <button
            type="button"
            className="authoring__button authoring__button--danger"
            onClick={() => { setConfirming(active?.slotId ?? null); setNotice(null); }}
            disabled={!canSave || active === null}
            data-testid="authoring-save-centre"
            title={
              canSave
                ? 'Write the pose on screen into the selected slot. Confirmed before it writes. '
                  + 'A pack slot gets a local override; the pack itself is never edited.'
                : 'There is no pose on screen to save. Anchor to view first.'
            }
          >
            Save centre
          </button>
        )}

        {active?.saved && confirming !== active.slotId && (
          <button
            type="button"
            className="authoring__button"
            onClick={() => void removeSaved(active)}
            data-testid="authoring-revert"
            title={active.kind === 'standard'
              ? 'Drop the local override. The pack’s authored pose was never changed, so this '
                + 'restores it exactly.'
              : 'Delete this custom slot.'}
          >
            {active.kind === 'standard' ? 'Revert to authored' : 'Delete'}
          </button>
        )}
      </div>

      <div className="authoring__row">
        <input
          className="authoring__input"
          type="text"
          value={draftName}
          placeholder={renaming ? 'New name' : 'Name a new slot'}
          onChange={(event) => setDraftName(event.target.value)}
          aria-label={renaming ? 'New name for this slot' : 'Name for a new custom slot'}
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
              onClick={() => void addCustomSlot()}
              disabled={!canSave}
              data-testid="authoring-add-slot"
              title={`Save the pose on screen as a new slot of your own. ${MAX_CUSTOM_SLOTS} maximum.`}
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

      <div className="authoring__row">
        <button
          type="button"
          className="authoring__button"
          onClick={exportSlots}
          data-testid="authoring-export"
          title={
            'Write one JSON file with every saved pose for this pack. Each pose is validated '
            + 'against the schema first; a file that would not validate is not written.'
          }
        >
          Export
        </button>
        <label className="authoring__button authoring__button--file">
          Import
          <input
            type="file"
            accept="application/json,.json"
            className="authoring__file"
            onChange={(event) => {
              const file = event.target.files?.[0];
              event.target.value = '';
              if (file) void importSlots(file);
            }}
            data-testid="authoring-import"
          />
        </label>
        <span className="authoring__count" data-testid="authoring-count">
          {`${saved.length} saved`}
        </span>
      </div>

      {/*
        * The report, and the reason it is a report.
        *
        * `fan.depth_cm` is authored clinical content — a depth setting is part
        * of what a view claims — so a placement tool that quietly rewrote it
        * would be changing the view while appearing to move the probe. When the
        * authored depth cannot reach the far side of the model, that is said
        * here and the author decides.
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
            ? `. Fan depth is ${report.depthShortCm.toFixed(1)} cm short of the far side — `
              + `it needs ${report.requiredDepthCm.toFixed(1)} cm. Not changed.`
            : '. The fan contains the model.'}
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
