/**
 * Load the body-context descriptor bound to a pack, if there is one.
 *
 * ## Why loading this is allowed to fail quietly
 *
 * A body context is CONTEXT. Without one, the heart still loads, the echo still
 * simulates, every authored view still works, and `Level` still holds `+Z` —
 * it is then the model's own `+Z` rather than a measured patient superior, and
 * the app says so instead of pretending otherwise.
 *
 * So a missing descriptor is not an error, and a BROKEN one must not take the
 * heart down with it. What a broken one must never do is load half-way: a
 * registration that failed validation cannot be applied "approximately",
 * because a wrong rigid transform puts the heart in a confidently wrong place,
 * which is worse than leaving it in model space and saying no body frame is
 * bound.
 *
 * ## The binding is checked, not assumed
 *
 * The descriptor names the pack it was fitted to, and pins that pack's exact
 * `pack.json` bytes. Both are checked here. A registration is a set of
 * model-space numbers, and model space belongs to one revision of one mesh —
 * applying yesterday's fit to a re-ingested pack would place the heart
 * somewhere plausible and wrong, which is the same failure mode
 * `readExport` refuses across pack versions and is refused here for the same
 * reason.
 *
 * The digest check is deliberately a WARNING rather than a refusal while the
 * schema is v0 and packs are still being revised: it reports that the fit is
 * stale, names it, and declines to apply it.
 */
import { readBodyContext, type BodyContextV0 } from '../schema/bodyContextV0.ts';
import type { Pack } from '../schema/packV0.ts';

/** What a load attempt produced. Never throws; the caller renders the reason. */
export type BodyContextResult =
  | { state: 'bound'; context: BodyContextV0 }
  | { state: 'none' }
  | { state: 'problem'; problem: string };

/** Where a context lives, under the deployed base path. */
export function bodyContextUrl(contextId: string): string {
  return `${import.meta.env.BASE_URL}body-context/${contextId}/context.json`;
}

/**
 * Which context, if any, a pack is served by.
 *
 * A lookup table rather than a field on the pack: the pack does not know its
 * context exists, and adding a field to say so would make every pack carry a
 * pointer at something most of them do not have.
 *
 * ONE CONTEXT PER PACK, and never one context shared by two. A registration is
 * a fact about a pairing, and the two entries here are fitted differently on
 * purpose: `adult-reference-chest-bp3d` is the BodyParts3D thorax at its native
 * size, and `fitted-chest-bp3d-heart0102-chambers` is the same thorax scaled
 * uniformly until its bound heart fills it at the native pair's cardiothoracic
 * ratio. Pointing a pack at the other one would place it in a chest that was
 * sized for a different heart.
 */
const CONTEXT_FOR_PACK: Readonly<Record<string, string>> = Object.freeze({
  'normal-rodero': 'adult-reference-chest-bp3d',
  'normal-vhl-heart0102-chambers': 'fitted-chest-bp3d-heart0102-chambers',
});

export function contextIdForPack(packId: string): string | null {
  return CONTEXT_FOR_PACK[packId] ?? null;
}

export async function loadBodyContext(
  pack: Pack,
  packJsonSha256: string | null,
  init?: RequestInit,
): Promise<BodyContextResult> {
  const contextId = contextIdForPack(pack.meta.id);
  if (contextId === null) return { state: 'none' };

  const url = bodyContextUrl(contextId);
  let raw: unknown;
  try {
    const response = await fetch(url, init);
    if (response.status === 404) return { state: 'none' };
    if (!response.ok) {
      return { state: 'problem', problem: `body context fetch failed: HTTP ${response.status}` };
    }
    raw = await response.json();
  } catch (cause) {
    return { state: 'problem', problem: `body context fetch failed: ${(cause as Error).message}` };
  }

  const parsed = readBodyContext(raw);
  if (!parsed.ok) {
    return { state: 'problem', problem: `body context is not valid: ${parsed.problem}` };
  }

  const binding = parsed.context.pack_binding;
  if (binding.pack_id !== pack.meta.id) {
    return {
      state: 'problem',
      problem:
        `body context "${contextId}" is bound to pack "${binding.pack_id}", not `
        + `"${pack.meta.id}". Not applied.`,
    };
  }
  if (binding.pack_version !== pack.meta.pack_version) {
    return {
      state: 'problem',
      problem:
        `body context "${contextId}" was fitted against pack version `
        + `"${binding.pack_version}" and the loaded version is `
        + `"${pack.meta.pack_version}". A registration is model-space coordinates and does `
        + 'not cross pack revisions. Not applied.',
    };
  }
  if (packJsonSha256 !== null && packJsonSha256 !== binding.pack_json_sha256) {
    return {
      state: 'problem',
      problem:
        `body context "${contextId}" was fitted against pack.json `
        + `${binding.pack_json_sha256.slice(0, 12)}… and the loaded pack.json is `
        + `${packJsonSha256.slice(0, 12)}…. The registration is stale. Not applied.`,
    };
  }

  return { state: 'bound', context: parsed.context };
}
