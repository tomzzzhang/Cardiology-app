/**
 * Per-structure visibility, and the arithmetic that makes 86 structures usable.
 *
 * These are the claims the interaction rests on, made against the real packs
 * rather than a fixture wherever the claim is about scale: "isolate converges"
 * is a statement about the ten diagonal coronary branches and the KIT
 * pericardium, and a two-structure fixture cannot say anything about either.
 */
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import {
  SHOW_ALL,
  buildTree,
  drawableIds,
  filterTree,
  hide,
  isEverythingVisible,
  isolate,
  show,
  showAll,
  visibleIds,
  walk,
} from '../../src/viewer/visibility.ts';
import { validatePack } from '../../src/schema/validate.ts';
import type { Pack } from '../../src/schema/packV0.ts';

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..', '..');

function packOf(id: string): Pack {
  const result = validatePack(
    JSON.parse(readFileSync(join(repoRoot, 'public', 'packs', id, 'pack.json'), 'utf8')),
  );
  if (!result.ok) throw new Error(`${id} does not validate`);
  return result.pack;
}

const bodyparts = packOf('anatomy-bodyparts3d-heart');
const kit = packOf('normal-kit-four-chamber');
const rodero = packOf('normal-rodero');

describe('the tree comes from the pack', () => {
  it('renders a flat list where the pack declares no hierarchy', () => {
    const roots = buildTree(kit);
    expect(roots).toHaveLength(kit.meshes.structures.length);
    expect(roots.every((node) => node.children.length === 0)).toBe(true);
    expect(roots.every((node) => node.depth === 0)).toBe(true);
  });

  it('renders the tree where the pack declares one', () => {
    const roots = buildTree(bodyparts);
    expect(roots.length).toBeLessThan(bodyparts.meshes.structures.length);
    expect(walk(roots)).toHaveLength(bodyparts.meshes.structures.length);
    expect(Math.max(...walk(roots).map((node) => node.depth))).toBeGreaterThan(2);
  });

  it('counts the drawable structures at and below a group', () => {
    const roots = buildTree(bodyparts);
    const coronary = walk(roots).find((node) => node.label === 'left coronary artery')!;
    expect(coronary.isGroup).toBe(true);
    expect(coronary.count).toBeGreaterThan(15);
    expect(coronary.count).toBe(drawableIds(coronary).length);
  });

  it('counts every drawable structure exactly once across the roots', () => {
    const roots = buildTree(bodyparts);
    const drawable = roots.flatMap(drawableIds);
    expect(new Set(drawable).size).toBe(drawable.length);
    expect(drawable).toHaveLength(86);
  });
});

describe('isolate is the gesture that converges', () => {
  /*
   * THE CASE THE FEATURE EXISTS FOR. Seeing one coronary branch by hiding takes
   * 85 actions; by isolating it takes one, and the number does not depend on
   * how many structures the pack has.
   */
  it('shows one structure in one action, whatever the pack contains', () => {
    const roots = buildTree(bodyparts);
    const branch = walk(roots).find(
      (node) => !node.isGroup && node.id.startsWith('diagonal-branch'),
    )!;
    const visible = visibleIds(roots, isolate(SHOW_ALL, branch.id));
    expect([...visible]).toEqual([branch.id]);
  });

  it('isolating a group shows its whole subtree and nothing else', () => {
    const roots = buildTree(bodyparts);
    const coronary = walk(roots).find((node) => node.label === 'left coronary artery')!;
    const visible = visibleIds(roots, isolate(SHOW_ALL, coronary.id));
    expect(visible.size).toBe(coronary.count);
    for (const id of drawableIds(coronary)) expect(visible.has(id)).toBe(true);
  });

  it('isolating the same thing twice is the way back', () => {
    const roots = buildTree(kit);
    const state = isolate(isolate(SHOW_ALL, 'epicardium'), 'epicardium');
    expect(isEverythingVisible(state)).toBe(true);
    expect(visibleIds(roots, state).size).toBe(kit.meshes.structures.length);
  });

  it('isolating clears an earlier hide, because it means "only this"', () => {
    const roots = buildTree(kit);
    const state = isolate(hide(SHOW_ALL, 'epicardium'), 'epicardium');
    expect(visibleIds(roots, state).has('epicardium')).toBe(true);
  });

  it('hiding inside an isolate keeps the isolate', () => {
    const roots = buildTree(bodyparts);
    const coronary = walk(roots).find((node) => node.label === 'left coronary artery')!;
    const branch = drawableIds(coronary)[0];
    const state = hide(isolate(SHOW_ALL, coronary.id), branch);
    const visible = visibleIds(roots, state);
    expect(visible.has(branch)).toBe(false);
    expect(visible.size).toBe(coronary.count - 1);
  });
});

