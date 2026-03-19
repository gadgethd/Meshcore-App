import { useEffect, useMemo, useState } from 'react';
import type { ConversationKey, MeshcoreChannel, MeshcoreContact } from '@shared/meshcore';
import {
  fromHex,
  getChannelConversationKey,
  getDirectConversationKey,
  isDirectMessageContact,
  MAX_MESHCORE_MESSAGE_CHARS,
  toHex
} from '@shared/meshcore';
import { ConversationList, type ConversationListItem, type ConversationSection } from '@renderer/components/messaging/ConversationList';
import { MessageComposer } from '@renderer/components/messaging/MessageComposer';
import { MessageThread } from '@renderer/components/messaging/MessageThread';
import { useConnectionStore } from '@renderer/store/connection.store';
import { useMessagesStore } from '@renderer/store/messages.store';

const CHANNEL_ORDER_STORAGE_KEY = 'meshcore-desktop-channel-order';

function loadStoredChannelOrder(nodeKey: string | null): number[] {
  if (!nodeKey || typeof window === 'undefined') {
    return [];
  }

  try {
    const raw = window.localStorage.getItem(CHANNEL_ORDER_STORAGE_KEY);
    if (!raw) {
      return [];
    }

    const parsed = JSON.parse(raw) as Record<string, number[]>;
    return Array.isArray(parsed[nodeKey]) ? parsed[nodeKey] : [];
  } catch {
    return [];
  }
}

function saveStoredChannelOrder(nodeKey: string | null, order: number[]): void {
  if (!nodeKey || typeof window === 'undefined') {
    return;
  }

  try {
    const raw = window.localStorage.getItem(CHANNEL_ORDER_STORAGE_KEY);
    const parsed = raw ? (JSON.parse(raw) as Record<string, number[]>) : {};
    parsed[nodeKey] = order;
    window.localStorage.setItem(CHANNEL_ORDER_STORAGE_KEY, JSON.stringify(parsed));
  } catch {}
}

interface MessagesViewProps {
  mode: 'dm' | 'channel';
  contacts: MeshcoreContact[];
  channels: MeshcoreChannel[];
  conversations: Record<ConversationKey, import('@shared/meshcore').MeshcoreMessage[]>;
  connected: boolean;
  onCreateHashtagChannel?: (hashtag: string) => Promise<MeshcoreChannel>;
  onSendDirectMessage: (publicKey: number[], body: string) => Promise<void>;
  onSendChannelMessage: (channelIndex: number, body: string) => Promise<void>;
}

