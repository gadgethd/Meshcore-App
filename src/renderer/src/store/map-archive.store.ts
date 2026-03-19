import { create } from 'zustand';
import type { MeshcoreContact } from '@shared/meshcore';
import { toHex } from '@shared/meshcore';

interface MapArchiveState {
  archivedContacts: Record<string, MeshcoreContact>;
  replaceArchivedContacts: (contacts: MeshcoreContact[]) => void;
  upsertArchivedContacts: (contacts: MeshcoreContact[]) => void;
  clearArchivedContacts: () => void;
}

export const useMapArchiveStore = create<MapArchiveState>((set) => ({
  archivedContacts: {},
  replaceArchivedContacts: (contacts) =>
    set({
      archivedContacts: Object.fromEntries(contacts.map((contact) => [toHex(contact.publicKey), contact]))
    }),
  upsertArchivedContacts: (contacts) =>
    set((state) => ({
      archivedContacts: {
        ...state.archivedContacts,
        ...Object.fromEntries(contacts.map((contact) => [toHex(contact.publicKey), contact]))
      }
    })),
  clearArchivedContacts: () => set({ archivedContacts: {} })
}));
