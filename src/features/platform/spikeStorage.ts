export const SPIKE_DATABASE_NAME = 'headache-diary-platform-spike-v1'

const STORE_NAME = 'checks'
const CHECK_KEY = 'persistence-check'

export interface SpikePersistenceRecord {
  id: typeof CHECK_KEY
  marker: string
  writtenAt: string
}

function openSpikeDatabase(): Promise<IDBDatabase> {
  if (typeof indexedDB === 'undefined') {
    return Promise.reject(new Error('IndexedDB is not available in this browser.'))
  }

  return new Promise((resolve, reject) => {
    const request = indexedDB.open(SPIKE_DATABASE_NAME, 1)

    request.onupgradeneeded = () => {
      if (!request.result.objectStoreNames.contains(STORE_NAME)) {
        request.result.createObjectStore(STORE_NAME)
      }
    }
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error ?? new Error('Could not open the spike database.'))
    request.onblocked = () => reject(new Error('The spike database is blocked by another tab.'))
  })
}

export async function writeSpikePersistenceCheck(): Promise<SpikePersistenceRecord> {
  const db = await openSpikeDatabase()
  const record: SpikePersistenceRecord = {
    id: CHECK_KEY,
    marker: 'synthetic-platform-check',
    writtenAt: new Date().toISOString(),
  }

  return new Promise((resolve, reject) => {
    const transaction = db.transaction(STORE_NAME, 'readwrite')
    let settled = false

    const finish = (callback: () => void) => {
      if (settled) return
      settled = true
      db.close()
      callback()
    }

    transaction.objectStore(STORE_NAME).put(record, CHECK_KEY)
    transaction.oncomplete = () => finish(() => resolve(record))
    transaction.onerror = () =>
      finish(() => reject(transaction.error ?? new Error('The persistence check could not be committed.')))
    transaction.onabort = () => finish(() => reject(new Error('The persistence check was aborted.')))
  })
}

export async function readSpikePersistenceCheck(): Promise<SpikePersistenceRecord | null> {
  const db = await openSpikeDatabase()

  return new Promise((resolve, reject) => {
    const transaction = db.transaction(STORE_NAME, 'readonly')
    let record: SpikePersistenceRecord | null = null
    let settled = false

    const finish = (callback: () => void) => {
      if (settled) return
      settled = true
      db.close()
      callback()
    }

    const request = transaction.objectStore(STORE_NAME).get(CHECK_KEY)
    request.onsuccess = () => {
      record = (request.result as SpikePersistenceRecord | undefined) ?? null
    }
    request.onerror = () => finish(() => reject(request.error ?? new Error('The persistence check could not be read.')))
    transaction.oncomplete = () => finish(() => resolve(record))
    transaction.onerror = () =>
      finish(() => reject(transaction.error ?? new Error('The persistence check could not be read.')))
    transaction.onabort = () => finish(() => reject(new Error('The persistence read was aborted.')))
  })
}

export function clearSpikePersistenceCheck(): Promise<void> {
  if (typeof indexedDB === 'undefined') {
    return Promise.reject(new Error('IndexedDB is not available in this browser.'))
  }

  return new Promise((resolve, reject) => {
    const request = indexedDB.deleteDatabase(SPIKE_DATABASE_NAME)
    request.onsuccess = () => resolve()
    request.onerror = () => reject(request.error ?? new Error('The spike database could not be cleared.'))
    request.onblocked = () => reject(new Error('Close other spike tabs before clearing the spike database.'))
  })
}
