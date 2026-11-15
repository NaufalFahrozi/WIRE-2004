// Keeps the listener's own audio file in IndexedDB so it survives a reload.
// Nothing here ever leaves the browser.

const DB = 'wire2004'
const STORE = 'files'
const KEY = 'track'

function open() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB, 1)
    req.onupgradeneeded = () => req.result.createObjectStore(STORE)
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => reject(req.error)
  })
}

async function run(mode, fn) {
  const db = await open()
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, mode)
    const req = fn(tx.objectStore(STORE))
    tx.oncomplete = () => resolve(req.result)
    tx.onerror = () => reject(tx.error)
  })
}

export const saveTrack = (blob, name) => run('readwrite', (s) => s.put({ blob, name }, KEY))
export const loadTrack = () => run('readonly', (s) => s.get(KEY))
export const clearTrack = () => run('readwrite', (s) => s.delete(KEY))
