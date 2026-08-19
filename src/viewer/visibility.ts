/**
 * Per-structure visibility, and why ISOLATE is the gesture rather than hide.
 *
 * With 86 structures, hiding one at a time never converges: taking the lid off
 * the KIT pack means hiding one pericardium, but seeing a single coronary
 * branch on BodyParts3D means hiding eighty-five things. "Show me only this"
 * converges in one action, whatever the count, so isolate is the primary
 * gesture and hide is the exception for the one thing in the way.
 *
 * Everything here is a pure function over the pack's own structure list. The
 * ENGINE GROUPS BY `parent` AND ENUMERATES NOTHING: there is no list of chambers
 * or vessels in this file, no anatomical category, and no assumption that a
 * pack declares a hierarchy at all. A pack with every `parent` null renders a
 * flat list, which is every pack in the repository but two. Hardcoding a
 * taxonomy here would freeze one draft of anatomy into the build — the same
 * reason `docs/view_canon.md`'s view families are not enumerated in engine
 * code.
 */
import type { Pack, Structure } from '../schema/packV0.ts';

export interface StructureNode {
  id: string;
  label: string;
  /** A group has no geometry of its own; its children carry it. */
  isGroup: boolean;
  blood_pool: boolean;
  identified: boolean;
  children: StructureNode[];
  /** How many drawable structures are at or below this node. */
  count: number;
  /** Depth from a root, for indentation. */
  depth: number;
}

/**
 * The pack's structure list as the tree the pack declares.
 *
 * Order within a level follows the pack's own order, so a pack that has thought
 * about the order it lists things in keeps it. A `parent` that does not resolve
 * cannot occur — the schema rejects it — but a defensive fallback to root keeps
 * a structure reachable rather than dropping it silently if it ever did.
 */
export function buildTree(pack: Pack): StructureNode[] {
  const nodes = new Map<string, StructureNode>();
  for (const structure of pack.meshes.structures) {
    nodes.set(structure.id, {
      id: structure.id,
      label: structure.display_label,
      isGroup: structure.mesh_node === null,
      blood_pool: structure.blood_pool,
      identified: structure.identified,
      children: [],
      count: 0,
      depth: 0,
    });
  }

  const roots: StructureNode[] = [];
  for (const structure of pack.meshes.structures) {
    const node = nodes.get(structure.id)!;
    const parent = structure.parent === null ? undefined : nodes.get(structure.parent);
    if (parent) parent.children.push(node);
    else roots.push(node);
  }

  const settle = (node: StructureNode, depth: number): number => {
    node.depth = depth;
    node.count = node.isGroup ? 0 : 1;
    for (const child of node.children) node.count += settle(child, depth + 1);
    return node.count;
  };
  for (const root of roots) settle(root, 0);
  return roots;
}

/** Every drawable structure id at or below a node. */
export function drawableIds(node: StructureNode): string[] {
  return node.isGroup
    ? node.children.flatMap(drawableIds)
    : [node.id, ...node.children.flatMap(drawableIds)];
}

/** Depth-first walk of a tree, roots first. */
export function walk(nodes: readonly StructureNode[]): StructureNode[] {
  return nodes.flatMap((node) => [node, ...walk(node.children)]);
}

/**
 * What the learner has done to the visibility of the model.
 *
 * `isolated` is a separate field rather than "hidden = everything else",
 * because the two mean different things when the pack changes underneath: an
 * isolate is a statement about ONE structure and survives, and a hidden set of
 * eighty-five ids is a snapshot that goes stale. It also makes "show all" one
 * assignment rather than a set difference, and makes the state readable in a
 * debugger.
 */
export interface Visibility {
  /** The id shown alone — a group shows its whole subtree. */
  isolated: string | null;
  /** Individually hidden ids. A group hides its subtree. */
  hidden: ReadonlySet<string>;
}

export const SHOW_ALL: Visibility = { isolated: null, hidden: new Set() };

/**
 * The drawable ids that should be visible, given a tree and a state.
 *
 * Returns a set rather than mutating anything: viewer-core takes the
 * complement of this as its `hidden` prop, and the same function is what the
 * structure list ticks its rows from, so the list and the model cannot disagree
 * about what is on screen.
 */
export function visibleIds(roots: readonly StructureNode[], state: Visibility): Set<string> {
  const all = walk(roots);
  const byId = new Map(all.map((node) => [node.id, node]));

  const base = state.isolated === null
    ? all.filter((node) => !node.isGroup).map((node) => node.id)
    : drawableIds(byId.get(state.isolated) ?? { ...EMPTY_NODE });

  const hidden = new Set<string>();
  for (const id of state.hidden) {
    const node = byId.get(id);
    if (node) for (const drawable of drawableIds(node)) hidden.add(drawable);
  }
  return new Set(base.filter((id) => !hidden.has(id)));
}

const EMPTY_NODE: StructureNode = {
  id: '', label: '', isGroup: true, blood_pool: false, identified: true,
  children: [], count: 0, depth: 0,
};

/**
 * ISOLATE. The primary gesture, and the one that converges.
 *
 * Isolating clears the hidden set: a learner who isolates the left ventricle
 * after hiding half the model means "show me the left ventricle", not "show me
 * whatever is left of it". Isolating what is already isolated shows everything
 * again, so the gesture is its own escape and a mis-click costs one more click.
 */
export function isolate(state: Visibility, id: string): Visibility {
  return state.isolated === id ? SHOW_ALL : { isolated: id, hidden: new Set() };
}

/**
 * HIDE. The exception, for the one thing standing in front of the rest.
 *
 * Hiding INSIDE an isolate keeps the isolate: isolating the left coronary
 * artery and then hiding one branch of it is a coherent thing to want, and
 * dropping back to the whole model would undo the work that got there.
 */
export function hide(state: Visibility, id: string): Visibility {
  const hidden = new Set(state.hidden);
  hidden.add(id);
  return { ...state, hidden };
}

export function show(state: Visibility, id: string): Visibility {
  const hidden = new Set(state.hidden);
  hidden.delete(id);
  return { ...state, hidden };
}

/** The escape. One action back to the whole model, from any state. */
export function showAll(): Visibility {
  return SHOW_ALL;
}

export function isEverythingVisible(state: Visibility): boolean {
  return state.isolated === null && state.hidden.size === 0;
}

/**
 * The text filter, keeping a matched node's ANCESTORS so the tree still reads.
 *
 * A filter that returned bare matches would drop "diagonal branch of the
 * anterior descending artery" out of its artery and leave ten identical-looking
 * rows with nothing to tell them apart. Matching a GROUP keeps its whole
 * subtree, because "coronary" should show the coronary tree rather than the one
 * node whose label contains the word.
 */
export function filterTree(roots: readonly StructureNode[], query: string): StructureNode[] {
  const needle = query.trim().toLowerCase();
  if (needle === '') return [...roots];

  const prune = (node: StructureNode): StructureNode | null => {
    if (node.label.toLowerCase().includes(needle)) return node;
    const children = node.children.map(prune).filter((child): child is StructureNode => child !== null);
    return children.length > 0 ? { ...node, children } : null;
  };
  return roots.map(prune).filter((node): node is StructureNode => node !== null);
}

/** Structures a pack declares, in the order the list should show them. */
export function structureCount(pack: Pack): number {
  return pack.meshes.structures.filter((structure: Structure) => structure.mesh_node !== null).length;
}
