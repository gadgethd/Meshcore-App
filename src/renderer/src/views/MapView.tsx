import type { MeshcoreContact } from '@shared/meshcore';
import { hasGpsFix, toHex } from '@shared/meshcore';
import { ContactList } from '@renderer/components/contacts/ContactList';
import { NetworkMap } from '@renderer/components/map/NetworkMap';

interface MapViewProps {
  contacts: MeshcoreContact[];
  archivedContacts: MeshcoreContact[];
}

interface MappedContact {
  contact: MeshcoreContact;
  stale: boolean;
}

export function MapView({ contacts, archivedContacts }: MapViewProps) {
  const liveContactKeys = new Set(contacts.map((contact) => toHex(contact.publicKey)));
  const mergedContacts = new Map<string, MappedContact>();

  for (const contact of archivedContacts) {
    mergedContacts.set(toHex(contact.publicKey), {
      contact,
      stale: !liveContactKeys.has(toHex(contact.publicKey))
    });
  }

  for (const contact of contacts) {
    mergedContacts.set(toHex(contact.publicKey), { contact, stale: false });
  }

  const mapContacts = Array.from(mergedContacts.values()).sort((left, right) => {
    if (left.stale !== right.stale) return left.stale ? 1 : -1;
    return right.contact.lastSeenAt.localeCompare(left.contact.lastSeenAt);
  });

  const fixedContacts = mapContacts.filter(({ contact }) => hasGpsFix(contact));
  const liveCount = fixedContacts.filter((e) => !e.stale).length;
  const staleCount = fixedContacts.filter((e) => e.stale).length;

  return (
    <div className="grid h-full gap-4 xl:grid-cols-[minmax(0,1fr)_280px]">
      <div className="flex min-h-0 flex-col gap-3">
        <div className="flex items-center justify-between">
          <h2 className="text-base font-semibold text-white">Node Map</h2>
          <div className="flex items-center gap-2">
            <span className="mesh-pill">{liveCount} live</span>
            {staleCount > 0 ? <span className="mesh-pill">{staleCount} archived</span> : null}
          </div>
        </div>
        <div className="min-h-0 flex-1">
          <NetworkMap contacts={fixedContacts} />
        </div>
      </div>
      <div className="overflow-y-auto">
        <ContactList contacts={fixedContacts} />
      </div>
    </div>
  );
}
