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
import { rigidTransform, pointToBody } from '../../src/viewer/bodyFrame.ts';
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
