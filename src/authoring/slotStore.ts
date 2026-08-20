/**
 * Where saved slots live between sessions: IndexedDB, and why not a directory.
 *
 * The owner asked for saved positions to survive the session, and the obvious
 * answer — write a file into the pack's folder — does not exist. A browser
 * cannot create or write a directory on disk; the File System Access API can
 * hand back a handle the user picked, and it is not available everywhere and is
 * not a place a build can read from anyway. So the working store is IndexedDB
 * and the durable artefact is an EXPORT the author hands back for ingest. See
 * `exportFile.ts`.
 *
 * ## The gate
 *
 * Every entry point here begins with `assertAuthoring`. With the flag off the
 * database is never opened — not opened-and-empty, not opened-and-read-only,
 * never opened — and calling one of these is a thrown error rather than a quiet
 * no-op, because a gating defect that returns `undefined` is one that gets
 * noticed a long way from where it happened. `tests/unit/authoringGate.test.ts`
 * asserts the throw, and that test fails the moment a guard is deleted.
 */
import { assertAuthoring } from './flag.ts';
import { slotKey, type SavedSlot } from './slots.ts';

/**
 * The database name, and the one place it is written.
 *
 * `scripts/check-authoring-absent.ts` looks for this exact string in the built
 * bundle, so it is a literal here rather than assembled from parts: a name the
 * bundler could not find is a gate that could not fail.
 */
const DB_NAME = 'cardiology-authoring';
const DB_VERSION = 1;
const STORE = 'slots';

function request<T>(source: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    source.onsuccess = () => resolve(source.result);
    source.onerror = () => reject(source.error ?? new Error('IndexedDB request failed'));
  });
}

/**
 * Open the store, creating it on first use.
 *
 * One object store keyed by `packId::slotId`, plus an index on `packId` so
 * loading one pack's slots is a range read rather than a full scan. The index
 * is what makes the per-pack keying real rather than decorative: without it the
 * code would filter in memory and a mistake in the key format would go unseen.
 */
export function openSlotStore(): Promise<IDBDatabase> {
  assertAuthoring('the authoring slot store');
  if (typeof indexedDB === 'undefined') {
    return Promise.reject(new Error('this browser has no IndexedDB, so slots cannot be saved'));
  }
  return new Promise((resolve, reject) => {
    const open = indexedDB.open(DB_NAME, DB_VERSION);
    open.onupgradeneeded = () => {
      const db = open.result;
      if (!db.objectStoreNames.contains(STORE)) {
        const store = db.createObjectStore(STORE, { keyPath: 'key' });
        store.createIndex('packId', 'packId', { unique: false });
      }
    };
    open.onsuccess = () => resolve(open.result);
    open.onerror = () => reject(open.error ?? new Error('could not open the authoring store'));
  });
}

interface StoredSlot extends SavedSlot {
  key: string;
}

/** Every slot saved for one pack. Never another pack's — that is the index's job. */
export async function loadSlots(packId: string): Promise<SavedSlot[]> {
  assertAuthoring('loading authoring slots');
  const db = await openSlotStore();
  try {
    const store = db.transaction(STORE, 'readonly').objectStore(STORE);
    const rows = await request<StoredSlot[]>(store.index('packId').getAll(packId));
    // The storage key is an implementation detail of this module; callers get
    // the slot as they wrote it.
    return rows.map((row) => ({
      packId: row.packId,
      // Legacy rows intentionally remain undefined at runtime. Export refuses
      // them until the author explicitly re-saves against the loaded revision.
      packVersion: row.packVersion,
      slotId: row.slotId,
      kind: row.kind,
      label: row.label,
      pose: row.pose,
      savedAt: row.savedAt,
    }));
  } finally {
    db.close();
  }
}

export async function saveSlot(slot: SavedSlot): Promise<void> {
  assertAuthoring('saving an authoring slot');
  const db = await openSlotStore();
  try {
    const transaction = db.transaction(STORE, 'readwrite');
    await request(transaction.objectStore(STORE)
      .put({ ...slot, key: slotKey(slot.packId, slot.slotId) }));
  } finally {
    db.close();
  }
}

/**
 * Remove one slot.
 *
 * For a CUSTOM slot this deletes it. For a STANDARD one it is the revert: the
 * override goes and the pack's authored pose is what the slot holds again,
 * because the authored pose was never touched to begin with.
 */
export async function deleteSlot(packId: string, slotId: string): Promise<void> {
  assertAuthoring('deleting an authoring slot');
  const db = await openSlotStore();
  try {
    const transaction = db.transaction(STORE, 'readwrite');
    await request(transaction.objectStore(STORE).delete(slotKey(packId, slotId)));
  } finally {
    db.close();
  }
}
