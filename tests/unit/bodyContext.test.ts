/**
 * The committed body-context descriptor, and the binding that guards it.
 *
 * These assert on the REAL file rather than a fixture, because the thing worth
 * protecting is the committed registration: that it still parses, that it is
 * still rigid, that it is still bound to the pack bytes it was fitted to, and
 * that the anatomy it produces is still the right way up.
 */
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

import { readBodyContext, rigidProblem, type Mat3 } from '../../src/schema/bodyContextV0.ts';
import { contextIdForPack } from '../../src/packs/loadBodyContext.ts';
import { rigidTransform, pointToBody } from '../../src/viewer/bodyFrame.ts';
import { GROUP_CONTROLS, GROUP_STYLE } from '../../src/viewer/chestContext.ts';
import type { Vec3 } from '../../src/schema/primitives.ts';

const repoRoot = join(import.meta.dirname, '..', '..');
const contextPath = join(
  repoRoot, 'public', 'body-context', 'adult-reference-chest-bp3d', 'context.json',
);
const packPath = join(repoRoot, 'public', 'packs', 'normal-rodero', 'pack.json');
const reportPath = join(
  repoRoot, 'evidence', 'body-context', 'adult-reference-chest-bp3d', 'registration-report.json',
);

const raw = JSON.parse(readFileSync(contextPath, 'utf8')) as unknown;
const parsed = readBodyContext(raw);

describe('the committed descriptor', () => {
  it('validates against body-context/v0', () => {
    expect(parsed.ok ? null : parsed.problem).toBeNull();
  });

  it('is bound to the exact pack.json bytes on disk', () => {
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    const digest = createHash('sha256').update(readFileSync(packPath)).digest('hex');
    expect(parsed.context.pack_binding.pack_json_sha256).toBe(digest);

    const pack = JSON.parse(readFileSync(packPath, 'utf8')) as {
      meta: { id: string; pack_version: string };
    };
    expect(parsed.context.pack_binding.pack_id).toBe(pack.meta.id);
    expect(parsed.context.pack_binding.pack_version).toBe(pack.meta.pack_version);
  });

  it('declares the fixed patient frame and nothing else', () => {
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(parsed.context.body_frame.patient_left).toEqual([1, 0, 0]);
    expect(parsed.context.body_frame.posterior).toEqual([0, 1, 0]);
    expect(parsed.context.body_frame.superior).toEqual([0, 0, 1]);
    expect(parsed.context.body_frame.handedness).toBe('right');
    expect(parsed.context.body_frame.units).toBe('mm');
  });

  it('carries a rigid, unit-scale, non-reflecting transform', () => {
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    const rotation = parsed.context.model_to_body.rotation_row_major as unknown as Mat3;
    expect(rigidProblem(rotation)).toBeNull();
    expect(parsed.context.model_to_body.scale).toBe(1);
    expect(() => rigidTransform(rotation, parsed.context.model_to_body.translation_mm))
      .not.toThrow();
  });

  it('keeps the residuals it reports within what a two-heart fit can claim', () => {
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    const fit = parsed.context.registration;
    // Not a precision target: a guard that the committed fit has not silently
    // become a much worse one. The two hearts are different sizes, so single
    // digits of millimetre residual on the valve plane is the realistic bar.
    expect(fit.rms_residual_mm).toBeLessThan(10);
    expect(fit.max_residual_mm).toBeLessThan(15);
    for (const residual of Object.values(fit.per_landmark_residual_mm)) {
      expect(residual).toBeLessThan(15);
    }
  });

  it('records the licence, its attribution, and the inconsistent licence history', () => {
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    const provenance = parsed.context.provenance as Record<string, string>;
    expect(provenance.license).toBe('CC-BY-4.0');
    expect(provenance.license_state).toBe('confirmed');
    expect(provenance.attribution).toContain('The Database Center for Life Science');
    expect(provenance.license_history_caveat).toMatch(/CC BY-SA 2\.1 Japan/);
    // The subject is a living MRI volunteer. Saying so is the correction this
    // descriptor exists to carry, so it is asserted rather than trusted.
    expect(provenance.subject).toMatch(/NOT a\s+cadaver|not a cadaver/i);
    expect(provenance.not_a_patient).toMatch(/not clinical ground truth/i);
  });
});

