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
      'b2-apical-five-chamber',
      'b3-apical-two-chamber',
      'b5-apical-rv-focused',
    ]);
    expect(chestPlaced(chambers).map((v) => v.view_id).sort()).toEqual([
      'a3-subcostal-coronal',
      'b1-apical-four-chamber',
      'b2-apical-five-chamber',
      'b5-apical-rv-focused',
      'c1-parasternal-long-axis',
      'c2-parasternal-short-axis',
    ]);
  });

  it('never overwrote a pose that was already authored', () => {
    // The four Rodero views that existed before this module ran are still the
    // ones a person authored: none of them carries this module's marker.
    for (const viewId of ['b1-apical-four-chamber', 'b4-apical-three-chamber',
      'c1-parasternal-long-axis', 'c2-parasternal-short-axis',
      'f1-right-parasternal-bicaval', 'ingest-reference-pose']) {
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

  it('reports a plausible sector: focus inside depth, real stand-off, retained angle', () => {
    for (const pack of [rodero, chambers]) {
      for (const view of chestPlaced(pack)) {
        expect(view.probe.fan.angle_deg).toBe(70);
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

  it('records the views it could NOT place, with the measured reason', () => {
    // A pack has nowhere to say that a view was attempted and failed, and that
    // is exactly what tells a reader about the substrate rather than the poses.
    const survey = JSON.parse(readFileSync(join(
      repoRoot, 'evidence', 'acoustic-windows', 'normal-vhl-heart0102-chambers',
      'window-survey.json',
    ), 'utf8')) as { summary: { built: string[]; not_built: Record<string, string> } };
    expect(Object.keys(survey.summary.not_built).length).toBeGreaterThan(0);
    for (const reason of Object.values(survey.summary.not_built)) {
      expect(reason.length).toBeGreaterThan(20);
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
