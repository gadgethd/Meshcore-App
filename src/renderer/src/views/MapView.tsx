import { useState } from 'react';
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
  const [showLive, setShowLive] = useState(true);
  const [showArchived, setShowArchived] = useState(true);
  const [selectedContactHex, setSelectedContactHex] = useState<string | null>(null);
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

  const visibleContacts = mapContacts.filter((entry) => {
    if (!showLive && !entry.stale) {
      return false;
    }

    if (!showArchived && entry.stale) {
      return false;
    }

    return true;
  });

  const fixedContacts = visibleContacts.filter(({ contact }) => hasGpsFix(contact));
  const liveCount = mapContacts.filter((e) => !e.stale).length;
  const staleCount = mapContacts.filter((e) => e.stale).length;
  const focusedContactHex = fixedContacts.some(({ contact }) => contact.shortHex === selectedContactHex)
    ? selectedContactHex
    : null;

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
        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            className={`rounded-full border px-3 py-1.5 text-xs font-medium transition ${
              showLive
                ? 'border-cyan-300/40 bg-cyan-300/12 text-cyan-200'
                : 'border-white/10 bg-white/[0.03] text-slate-300 hover:border-white/20 hover:text-white'
            }`}
            onClick={() => setShowLive((current) => !current)}
          >
            {showLive ? 'Hide live' : 'Show live'}
          </button>
          <button
            type="button"
            className={`rounded-full border px-3 py-1.5 text-xs font-medium transition ${
              showArchived
                ? 'border-cyan-300/40 bg-cyan-300/12 text-cyan-200'
                : 'border-white/10 bg-white/[0.03] text-slate-300 hover:border-white/20 hover:text-white'
            }`}
            onClick={() => setShowArchived((current) => !current)}
          >
            {showArchived ? 'Hide archived' : 'Show archived'}
          </button>
          <span className="text-xs text-white/35">
            Showing {fixedContacts.length} nodes with a GPS fix.
          </span>
        </div>
        <div className="min-h-0 flex-1">
          <NetworkMap contacts={fixedContacts} focusedContactHex={focusedContactHex} />
        </div>
      </div>
      <div className="overflow-y-auto">
        <ContactList
          contacts={visibleContacts}
          selectedContactHex={focusedContactHex}
          onSelectContact={(contact) => setSelectedContactHex(contact.shortHex)}
        />
      </div>
    </div>
  );
}
