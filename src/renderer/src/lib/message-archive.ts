import type { MeshcoreMessage } from '@shared/meshcore';
import { toHex } from '@shared/meshcore';

const DATABASE_NAME = 'meshcore-desktop';
const DATABASE_VERSION = 1;
const MESSAGE_STORE = 'messages';
const RETENTION_DAYS = 14;
const RETENTION_MS = RETENTION_DAYS * 24 * 60 * 60 * 1000;

interface StoredMessageRecord {
  storageKey: string;
  nodeKey: string;
  expiresAt: number;
  message: MeshcoreMessage;
}

function messageFingerprint(message: MeshcoreMessage): string {
  return [
    message.conversationKey,
    message.direction,
    message.sentAt,
    message.authorLabel,
    message.body,
    message.publicKey?.join(',') ?? '',
    message.channelIndex ?? ''
  ].join('|');
}

function requestToPromise<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error('IndexedDB request failed.'));
  });
}

function transactionToPromise(transaction: IDBTransaction): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error ?? new Error('IndexedDB transaction failed.'));
    transaction.onabort = () => reject(transaction.error ?? new Error('IndexedDB transaction aborted.'));
  });
}

async function openDatabase(): Promise<IDBDatabase | null> {
  if (typeof indexedDB === 'undefined') {
    return null;
  }

  return await new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open(DATABASE_NAME, DATABASE_VERSION);

    request.onupgradeneeded = () => {
      const database = request.result;
      const store = database.objectStoreNames.contains(MESSAGE_STORE)
        ? request.transaction!.objectStore(MESSAGE_STORE)
        : database.createObjectStore(MESSAGE_STORE, { keyPath: 'storageKey' });

      if (!store.indexNames.contains('by_nodeKey')) {
        store.createIndex('by_nodeKey', 'nodeKey', { unique: false });
      }

      if (!store.indexNames.contains('by_expiresAt')) {
        store.createIndex('by_expiresAt', 'expiresAt', { unique: false });
      }
    };

    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error('Failed to open IndexedDB.'));
  });
}

export function getMessageArchiveNodeKey(publicKey: number[]): string {
  return toHex(publicKey);
}

async function pruneExpiredMessages(database: IDBDatabase, now = Date.now()): Promise<void> {
  const transaction = database.transaction(MESSAGE_STORE, 'readwrite');
  const store = transaction.objectStore(MESSAGE_STORE);
  const index = store.index('by_expiresAt');
  const range = IDBKeyRange.upperBound(now);

  await new Promise<void>((resolve, reject) => {
    const request = index.openCursor(range);

    request.onsuccess = () => {
      const cursor = request.result;
      if (!cursor) {
        resolve();
        return;
      }

      cursor.delete();
      cursor.continue();
    };

    request.onerror = () => reject(request.error ?? new Error('Failed to prune archived messages.'));
  });

  await transactionToPromise(transaction);
}

export async function loadArchivedMessages(nodeKey: string): Promise<MeshcoreMessage[]> {
  if (!nodeKey) {
    return [];
  }

  const database = await openDatabase();
  if (!database) {
    return [];
  }

  try {
    await pruneExpiredMessages(database);

    const transaction = database.transaction(MESSAGE_STORE, 'readonly');
    const store = transaction.objectStore(MESSAGE_STORE);
    const index = store.index('by_nodeKey');
    const records = await requestToPromise(index.getAll(IDBKeyRange.only(nodeKey)) as IDBRequest<StoredMessageRecord[]>);
    await transactionToPromise(transaction);

    return records.map((record) => record.message);
  } finally {
    database.close();
  }
}

export async function saveArchivedMessages(nodeKey: string, messages: MeshcoreMessage[]): Promise<void> {
  if (!nodeKey || messages.length === 0) {
    return;
  }

  const database = await openDatabase();
  if (!database) {
    return;
  }

  try {
    const now = Date.now();
    await pruneExpiredMessages(database, now);

    const transaction = database.transaction(MESSAGE_STORE, 'readwrite');
    const store = transaction.objectStore(MESSAGE_STORE);

    for (const message of messages) {
      const record: StoredMessageRecord = {
        storageKey: `${nodeKey}:${messageFingerprint(message)}`,
        nodeKey,
        expiresAt: now + RETENTION_MS,
        message
      };

      store.put(record);
    }

    await transactionToPromise(transaction);
  } finally {
    database.close();
  }
}
