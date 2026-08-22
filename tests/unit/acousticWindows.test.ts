/**
 * The poses placed through a measured acoustic window.
 *
 * `pipeline/acoustic_windows.py` puts the transducer on a registered chest wall
 * and casts its whole fan against the ribs, the costal cartilages, the sternum,
 * the clavicles and the lungs before it will call a window open. These assert
 * the properties of the result that a reader has to be able to trust without
 * re-running the pipeline: that each pose says where it stands and what it had
 * to get past, that it carries the caveat the chest makes unavoidable, and —
 * most importantly — that generating poses did not overwrite ones somebody
 * already authored.
 */
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

import { readBodyContext } from '../../src/schema/bodyContextV0.ts';
import type { Pack } from '../../src/schema/packV0.ts';
import { validatePack } from '../../src/schema/validate.ts';

const repoRoot = join(import.meta.dirname, '..', '..');

/** The marker every pose from this module carries in its own provenance. */
const CHEST_WALL_MARKER = 'POSE PLACED ON A REGISTERED CHEST WALL';

/**
 * The sector settings `acoustic_windows.py: PROBE_LADDER` offers, in its order.
 *
 * Pinned here rather than read from the evidence, so that a change to the
 * ladder has to be made in two places on purpose. 70 is the default adult
 * cardiac phased array and is what every pose is placed at unless that head
 * could not place it; the rest are a paediatric array opened wide and narrowed,
 * and a neonatal array at its narrowest.
 */
const PROBE_LADDER_SECTORS = [70, 90, 60, 45];

function loadPack(packId: string): Pack {
  const raw = JSON.parse(
    readFileSync(join(repoRoot, 'public', 'packs', packId, 'pack.json'), 'utf8'),
  ) as unknown;
  const parsed = validatePack(raw);
  expect(parsed.ok, `${packId} does not validate`).toBe(true);
  if (!parsed.ok) throw new Error('unreachable');
  return parsed.pack;
}

const rodero = loadPack('normal-rodero');
const chambers = loadPack('normal-vhl-heart0102-chambers');

const chestPlaced = (pack: Pack) =>
  pack.views.filter((view) => view.provenance.modified.note.includes(CHEST_WALL_MARKER));

