import { create } from 'zustand';
import type { ConversationKey, MeshcoreMessage } from '@shared/meshcore';

const READ_TIMESTAMPS_KEY = 'meshcore-desktop-read-at';

function loadReadTimestamps(nodeKey: string): Record<string, string> {
  try {
    const raw = localStorage.getItem(READ_TIMESTAMPS_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw) as Record<string, Record<string, string>>;
    return parsed[nodeKey] ?? {};
  } catch {
    return {};
  }
}

function saveReadTimestamp(nodeKey: string, conversationKey: string, readAt: string): void {
  try {
    const raw = localStorage.getItem(READ_TIMESTAMPS_KEY);
    const parsed = raw ? (JSON.parse(raw) as Record<string, Record<string, string>>) : {};
    parsed[nodeKey] = { ...(parsed[nodeKey] ?? {}), [conversationKey]: readAt };
    localStorage.setItem(READ_TIMESTAMPS_KEY, JSON.stringify(parsed));
  } catch {}
}

interface MessagesState {
  conversations: Record<ConversationKey, MeshcoreMessage[]>;
  unreadCounts: Record<ConversationKey, number>;
  activeNodeKey: string | null;
  setActiveNodeKey: (nodeKey: string | null) => void;
  replaceMessages: (messages: MeshcoreMessage[]) => void;
  appendMessage: (message: MeshcoreMessage) => void;
  appendMessages: (messages: MeshcoreMessage[]) => void;
  markConversationRead: (conversationKey: ConversationKey) => void;
  acknowledgeMessage: (ackCrc: number) => boolean;
  acknowledgeMessageById: (messageId: string) => void;
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

function mergeConversationMessages(existing: MeshcoreMessage[], incoming: MeshcoreMessage[]): MeshcoreMessage[] {
  const merged = [...existing];
  const seenFingerprints = new Set(merged.map(messageFingerprint));

  for (const message of incoming) {
    const fingerprint = messageFingerprint(message);
    if (seenFingerprints.has(fingerprint)) {
      continue;
    }

    seenFingerprints.add(fingerprint);
    merged.push(message);
  }

  return merged.sort((left, right) => left.sentAt.localeCompare(right.sentAt));
}

function groupMessages(messages: MeshcoreMessage[]): Record<ConversationKey, MeshcoreMessage[]> {
  return messages.reduce<Record<ConversationKey, MeshcoreMessage[]>>((accumulator, message) => {
    const bucket = accumulator[message.conversationKey] ?? [];
    accumulator[message.conversationKey] = mergeConversationMessages(bucket, [message]);
    return accumulator;
  }, {} as Record<ConversationKey, MeshcoreMessage[]>);
}

function countUnreadMessages(messages: MeshcoreMessage[], latestReadAt?: string): number {
  return messages.filter((message) => {
    if (message.direction !== 'incoming') {
      return false;
    }

    if (!latestReadAt) {
      return true;
    }

    return message.sentAt > latestReadAt;
  }).length;
}

export const useMessagesStore = create<MessagesState>((set) => ({
  conversations: {} as Record<ConversationKey, MeshcoreMessage[]>,
  unreadCounts: {} as Record<ConversationKey, number>,
  activeNodeKey: null,
  setActiveNodeKey: (nodeKey) => set({ activeNodeKey: nodeKey }),
  replaceMessages: (messages) =>
    set((state) => {
      const conversations = groupMessages(messages);
      const readTimestamps = state.activeNodeKey ? loadReadTimestamps(state.activeNodeKey) : {};
      const unreadCounts = Object.fromEntries(
        Object.entries(conversations).map(([conversationKey, bucket]) => [
          conversationKey,
          countUnreadMessages(bucket, readTimestamps[conversationKey])
        ])
      ) as Record<ConversationKey, number>;

      return {
        conversations,
        unreadCounts
      };
    }),
  appendMessage: (message) =>
    set((state) => {
      const existing = state.conversations[message.conversationKey] ?? [];
      const merged = mergeConversationMessages(existing, [message]);
      const isNewIncoming = message.direction === 'incoming' && merged.length > existing.length;

      return {
        conversations: {
          ...state.conversations,
          [message.conversationKey]: merged
        },
        unreadCounts: {
          ...state.unreadCounts,
          [message.conversationKey]: isNewIncoming
            ? (state.unreadCounts[message.conversationKey] ?? 0) + 1
            : state.unreadCounts[message.conversationKey] ?? 0
        }
      };
    }),
  appendMessages: (messages) =>
    set((state) => {
      const unreadCounts = { ...state.unreadCounts };
      const conversations = messages.reduce<Record<ConversationKey, MeshcoreMessage[]>>((accumulator, message) => {
        const existing = accumulator[message.conversationKey] ?? state.conversations[message.conversationKey] ?? [];
        const merged = mergeConversationMessages(existing, [message]);
        const beforeCount = existing.length;
        accumulator[message.conversationKey] = merged;

        if (message.direction === 'incoming' && merged.length > beforeCount) {
          unreadCounts[message.conversationKey] = (unreadCounts[message.conversationKey] ?? 0) + 1;
        }

        return accumulator;
      }, { ...state.conversations });

      return {
        conversations,
        unreadCounts
      };
    }),
  acknowledgeMessage: (ackCrc) => {
    let matched = false;

    set((state) => {
      const updated: Record<ConversationKey, MeshcoreMessage[]> = {};
      let changed = false;

      for (const [key, messages] of Object.entries(state.conversations)) {
        const next = messages.map((message) => {
          if (message.expectedAckCrc === ackCrc && !message.acknowledged) {
            changed = true;
            matched = true;
            return { ...message, acknowledged: true };
          }

          return message;
        });

        updated[key as ConversationKey] = next;
      }

      return changed ? { conversations: updated } : state;
    });

    return matched;
  },
  acknowledgeMessageById: (messageId) =>
    set((state) => {
      const updated: Record<ConversationKey, MeshcoreMessage[]> = {};
      let changed = false;

      for (const [key, messages] of Object.entries(state.conversations)) {
        const next = messages.map((message) => {
          if (message.id === messageId && !message.acknowledged) {
            changed = true;
            return { ...message, acknowledged: true };
          }

          return message;
        });

        updated[key as ConversationKey] = next;
      }

      return changed ? { conversations: updated } : state;
    }),
  markConversationRead: (conversationKey) =>
    set((state) => {
      const messages = state.conversations[conversationKey] ?? [];
      const latestAt = messages.at(-1)?.sentAt;
      if (latestAt && state.activeNodeKey) {
        saveReadTimestamp(state.activeNodeKey, conversationKey, latestAt);
      }
      return {
        unreadCounts: {
          ...state.unreadCounts,
          [conversationKey]: 0
        }
      };
    })
}));
