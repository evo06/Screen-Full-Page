const DB_NAME = "ScreenSnapDB";
const DB_VERSION = 1;
const STORE_NAME = "captures";

/**
 * Open (or upgrade) the extension IndexedDB database for storing capture blobs.
 * Using IndexedDB avoids chrome.storage.local's 10MB quota on large full-page captures.
 */
function openDB() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        const store = db.createObjectStore(STORE_NAME, { keyPath: "id" });
        store.createIndex("createdAt", "createdAt", { unique: false });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error || new Error("Falha ao abrir IndexedDB"));
  });
}

/**
 * Persist a capture record and prune stale leftovers older than 1 hour.
 * @param {object} record
 */
export async function saveCapture(record) {
  const db = await openDB();
  try {
    await new Promise((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, "readwrite");
      const store = tx.objectStore(STORE_NAME);
      store.put(record);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error || new Error("Falha ao gravar captura"));
    });
    await pruneOldCaptures(db, 60 * 60 * 1000);
  } finally {
    db.close();
  }
}

/**
 * Retrieve a capture record by ID.
 * @param {string} id
 */
export async function getCapture(id) {
  const db = await openDB();
  try {
    return await new Promise((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, "readonly");
      const req = tx.objectStore(STORE_NAME).get(id);
      req.onsuccess = () => resolve(req.result || null);
      req.onerror = () => reject(req.error || new Error("Falha ao ler captura"));
    });
  } finally {
    db.close();
  }
}

/**
 * Delete a capture record once the editor has rendered it into memory.
 * @param {string} id
 */
export async function deleteCapture(id) {
  const db = await openDB();
  try {
    await new Promise((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, "readwrite");
      tx.objectStore(STORE_NAME).delete(id);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  } finally {
    db.close();
  }
}

async function pruneOldCaptures(db, maxAgeMs) {
  const cutoff = Date.now() - maxAgeMs;
  await new Promise((resolve) => {
    const tx = db.transaction(STORE_NAME, "readwrite");
    const idx = tx.objectStore(STORE_NAME).index("createdAt");
    const range = IDBKeyRange.upperBound(cutoff);
    idx.openCursor(range).onsuccess = (ev) => {
      const cursor = ev.target.result;
      if (cursor) {
        cursor.delete();
        cursor.continue();
      }
    };
    tx.oncomplete = () => resolve();
    tx.onerror = () => resolve();
  });
}
