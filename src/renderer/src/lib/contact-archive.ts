import type { MeshcoreContact } from '@shared/meshcore';
import { toHex } from '@shared/meshcore';

const CONTACT_ARCHIVE_STORAGE_KEY = 'meshcore-desktop-contact-archive';

type StoredContactArchive = Record<string, Record<string, MeshcoreContact>>;

function readContactArchive(): StoredContactArchive {
  if (typeof window === 'undefined') {
    return {};
  }

  try {
    const raw = window.localStorage.getItem(CONTACT_ARCHIVE_STORAGE_KEY);
    if (!raw) {
      return {};
    }

    return JSON.parse(raw) as StoredContactArchive;
  } catch {
    return {};
  }
}

function writeContactArchive(archive: StoredContactArchive): void {
  if (typeof window === 'undefined') {
    return;
  }

  try {
    window.localStorage.setItem(CONTACT_ARCHIVE_STORAGE_KEY, JSON.stringify(archive));
  } catch {}
}

function mergeContactRecords(existing: MeshcoreContact, incoming: MeshcoreContact): MeshcoreContact {
  return incoming.lastSeenAt >= existing.lastSeenAt
    ? incoming
    : {
        ...incoming,
        lastSeenAt: existing.lastSeenAt
      };
}

export function getContactArchiveNodeKey(publicKey: number[]): string {
  return toHex(publicKey);
}

export function loadArchivedContacts(nodeKey: string | null): MeshcoreContact[] {
  if (!nodeKey) {
    return [];
  }

  const archive = readContactArchive();
  return Object.values(archive[nodeKey] ?? {});
}

export function saveArchivedContacts(nodeKey: string | null, contacts: MeshcoreContact[]): MeshcoreContact[] {
  if (!nodeKey || contacts.length === 0) {
    return loadArchivedContacts(nodeKey);
  }

  const archive = readContactArchive();
  const existingContacts = archive[nodeKey] ?? {};

  for (const contact of contacts) {
    const contactKey = toHex(contact.publicKey);
    existingContacts[contactKey] = existingContacts[contactKey]
      ? mergeContactRecords(existingContacts[contactKey], contact)
      : contact;
  }

  archive[nodeKey] = existingContacts;
  writeContactArchive(archive);
  return Object.values(existingContacts);
}
