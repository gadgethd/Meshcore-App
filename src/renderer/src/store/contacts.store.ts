import { create } from 'zustand';
import type { MeshcoreContact } from '@shared/meshcore';
import { toHex } from '@shared/meshcore';

interface ContactsState {
  contacts: Record<string, MeshcoreContact>;
  replaceContacts: (contacts: MeshcoreContact[]) => void;
  upsertContact: (contact: MeshcoreContact) => void;
}

export const useContactsStore = create<ContactsState>((set) => ({
  contacts: {},
  replaceContacts: (contacts) =>
    set({
      contacts: Object.fromEntries(contacts.map((contact) => [toHex(contact.publicKey), contact]))
    }),
  upsertContact: (contact) =>
    set((state) => ({
      contacts: {
        ...state.contacts,
        [toHex(contact.publicKey)]: contact
      }
    }))
}));
