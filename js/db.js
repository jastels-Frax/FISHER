// IndexedDB wrapper for the Nova Scotia Fish Field ID & Catalogue app.
// Stores: refData (seeded copy of species.json / key.json for offline query),
// surveys (station/survey records), fishRecords (individual catch records, indexed by surveyId).

const DB_NAME = 'fisher-fish-id';
const DB_VERSION = 1;

function openDb() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains('refData')) {
        db.createObjectStore('refData', { keyPath: 'key' });
      }
      if (!db.objectStoreNames.contains('surveys')) {
        db.createObjectStore('surveys', { keyPath: 'id' });
      }
      if (!db.objectStoreNames.contains('fishRecords')) {
        const store = db.createObjectStore('fishRecords', { keyPath: 'id' });
        store.createIndex('surveyId', 'surveyId', { unique: false });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

let dbPromise = null;
function getDb() {
  if (!dbPromise) dbPromise = openDb();
  return dbPromise;
}

function tx(storeName, mode) {
  return getDb().then((db) => db.transaction(storeName, mode).objectStore(storeName));
}

function wrapReq(req) {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

export const FisherDB = {
  async put(storeName, value) {
    const store = await tx(storeName, 'readwrite');
    return wrapReq(store.put(value));
  },
  async get(storeName, key) {
    const store = await tx(storeName, 'readonly');
    return wrapReq(store.get(key));
  },
  async getAll(storeName) {
    const store = await tx(storeName, 'readonly');
    return wrapReq(store.getAll());
  },
  async getAllByIndex(storeName, indexName, value) {
    const store = await tx(storeName, 'readonly');
    return wrapReq(store.index(indexName).getAll(value));
  },
  async delete(storeName, key) {
    const store = await tx(storeName, 'readwrite');
    return wrapReq(store.delete(key));
  },
  async clear(storeName) {
    const store = await tx(storeName, 'readwrite');
    return wrapReq(store.clear());
  },

  // Seed reference data (species + key) into IndexedDB from the bundled JSON files,
  // so lookups work fully offline even before the service worker cache is warm on a repeat visit.
  async seedReferenceData() {
    const existing = await this.get('refData', 'species');
    const [speciesRes, keyRes, imagesRes] = await Promise.all([
      fetch('./data/species.json'),
      fetch('./data/key.json'),
      fetch('./data/images.json'),
    ]);
    const species = await speciesRes.json();
    const key = await keyRes.json();
    const images = await imagesRes.json();
    await this.put('refData', { key: 'species', value: species, version: species.version });
    await this.put('refData', { key: 'key', value: key, version: key.version });
    await this.put('refData', { key: 'images', value: images, version: images.version });
    return { species, key, images, reseeded: !existing || existing.version !== species.version };
  },

  async getSpeciesList() {
    const rec = await this.get('refData', 'species');
    return rec ? rec.value.species : [];
  },
  async getKeyTree() {
    const rec = await this.get('refData', 'key');
    return rec ? rec.value : null;
  },
  async getImageManifest() {
    const rec = await this.get('refData', 'images');
    return rec ? rec.value : {};
  },

  async listSurveys() {
    const all = await this.getAll('surveys');
    return all.sort((a, b) => (b.dateTime || '').localeCompare(a.dateTime || ''));
  },
  async listFishRecords(surveyId) {
    return this.getAllByIndex('fishRecords', 'surveyId', surveyId);
  },
  async listAllFishRecords() {
    return this.getAll('fishRecords');
  },
};

export function newId(prefix) {
  const rand = Math.floor(Math.random() * 1e9).toString(36);
  return `${prefix}-${rand}-${(newId.counter = (newId.counter || 0) + 1)}`;
}