describe('the committed chest assets', () => {
  it('are described as one shared file, digested on both halves', () => {
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    const assets = parsed.context.context_assets;
    expect(assets).toHaveLength(1);
    const asset = assets[0];

    const dir = join(repoRoot, 'public', 'body-context', 'adult-reference-chest-bp3d');
    const gltf = readFileSync(join(dir, asset.gltf));
    const bin = readFileSync(join(dir, asset.bin));
    expect(createHash('sha256').update(gltf).digest('hex')).toBe(asset.sha256);
    expect(createHash('sha256').update(bin).digest('hex')).toBe(asset.bin_sha256);
    expect(asset.bytes).toBe(gltf.length + bin.length);
  });

  it('stays inside the context budget', () => {
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    const asset = parsed.context.context_assets[0];
    // Context is not allowed to cost what a pack costs. 8 MB is the pipeline's
    // own ceiling; asserting it here catches a rebuild that blew past it.
    expect(asset.bytes).toBeLessThan(8_000_000);
    const triangles = asset.groups.reduce((sum, g) => sum + g.triangles, 0);
    expect(triangles).toBeLessThan(150_000);
    expect(triangles).toBeGreaterThan(0);
  });

  it('names a source element for every group, so nothing is unattributed', () => {
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    for (const group of parsed.context.context_assets[0].groups) {
      expect(group.source_elements.length).toBeGreaterThan(0);
      for (const element of group.source_elements) {
        // BodyParts3D element ids, e.g. FJ2420.
        expect(element).toMatch(/^FJ\d+$/);
      }
    }
  });

  it('reaches every display group from a control, so none is unreachable', () => {
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    const reachable = new Set(Object.values(GROUP_CONTROLS).flat());
    for (const group of parsed.context.context_assets[0].groups) {
      expect(reachable.has(group.group), `${group.group} has no control`).toBe(true);
    }
    // And every styled group is a real group, so the style table cannot drift
    // into describing geometry that is not there.
    for (const group of reachable) expect(GROUP_STYLE[group]).toBeDefined();
  });

  it('keeps the chest translucent enough to read a heart through', () => {
    // The heart is the subject. A default that drew opaque scenery in front of
    // it would be a regression the screenshots would catch late and this
    // catches immediately.
    for (const [group, style] of Object.entries(GROUP_STYLE)) {
      expect(style.opacity, `${group} is too opaque`).toBeLessThanOrEqual(0.35);
      expect(style.opacity).toBeGreaterThan(0);
    }
  });
});

describe('the registered heart is the right way up', () => {
  it('puts the apex inferior, anterior and to the left of the valve plane', () => {
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    const report = JSON.parse(readFileSync(reportPath, 'utf8')) as {
      landmarks_pack_model_mm: { apex: Vec3; base: Vec3 };
    };
    const transform = rigidTransform(
      parsed.context.model_to_body.rotation_row_major as unknown as Mat3,
      parsed.context.model_to_body.translation_mm,
    );
    const apex = pointToBody(transform, report.landmarks_pack_model_mm.apex);
    const base = pointToBody(transform, report.landmarks_pack_model_mm.base);

    // +X patient-left, +Y posterior, +Z superior.
    expect(apex[2]).toBeLessThan(base[2]); // inferior
    expect(apex[1]).toBeLessThan(base[1]); // anterior
    expect(apex[0]).toBeGreaterThan(base[0]); // leftward
  });

  it('agrees with the anatomy checks the pipeline recorded', () => {
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    const checks = (parsed.context.registration as Record<string, unknown>)
      .anatomy_checks as Record<string, boolean>;
    expect(Object.values(checks).length).toBeGreaterThanOrEqual(4);
    for (const [name, passed] of Object.entries(checks)) {
      expect(passed, `anatomy check failed: ${name}`).toBe(true);
    }
  });
});

/* -------------------------------------------------------------------------- */
/* the second context: a chest fitted to one heart                            */
/* -------------------------------------------------------------------------- */

/**
 * `fitted-chest-bp3d-heart0102-chambers` is the same BodyParts3D thorax scaled
 * uniformly until `normal-vhl-heart0102-chambers` fills it at the ratio
 * BodyParts3D's own heart fills its own thorax at.
 *
 * The scaling is baked into the CHEST GEOMETRY when the asset is built, and the
 * registration that follows is rigid at scale exactly 1. That split is the
 * whole design, and it is what these assert: a scale that leaked into
 * `model_to_body` would resize the heart, which is the one thing that must not
 * be resized.
 */
const fittedId = 'fitted-chest-bp3d-heart0102-chambers';
const fittedPackId = 'normal-vhl-heart0102-chambers';
const fittedDir = join(repoRoot, 'public', 'body-context', fittedId);
const fittedPackPath = join(repoRoot, 'public', 'packs', fittedPackId, 'pack.json');
const fitted = readBodyContext(
  JSON.parse(readFileSync(join(fittedDir, 'context.json'), 'utf8')) as unknown,
);

