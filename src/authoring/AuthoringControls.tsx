/**
 * The authoring surface: one row of controls, and nothing a learner can reach.
 *
 * `contracts/authoring-mode.md` — "Gating". This component is rendered behind
 * `AUTHORING_ENABLED`, which is a build-time literal, so with the flag off the
 * `&&` folds to `false`, the reference to this module disappears, and Rollup
 * drops the file. There is no disabled state and no hidden route: in a learner
 * build the surface does not exist.
 *
 * What it does NOT do is as much the point as what it does:
 *
 * * It never sees the `Pack`. It is handed a pack id, a fan-and-display
 *   template, and a way to ask the viewer where the camera is. There is no
 *   object here that `views[]` could be written through — the same structural
 *   guarantee `freeProbe.ts` makes, for the same reason.
 * * It produces `ProbePose` values and hands them up through one callback, the
 *   same one the free-probe pad writes through. Nothing downstream can tell an
 *   anchored pose from a nudged one, which is exactly right: it is an ordinary
 *   pose.
 */
import { useState } from 'react';
import type { ProbePose } from '../schema/packV0.ts';
import { anchoredPose, defaultTemplate, type AnchorReport, type ViewAnchor } from './anchor.ts';

export interface AuthoringControlsProps {
  /** Which pack is loaded. Used only to key saved slots; never to read content. */
  packId: string;
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
  /** The one path a pose leaves here by. */
  onPose: (pose: ProbePose) => void;
}

export default function AuthoringControls({
  packId, template, standoffOverrideMm, readAnchor, onPose,
}: AuthoringControlsProps) {
  const [report, setReport] = useState<AnchorReport | null>(null);
  const [problem, setProblem] = useState<string | null>(null);

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
      setReport(result.report);
      onPose(result.pose);
    } catch (error) {
      setProblem(error instanceof Error ? error.message : String(error));
      setReport(null);
    }
  };

  return (
    <div className="authoring" data-testid="authoring-controls" data-pack={packId}>
      <p className="authoring__title">
        Authoring
        <span className="authoring__badge" title={
          'Authoring mode is a build flag. It is off in every published build, and nothing '
          + 'here writes to the pack.'
        }>
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
      {problem !== null && (
        <p className="authoring__note authoring__note--bad" data-testid="authoring-problem">
          {problem}
        </p>
      )}

      {report !== null && (
        <p
          className={report.contains ? 'authoring__note' : 'authoring__note authoring__note--bad'}
          data-testid="authoring-report"
        >
          {`Standoff ${report.standoffMm.toFixed(1)} mm`}
          {report.overrideMm !== null
            ? ` (pack override; derived was ${report.derivedMm.toFixed(1)})`
            : ' (derived)'}
          {report.depthShortCm !== null
            ? `. Fan depth is ${report.depthShortCm.toFixed(1)} cm short of the far side —
               it needs ${report.requiredDepthCm.toFixed(1)} cm. Not changed.`
              .replace(/\s+/g, ' ')
            : '. The fan contains the model.'}
        </p>
      )}
    </div>
  );
}