export function MessagesView({
  mode,
  contacts,
  channels,
  conversations,
  connected,
  onCreateHashtagChannel,
  onSendDirectMessage,
  onSendChannelMessage
}: MessagesViewProps) {
  const nodeKey = useConnectionStore((state) => state.deviceSettings ? toHex(state.deviceSettings.publicKey) : null);
  const unreadCounts = useMessagesStore((state) => state.unreadCounts);
  const markConversationRead = useMessagesStore((state) => state.markConversationRead);
  const [activeKey, setActiveKey] = useState<ConversationKey | null>(null);
  const [newHashtag, setNewHashtag] = useState('');
  const [dmSearchQuery, setDmSearchQuery] = useState('');
  const [creatingChannel, setCreatingChannel] = useState(false);
  const [channelCreateError, setChannelCreateError] = useState<string | null>(null);
  const [channelOrder, setChannelOrder] = useState<number[]>([]);

  function updateChannelOrder(nextOrder: number[]): void {
    setChannelOrder(nextOrder);
    saveStoredChannelOrder(nodeKey, nextOrder);
  }

  function moveChannel(channelIndex: number, direction: -1 | 1): void {
    const currentChannelIndexes = channels.map((channel) => channel.index);
    const effectiveOrder = [
      ...channelOrder.filter((index) => currentChannelIndexes.includes(index)),
      ...currentChannelIndexes.filter((index) => !channelOrder.includes(index))
    ];
    const currentIndex = effectiveOrder.indexOf(channelIndex);

    if (currentIndex === -1) {
      return;
    }

    const nextIndex = currentIndex + direction;
    if (nextIndex < 0 || nextIndex >= effectiveOrder.length) {
      return;
    }

    const nextOrder = [...effectiveOrder];
    const [moved] = nextOrder.splice(currentIndex, 1);
    nextOrder.splice(nextIndex, 0, moved);
    updateChannelOrder(nextOrder);
  }

  function compareConversationRecency(leftKey: ConversationKey, rightKey: ConversationKey): number {
    const leftLatest = conversations[leftKey]?.[0]?.sentAt ?? '';
    const rightLatest = conversations[rightKey]?.[0]?.sentAt ?? '';

    if (leftLatest !== rightLatest) {
      return rightLatest.localeCompare(leftLatest);
    }

    return leftKey.localeCompare(rightKey);
  }

  useEffect(() => {
    setChannelOrder(loadStoredChannelOrder(nodeKey));
  }, [nodeKey]);

  useEffect(() => {
    if (mode !== 'channel') {
      return;
    }

    const currentChannelIndexes = channels.map((channel) => channel.index);
    const normalizedOrder = [
      ...channelOrder.filter((index) => currentChannelIndexes.includes(index)),
      ...currentChannelIndexes.filter((index) => !channelOrder.includes(index))
    ];

    const changed =
      normalizedOrder.length !== channelOrder.length ||
      normalizedOrder.some((index, position) => index !== channelOrder[position]);

    if (changed) {
      updateChannelOrder(normalizedOrder);
    }
  }, [channelOrder, channels, mode, nodeKey]);

  const sections = useMemo<ConversationSection[]>(() => {
    const channelMap = new Map(channels.map((channel) => [channel.index, channel]));
    const channelKeys = new Set<ConversationKey>([
      ...channels.map((channel) => getChannelConversationKey(channel.index)),
      ...Object.keys(conversations).filter((key): key is ConversationKey => key.startsWith('channel:'))
    ]);

    const effectiveChannelOrder = [
      ...channelOrder.filter((index) => channelMap.has(index)),
      ...Array.from(channelMap.keys()).filter((index) => !channelOrder.includes(index))
    ];

    const channelItems: ConversationListItem[] = Array.from(channelKeys).flatMap((key) => {
        const channelIndex = Number.parseInt(key.slice('channel:'.length), 10);
        if (Number.isNaN(channelIndex)) {
          return [];
        }

        const channel = channelMap.get(channelIndex);
        const fallbackName = channel?.name || `Channel ${channelIndex}`;
        const orderIndex = effectiveChannelOrder.indexOf(channelIndex);
        return [{
          key,
          title: channel?.name ? `#${channel.name}` : fallbackName,
          subtitle: channel ? `${channel.memberCount} nodes` : `Channel ${channelIndex}`,
          badge: unreadCounts[key] ? `${unreadCounts[key]}` : undefined,
          moveUpDisabled: orderIndex <= 0,
          moveDownDisabled: orderIndex === -1 || orderIndex >= effectiveChannelOrder.length - 1,
          onMoveUp: () => moveChannel(channelIndex, -1),
          onMoveDown: () => moveChannel(channelIndex, 1)
        }];
      }).sort((left, right) => {
        const leftIndex = Number.parseInt(left.key.slice('channel:'.length), 10);
        const rightIndex = Number.parseInt(right.key.slice('channel:'.length), 10);
        const leftOrder = channelOrder.indexOf(leftIndex);
        const rightOrder = channelOrder.indexOf(rightIndex);

        if (leftOrder !== -1 || rightOrder !== -1) {
          if (leftOrder === -1) {
            return 1;
          }

          if (rightOrder === -1) {
            return -1;
          }

          if (leftOrder !== rightOrder) {
            return leftOrder - rightOrder;
          }
        }

        const byRecency = compareConversationRecency(left.key, right.key);
        if (byRecency !== 0) {
          return byRecency;
        }

        return left.title.localeCompare(right.title);
      });

    const contactMap = new Map(contacts.map((contact) => [getDirectConversationKey(contact.publicKey), contact]));
    const directKeys = new Set<ConversationKey>([
      ...contacts.filter(isDirectMessageContact).map((contact) => getDirectConversationKey(contact.publicKey)),
      ...Object.keys(conversations).filter((key): key is ConversationKey => key.startsWith('dm:'))
    ]);

    const directItems: ConversationListItem[] = Array.from(directKeys)
      .map((key) => {
        const contact = contactMap.get(key);
        const publicKey = contact ? contact.publicKey : fromHex(key.slice('dm:'.length));
        const fallbackShortHex = publicKey.length > 0 ? key.slice('dm:'.length, 'dm:'.length + 8) : 'unknown';
        return {
          key,
          title: contact?.displayName ?? `Node ${fallbackShortHex}`,
          subtitle: contact?.shortHex ?? fallbackShortHex,
          badge: unreadCounts[key] ? `${unreadCounts[key]}` : undefined
        };
      })
      .filter((item) => {
        if (mode !== 'dm') {
          return true;
        }

        const query = dmSearchQuery.trim().toLowerCase();
        if (!query) {
          return true;
        }

        return `${item.title} ${item.subtitle}`.toLowerCase().includes(query);
      })
      .sort((left, right) => {
        const byRecency = compareConversationRecency(left.key, right.key);
        if (byRecency !== 0) {
          return byRecency;
        }

        return left.title.localeCompare(right.title);
      });

    const selectedSections =
      mode === 'dm'
        ? [{ title: 'DMs', items: directItems }]
        : [{ title: '# Channels', items: channelItems }];

    return selectedSections.filter((section) => section.items.length > 0);
  }, [channelOrder, channels, contacts, conversations, dmSearchQuery, mode, unreadCounts]);

  const items = useMemo<ConversationListItem[]>(() => sections.flatMap((section) => section.items), [sections]);

  useEffect(() => {
    if (!activeKey && items[0]) {
      setActiveKey(items[0].key);
      return;
    }

    if (activeKey && !items.some((item) => item.key === activeKey)) {
      setActiveKey(items[0]?.key ?? null);
    }
  }, [activeKey, items]);

  const activeMessages = activeKey ? conversations[activeKey] ?? [] : [];
  const activeChannel = activeKey?.startsWith('channel:')
    ? channels.find((channel) => getChannelConversationKey(channel.index) === activeKey) ?? {
        index: Number.parseInt(activeKey.slice('channel:'.length), 10),
        name: '',
        unreadCount: 0,
        memberCount: 0
      }
    : undefined;
  const activeContact = activeKey?.startsWith('dm:')
    ? contacts.find((contact) => getDirectConversationKey(contact.publicKey) === activeKey) ?? {
        publicKey: fromHex(activeKey.slice('dm:'.length)),
        displayName: `Node ${activeKey.slice('dm:'.length, 'dm:'.length + 8)}`,
        shortHex: activeKey.slice('dm:'.length, 'dm:'.length + 8),
        routeHopCodes: [],
        advLat: 0,
        advLon: 0,
        lastSeenAt: new Date(0).toISOString()
      }
    : undefined;
  const title = activeChannel
    ? activeChannel.name
      ? `# ${activeChannel.name}`
      : `Channel ${activeChannel.index}`
    : activeContact?.displayName ?? 'Select a conversation';
  const subtitle = activeChannel
    ? ''
    : activeContact
      ? `Direct message with ${activeContact.shortHex}`
      : mode === 'dm'
        ? 'Choose a direct message.'
        : 'Choose a channel.';

  useEffect(() => {
    if (!activeKey) {
      return;
    }

    markConversationRead(activeKey);
  }, [activeKey, activeMessages.length, markConversationRead]);

  async function handleSend(body: string): Promise<void> {
    if (!activeKey) {
      return;
    }

    if (activeChannel) {
      await onSendChannelMessage(activeChannel.index, body);
      return;
    }

    if (activeContact) {
      await onSendDirectMessage(activeContact.publicKey, body);
    }
  }

  async function handleCreateHashtagChannel(event: React.FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    if (!onCreateHashtagChannel) {
      return;
    }

    const normalizedTag = newHashtag.trim().replace(/^#*/, '');
    if (!normalizedTag) {
      return;
    }

    setCreatingChannel(true);
    setChannelCreateError(null);
    try {
      const channel = await onCreateHashtagChannel(normalizedTag);
      setActiveKey(getChannelConversationKey(channel.index));
      setNewHashtag('');
    } catch (error) {
      setChannelCreateError(error instanceof Error ? error.message : 'Failed to create hashtag channel.');
    } finally {
      setCreatingChannel(false);
    }
  }

  return (
    <div className="grid h-full gap-6 xl:grid-cols-[320px_minmax(0,1fr)]">
      <ConversationList
        sections={sections}
        activeKey={activeKey}
        onSelect={setActiveKey}
        headerSlot={
          mode === 'dm' ? (
            <label className="space-y-1.5 text-sm">
              <span className="text-[11px] font-medium uppercase tracking-widest text-white/30">Search</span>
              <input
                className="mesh-input"
                placeholder="Search by node name or key"
                value={dmSearchQuery}
                onChange={(event) => setDmSearchQuery(event.target.value)}
              />
            </label>
          ) : mode === 'channel' && onCreateHashtagChannel ? (
            <form className="space-y-3" onSubmit={(event) => void handleCreateHashtagChannel(event)}>
              <label className="space-y-1.5 text-sm">
                <span className="text-[11px] font-medium uppercase tracking-widest text-white/30">Join Channel</span>
                <input
                  className="mesh-input"
                  placeholder="local"
                  value={newHashtag}
                  disabled={!connected || creatingChannel}
                  onChange={(event) => {
                    setNewHashtag(event.target.value.replace(/^#*/, ''));
                    if (channelCreateError) {
                      setChannelCreateError(null);
                    }
                  }}
                />
                <p className="text-[11px] text-white/30">
                  {newHashtag.trim() ? `Creates #${newHashtag.trim().replace(/^#*/, '')}` : 'The # prefix is added automatically.'}
                </p>
              </label>
              {channelCreateError ? <p className="text-sm text-rose-300">{channelCreateError}</p> : null}
              <button className="mesh-button-primary w-full" type="submit" disabled={!connected || creatingChannel || !newHashtag.trim()}>
                {creatingChannel ? 'Creating' : 'Create Channel'}
              </button>
            </form>
          ) : null
        }
      />
      <div className="flex min-h-0 flex-col">
        <MessageThread
          threadKey={activeKey ?? 'none'}
          title={title}
          subtitle={subtitle}
          messages={activeMessages}
          activeContact={activeContact}
        />
        <MessageComposer
          disabled={!connected || !activeKey}
          label="Outbound payload"
          maxChars={MAX_MESHCORE_MESSAGE_CHARS}
          onSend={handleSend}
        />
      </div>
    </div>
  );
}