describe('poses placed through a measured window', () => {
  it('exist on both packs that carry a body context', () => {
    // Rodero gained the views its heart-only substrate could not support; the
    // chamber-labelled pack gained a whole family where it had only an ingest
    // reference pose.
    expect(chestPlaced(rodero).map((v) => v.view_id).sort()).toEqual([
      'a3-subcostal-coronal',
      'a4-subcostal-sagittal',
      'a5-subcostal-rao',
      'a6-subcostal-lao',
      'b2-apical-five-chamber',
      'b3-apical-two-chamber',
      'b5-apical-rv-focused',
      'f1-right-parasternal-bicaval',
    ]);
    expect(chestPlaced(chambers).map((v) => v.view_id).sort()).toEqual([
      'a3-subcostal-coronal',
      'a5-subcostal-rao',
      'a6-subcostal-lao',
      'b1-apical-four-chamber',
      'b2-apical-five-chamber',
      'b3-apical-two-chamber',
      'b4-apical-three-chamber',
      'b5-apical-rv-focused',
      'c1-parasternal-long-axis',
      'c2-parasternal-short-axis',
    ]);
  });

  it('never overwrote a pose that was already authored', () => {
    // The four Rodero views that existed before this module ran are still the
    // ones a person authored: none of them carries this module's marker.
    // f1-right-parasternal-bicaval was withdrawn on 2026-08-22: its transducer
    // stood 66 mm off the body, which check:probe-on-skin now refuses.
    for (const viewId of ['b1-apical-four-chamber', 'b4-apical-three-chamber',
      'c1-parasternal-long-axis', 'c2-parasternal-short-axis',
      'ingest-reference-pose']) {
      const view = rodero.views.find((v) => v.view_id === viewId);
      expect(view, `${viewId} is missing from normal-rodero`).toBeDefined();
      expect(view!.provenance.modified.note).not.toContain(CHEST_WALL_MARKER);
    }
  });

  it('carries no view twice, under any id, name or alias', () => {
    for (const pack of [rodero, chambers]) {
      const ids = pack.views.map((v) => v.view_id);
      const names = pack.views.map((v) => v.name.toLowerCase());
      const aliases = pack.views.flatMap((v) => v.aliases.map((a) => a.toLowerCase()));
      expect(new Set(ids).size, `${pack.meta.id} repeats a view id`).toBe(ids.length);
      expect(new Set(names).size, `${pack.meta.id} repeats a view name`).toBe(names.length);
      expect(new Set(aliases).size, `${pack.meta.id} repeats an alias`).toBe(aliases.length);
    }
  });

  it('says where the transducer stands and what the beam had to get past', () => {
    for (const pack of [rodero, chambers]) {
      for (const view of chestPlaced(pack)) {
        const note = view.provenance.modified.note;
        expect(note, view.view_id).toContain('ACOUSTIC WINDOW MEASURED OPEN');
        expect(note, view.view_id).toMatch(/stopped by bone/);
        expect(note, view.view_id).toMatch(/by lung/);
        expect(note, view.view_id).toMatch(/costal cartilage/);
        // Blockers behind the heart are not obstructions to what the beam has
        // already imaged, and the note has to say the search knew that.
        expect(note, view.view_id).toMatch(/behind the heart are not counted/);
        expect(view.placement_landmark.length).toBeGreaterThan(10);
      }
    }
  });

  it('carries the caveat the adult chest makes unavoidable', () => {
    for (const pack of [rodero, chambers]) {
      for (const view of chestPlaced(pack)) {
        const note = view.provenance.modified.note;
        expect(note, view.view_id).toContain('ADULT MALE BodyParts3D THORAX');
        expect(note, view.view_id).toMatch(/NOT age-correct/);
        expect(note, view.view_id).toMatch(/approximate/);
        expect(view.provenance.vetted.status).toBe('draft');
      }
    }
  });

  it('names an interspace where the window is between ribs, and says so where it is not', () => {
    for (const pack of [rodero, chambers]) {
      for (const view of chestPlaced(pack)) {
        const placement = view.placement_landmark;
        if (view.family === 'A') {
          // Subcostal is under the costal margin. Naming an interspace for it
          // would be reporting a number that means nothing.
          expect(placement, view.view_id).toMatch(/below the xiphoid tip/);
          expect(placement, view.view_id).toMatch(/not between ribs/);
        } else {
          expect(placement, view.view_id).toMatch(
            /intercostal space|not an interspace|not consecutive|not bracketed/,
          );
        }
      }
    }
  });

  it('reports a plausible sector: focus inside depth, real stand-off, a real head\'s angle', () => {
    for (const pack of [rodero, chambers]) {
      for (const view of chestPlaced(pack)) {
        // 70 degrees is the default adult phased array and is what a pose is
        // placed at unless that head could not place it at all. The other
        // angles are the rest of the ladder in `acoustic_windows.py`, and a
        // pose that used one has to SAY which head and why — a sector that
        // quietly differed from the default would be a pose nobody could
        // reproduce with the probe the app offers.
        expect(PROBE_LADDER_SECTORS, view.view_id).toContain(view.probe.fan.angle_deg);
        if (view.probe.fan.angle_deg !== 70) {
          expect(view.provenance.modified.note, view.view_id)
            .toContain('THE DEFAULT HEAD COULD NOT PLACE THIS VIEW');
        }
        // Whichever head a pose names, it names one from the ladder. Poses
        // placed before the ladder existed name none, and that is not a defect
        // in them: they were all placed on the default head at 70 degrees,
        // which is what their sector still says. Regenerating them to add the
        // sentence is an owner decision about pack content, not a test's.
        const named = /PROBE HEAD: ([^,]+), sector (\d+) degrees/
          .exec(view.provenance.modified.note);
        if (named) {
          expect(PROBE_LADDER_SECTORS, view.view_id).toContain(Number(named[2]));
          expect(Number(named[2]), view.view_id).toBe(view.probe.fan.angle_deg);
        } else {
          expect(view.probe.fan.angle_deg, view.view_id).toBe(70);
        }
        expect(view.probe.fan.focus_cm).toBeLessThanOrEqual(view.probe.fan.depth_cm);
        expect(view.probe.fan.depth_cm).toBeGreaterThan(5);
        // A transducer on skin outside a chest, not a probe floating in the
        // mediastinum: every one of these reports its measured stand-off.
        expect(view.provenance.modified.note).toMatch(/STAND-OFF: \d+(\.\d+)? mm/);
      }
    }
  });

  it('derives its landmarks from geometry, and says which route each pack used', () => {
    // The chamber-labelled pack has no valve rings and never will. Its orifices
    // come from where two lumen labels touch, and the note has to say so rather
    // than letting a reader assume it carries rings it does not have.
    const survey = JSON.parse(readFileSync(join(
      repoRoot, 'evidence', 'acoustic-windows', 'normal-vhl-heart0102-chambers',
      'window-survey.json',
    ), 'utf8')) as { landmark_derivation: Record<string, string> };
    for (const orifice of ['mitral', 'tricuspid', 'aortic', 'pulmonary']) {
      expect(survey.landmark_derivation[orifice]).toMatch(/lumen|labels come within/);
      expect(survey.landmark_derivation[orifice]).toMatch(/no valve-ring geometry/);
    }
  });

  it('records what it could NOT place with a measured reason, and what needed another probe', () => {
    /*
     * A pack has nowhere to say that a view was attempted and failed, or that a
     * view needed a transducer the app does not yet offer. Both belong in the
     * evidence, and both are what tell a reader about the SUBSTRATE rather than
     * about the poses.
     *
     * This used to assert that the chamber pack had at least one failure, which
     * stopped being true the moment the probe ladder recovered its last two
     * views. What has to hold is not that something failed — it is that
     * whatever happened is recorded with numbers behind it.
     */
    for (const packId of ['normal-rodero', 'normal-vhl-heart0102-chambers']) {
      const survey = JSON.parse(readFileSync(join(
        repoRoot, 'evidence', 'acoustic-windows', packId, 'window-survey.json',
      ), 'utf8')) as {
        probe_ladder: { head: string; sector_deg: number; is_default: boolean }[];
        summary: {
          built: string[];
          not_built: Record<string, string>;
          built_on_the_default_head: string[];
          needed_another_probe_head: Record<string, {
            head: string; sector_deg: number;
            beam_axis_body: number[]; lateral_axis_body: number[];
          }>;
        };
      };

      for (const reason of Object.values(survey.summary.not_built)) {
        expect(reason.length, packId).toBeGreaterThan(20);
      }

      // The ladder is on the evidence, default first, so a reader can see what
      // was tried rather than inferring it from which angle came out.
      expect(survey.probe_ladder.length, packId).toBeGreaterThan(1);
      expect(survey.probe_ladder[0].is_default, packId).toBe(true);
      expect(survey.probe_ladder[0].sector_deg, packId).toBe(70);
      expect(PROBE_LADDER_SECTORS, packId)
        .toEqual(survey.probe_ladder.map((entry) => entry.sector_deg));

      // Every view accounted for exactly once: on the default head, or on a
      // named other head, or not built.
      expect(new Set([
        ...survey.summary.built_on_the_default_head,
        ...Object.keys(survey.summary.needed_another_probe_head),
      ]).size, packId).toBe(survey.summary.built.length);

      // A view that needed another head is only useful to a later round if the
      // ORIENTATION is recorded beside the angle. Unit axes, body frame.
      for (const [viewId, took] of
        Object.entries(survey.summary.needed_another_probe_head)) {
        expect(took.head, viewId).not.toBe('adult-phased-array');
        expect(PROBE_LADDER_SECTORS, viewId).toContain(took.sector_deg);
        for (const axis of [took.beam_axis_body, took.lateral_axis_body]) {
          expect(axis, viewId).toHaveLength(3);
          expect(Math.hypot(...axis), viewId).toBeCloseTo(1, 4);
        }
      }
    }
  });
});

