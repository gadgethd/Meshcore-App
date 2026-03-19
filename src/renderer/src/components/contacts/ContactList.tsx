import { formatDistanceToNow } from 'date-fns';
import type { MeshcoreContact } from '@shared/meshcore';

interface ContactListEntry {
  contact: MeshcoreContact;
  stale: boolean;
}

interface ContactListProps {
  contacts: Array<ContactListEntry | MeshcoreContact>;
}

export function ContactList({ contacts }: ContactListProps) {
  const normalizedContacts: ContactListEntry[] = contacts.map((entry) =>
    'contact' in entry ? entry : { contact: entry, stale: false }
  );

  return (
    <section className="mesh-panel px-4 py-4">
      <h2 className="mb-4 text-sm font-semibold text-white/70">Known Nodes</h2>
      <div className="space-y-2">
        {normalizedContacts.map(({ contact, stale }) => (
          <article
            key={contact.shortHex}
            className={`rounded-xl border px-3.5 py-3 ${
              stale ? 'border-white/[0.05] bg-white/[0.02]' : 'border-white/[0.08] bg-white/[0.04]'
            }`}
          >
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <p className={`truncate text-sm font-medium ${stale ? 'text-white/50' : 'text-white'}`}>
                  {contact.displayName}
                </p>
                <p className="mt-0.5 font-mono text-[11px] text-white/30">{contact.shortHex}</p>
              </div>
              <div className="shrink-0 space-y-1 text-right">
                <span className={`mesh-pill ${stale ? 'text-white/30' : ''}`}>
                  {stale ? 'archived' : 'live'}
                </span>
                <p className="text-[11px] text-white/25">
                  {formatDistanceToNow(new Date(contact.lastSeenAt), { addSuffix: true })}
                </p>
              </div>
            </div>
          </article>
        ))}
        {normalizedContacts.length === 0 ? (
          <p className="py-4 text-center text-sm text-white/25">No nodes discovered yet.</p>
        ) : null}
      </div>
    </section>
  );
}
