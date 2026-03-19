import type { MeshcoreChannel, MeshcoreContact } from '@shared/meshcore';
import { ChannelList } from '@renderer/components/channels/ChannelList';
import { ContactList } from '@renderer/components/contacts/ContactList';

interface ChannelsViewProps {
  channels: MeshcoreChannel[];
  contacts: MeshcoreContact[];
}

export function ChannelsView({ channels, contacts }: ChannelsViewProps) {
  return (
    <div className="grid gap-6 xl:grid-cols-2">
      <ChannelList channels={channels} />
      <ContactList contacts={contacts} />
    </div>
  );
}