describe('the body contexts still bind the packs the poses were placed through', () => {
  it('pins each pack\'s exact current bytes', () => {
    for (const [contextId, packId] of [
      ['adult-reference-chest-bp3d', 'normal-rodero'],
      ['fitted-chest-bp3d-heart0102-chambers', 'normal-vhl-heart0102-chambers'],
    ]) {
      const parsed = readBodyContext(JSON.parse(readFileSync(join(
        repoRoot, 'public', 'body-context', contextId, 'context.json',
      ), 'utf8')) as unknown);
      expect(parsed.ok ? null : parsed.problem).toBeNull();
      if (!parsed.ok) return;

      // A pose is model-space coordinates, and model space belongs to one
      // revision of one mesh. Adding views moved the pack's bytes, so the
      // registration had to be re-derived with them or every pose would be
      // placed through a registration the loader refuses to apply.
      const bytes = readFileSync(join(repoRoot, 'public', 'packs', packId, 'pack.json'));
      expect(parsed.context.pack_binding.pack_json_sha256)
        .toBe(createHash('sha256').update(bytes).digest('hex'));
      const pack = JSON.parse(bytes.toString('utf8')) as { meta: { pack_version: string } };
      expect(parsed.context.pack_binding.pack_version).toBe(pack.meta.pack_version);
    }
  });
});