describe('hide is the exception, for the one thing in the way', () => {
  /*
   * The KIT pack is the case hide is FOR: six good surfaces inside one opaque
   * pericardial bag, and taking the lid off is one action.
   */
  it('takes the lid off the KIT pack in one action', () => {
    const roots = buildTree(kit);
    const before = visibleIds(roots, SHOW_ALL);
    const after = visibleIds(roots, hide(SHOW_ALL, 'pericardium-outer-surface'));
    expect(before.has('pericardium-outer-surface')).toBe(true);
    expect(after.has('pericardium-outer-surface')).toBe(false);
    expect(after.size).toBe(before.size - 1);
  });

  it('hiding a group hides its whole subtree', () => {
    const roots = buildTree(bodyparts);
    const coronary = walk(roots).find((node) => node.label === 'left coronary artery')!;
    const visible = visibleIds(roots, hide(SHOW_ALL, coronary.id));
    for (const id of drawableIds(coronary)) expect(visible.has(id)).toBe(false);
    expect(visible.size).toBe(86 - coronary.count);
  });

  it('unhides what it hid', () => {
    const roots = buildTree(kit);
    const state = show(hide(SHOW_ALL, 'epicardium'), 'epicardium');
    expect(visibleIds(roots, state).has('epicardium')).toBe(true);
  });

  it('show all is one action back from anywhere', () => {
    const roots = buildTree(bodyparts);
    const tangled = hide(hide(isolate(SHOW_ALL, 'ascending-aorta'), 'pulmonary-trunk'), 'coronary-sinus');
    expect(visibleIds(roots, showAll()).size).toBe(86);
    expect(isEverythingVisible(tangled)).toBe(false);
    expect(isEverythingVisible(showAll())).toBe(true);
  });
});

describe('the text filter keeps the tree readable', () => {
  it('keeps a match inside its ancestors', () => {
    const roots = buildTree(bodyparts);
    const filtered = filterTree(roots, 'septal leaflet');
    const leaves = walk(filtered).filter((node) => !node.isGroup);
    expect(leaves).toHaveLength(1);
    expect(leaves[0].label).toContain('septal leaflet');
    // Its ancestors survive, or the row would float free of what it is part of.
    expect(walk(filtered).length).toBeGreaterThan(1);
  });

  it('matching a group keeps its whole subtree', () => {
    const roots = buildTree(bodyparts);
    const filtered = filterTree(roots, 'left coronary artery');
    const kept = walk(filtered).filter((node) => !node.isGroup);
    expect(kept.length).toBeGreaterThan(15);
  });

  it('is empty when nothing matches, rather than showing everything', () => {
    expect(filterTree(buildTree(bodyparts), 'zzzz')).toHaveLength(0);
  });

  it('an empty query is the whole tree', () => {
    const roots = buildTree(bodyparts);
    expect(walk(filterTree(roots, '   '))).toHaveLength(walk(roots).length);
  });
});

describe('every pack in the repository can be driven by this', () => {
  it('the shipped pack, which declares no hierarchy at all', () => {
    const roots = buildTree(rodero);
    expect(roots).toHaveLength(24);
    expect(visibleIds(roots, SHOW_ALL).size).toBe(24);
    expect(visibleIds(roots, isolate(SHOW_ALL, 'lv-myocardium')).size).toBe(1);
  });

  it('an isolate that names nothing shows nothing, rather than throwing', () => {
    const roots = buildTree(rodero);
    expect(visibleIds(roots, { isolated: 'not-a-structure', hidden: new Set() }).size).toBe(0);
  });

  it('groups are never drawable in their own right', () => {
    const roots = buildTree(bodyparts);
    const groups = walk(roots).filter((node) => node.isGroup).map((node) => node.id);
    const visible = visibleIds(roots, SHOW_ALL);
    for (const id of groups) expect(visible.has(id)).toBe(false);
  });
});