describe('the fitted chest context', () => {
  it('validates against body-context/v0', () => {
    expect(fitted.ok ? null : fitted.problem).toBeNull();
  });

  it('keeps model_to_body rigid at scale exactly 1', () => {
    expect(fitted.ok).toBe(true);
    if (!fitted.ok) return;
    // Literal 1, not "close to 1". The chest carries the fit; the heart does not.
    expect(fitted.context.model_to_body.scale).toBe(1);
    const rotation = fitted.context.model_to_body.rotation_row_major as unknown as Mat3;
    expect(rigidProblem(rotation)).toBeNull();
    expect(() => rigidTransform(rotation, fitted.context.model_to_body.translation_mm))
      .not.toThrow();
  });

  it('is bound to the exact pack.json bytes of the chambers pack', () => {
    expect(fitted.ok).toBe(true);
    if (!fitted.ok) return;
    const digest = createHash('sha256').update(readFileSync(fittedPackPath)).digest('hex');
    expect(fitted.context.pack_binding.pack_json_sha256).toBe(digest);

    const pack = JSON.parse(readFileSync(fittedPackPath, 'utf8')) as {
      meta: { id: string; pack_version: string };
    };
    expect(fitted.context.pack_binding.pack_id).toBe(fittedPackId);
    expect(fitted.context.pack_binding.pack_id).toBe(pack.meta.id);
    expect(fitted.context.pack_binding.pack_version).toBe(pack.meta.pack_version);
  });

  it('records one uniform scale factor and the ratio it achieved', () => {
    expect(fitted.ok).toBe(true);
    if (!fitted.ok) return;
    const scaling = (fitted.context.registration as Record<string, unknown>)
      .chest_scaling as Record<string, number | string>;

    expect(typeof scaling.uniform_scale_factor).toBe('number');
    expect(scaling.uniform_scale_factor as number).toBeGreaterThan(0);

    // The owner's gate: the fitted chest reproduces the native pair's ratio to
    // within 0.01. Wider than that and the chest was not fitted to this heart.
    const target = scaling.target_cardiothoracic_ratio as number;
    const achieved = scaling.achieved_cardiothoracic_ratio as number;
    expect(target).toBeCloseTo(0.491, 3);
    expect(Math.abs(achieved - target)).toBeLessThanOrEqual(0.01);

    expect(scaling.owner_decision_date).toBe('2026-08-22');
    expect(String(scaling.uniform_not_per_axis)).toMatch(/per-axis/i);
  });

  it('reports positive clearance inside the rib cage, per structure', () => {
    expect(fitted.ok).toBe(true);
    if (!fitted.ok) return;
    const inside = (fitted.context.registration as Record<string, unknown>)
      .heart_inside_the_rib_cage as Record<
        string, { min_clearance_mm: number; violations: number; heart_points_facing_it: number }
      >;
    // Sternum, spine and both sides of the cage. A heart through its own ribs
    // is not a composite worth shipping, so this is a gate and not a note.
    expect(Object.keys(inside).sort()).toEqual(['ribs_left', 'ribs_right', 'spine', 'sternum']);
    for (const [name, structure] of Object.entries(inside)) {
      expect(structure.violations, `${name} has heart points outside it`).toBe(0);
      expect(structure.min_clearance_mm, `${name} clearance`).toBeGreaterThan(0);
      expect(structure.heart_points_facing_it).toBeGreaterThan(0);
    }
  });

  it('keeps the residuals a chamber-centroid fit can honestly claim', () => {
    expect(fitted.ok).toBe(true);
    if (!fitted.ok) return;
    const fit = fitted.context.registration;
    // Deliberately looser than the Rodero context's bar. This pack has no
    // valve-ring geometry, so it is fitted on chamber-cavity centroids, which
    // are a cruder correspondence; the descriptor says so and this bar is the
    // guard against it silently getting worse, not a precision claim.
    expect(fit.rms_residual_mm).toBeLessThan(12);
    expect(fit.max_residual_mm).toBeLessThan(16);
    expect(String((fit as Record<string, unknown>).landmark_caveat)).toMatch(/cruder/i);
  });

  it('says in plain words what the chest is and is not', () => {
    expect(fitted.ok).toBe(true);
    if (!fitted.ok) return;
    const provenance = fitted.context.provenance as Record<string, string>;
    // The three statements the owner required travel with the descriptor, so
    // anyone holding only this file learns them without reading the log.
    expect(provenance.what_this_is).toMatch(/ADULT MALE/);
    expect(provenance.what_this_is).toMatch(/not a scan or a model of an adolescent/i);
    expect(provenance.age_correctness_caveat).toMatch(/RIB OBLIQUITY/);
    expect(provenance.age_correctness_caveat).toMatch(/intercostal/i);
    expect(provenance.age_correctness_caveat).toMatch(/approximate/i);
    expect(provenance.not_a_patient).toMatch(/not clinical ground truth/i);

    // Neither the id nor the display name may carry an age.
    expect(fitted.context.context_id).toBe(fittedId);
    expect(fitted.context.display_name).not.toMatch(/\d+\s*(y|yr|year)/i);
    expect(fitted.context.context_id).not.toMatch(/adolescent|teen|child|paediatric|pediatric/i);
  });

  it('carries the share-alike licence its scaled mesh inherits', () => {
    expect(fitted.ok).toBe(true);
    if (!fitted.ok) return;
    const provenance = fitted.context.provenance as Record<string, string>;
    expect(provenance.license).toBe('CC-BY-SA-2.1-JP');
    expect(provenance.license_state).toBe('confirmed');
    expect(provenance.copyright).toMatch(/Copyright \(c\) 2008 Life Science Integrated Database Center/);
    expect(provenance.attribution).toMatch(/Share Alike 2\.1 Japan/);
    expect(provenance.modified).toMatch(/^YES/);
    expect(provenance.share_alike_consequence).toMatch(/same licence/i);
    // The two contexts record different readings of one inconsistent history.
    // That disagreement is deliberate and is stated, not smoothed over.
    expect(provenance.license_history_caveat).toMatch(/adult-reference-chest-bp3d/);
  });

  it('digests both halves of its own chest asset', () => {
    expect(fitted.ok).toBe(true);
    if (!fitted.ok) return;
    const assets = fitted.context.context_assets;
    expect(assets).toHaveLength(1);
    const asset = assets[0];
    const gltf = readFileSync(join(fittedDir, asset.gltf));
    const bin = readFileSync(join(fittedDir, asset.bin));
    expect(createHash('sha256').update(gltf).digest('hex')).toBe(asset.sha256);
    expect(createHash('sha256').update(bin).digest('hex')).toBe(asset.bin_sha256);
    expect(asset.bytes).toBe(gltf.length + bin.length);
    expect(asset.bytes).toBeLessThan(8_000_000);
  });

  it('draws through the same controls as any other chest', () => {
    expect(fitted.ok).toBe(true);
    if (!fitted.ok) return;
    // Scenery is scenery: a second context does not get its own display path,
    // its own structure list, or a group with no control behind it.
    const reachable = new Set(Object.values(GROUP_CONTROLS).flat());
    for (const group of fitted.context.context_assets[0].groups) {
      expect(reachable.has(group.group), `${group.group} has no control`).toBe(true);
      expect(GROUP_STYLE[group.group]).toBeDefined();
    }
  });

  it('puts the apex inferior, anterior and to the left of the chamber base', () => {
    expect(fitted.ok).toBe(true);
    if (!fitted.ok) return;
    const checks = (fitted.context.registration as Record<string, unknown>)
      .anatomy_checks as Record<string, boolean>;
    expect(Object.values(checks).length).toBeGreaterThanOrEqual(4);
    for (const [name, passed] of Object.entries(checks)) {
      expect(passed, `anatomy check failed: ${name}`).toBe(true);
    }
  });
});

describe('which context serves which pack', () => {
  it('gives each of the two bound packs its own context and nothing else one', () => {
    // A registration is a fact about a PAIRING. Sharing one context between two
    // packs would place one of them in a chest sized for the other's heart.
    expect(contextIdForPack('normal-rodero')).toBe('adult-reference-chest-bp3d');
    expect(contextIdForPack(fittedPackId)).toBe(fittedId);
    for (const packId of ['stub', 'normal-vhl-heart0102', 'anatomy-bodyparts3d-heart']) {
      expect(contextIdForPack(packId)).toBeNull();
    }
  });

  it('leaves the Rodero binding exactly where it was', () => {
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(parsed.context.context_id).toBe('adult-reference-chest-bp3d');
    expect(parsed.context.pack_binding.pack_id).toBe('normal-rodero');
    // The adult chest is NOT scaled, and must never grow a scaling record.
    expect((parsed.context.registration as Record<string, unknown>).chest_scaling)
      .toBeUndefined();
  });
});
