import { create } from 'zustand';
import type { ConnectionStatus, ConnectionTransport } from '@shared/meshcore';

export type LiveFeedEntryKind =
  | 'message'
  | 'advert'
  | 'sync'
  | 'connection'
  | 'ack'
  | 'probe';

export interface LiveFeedEntry {
  id: string;
  at: string;
  kind: LiveFeedEntryKind;
  title: string;
  detail: string;
  tone: 'neutral' | 'success' | 'warning' | 'error';
  transport: ConnectionTransport | null;
}

export interface RuntimeDiagnostics {
  nodeKey: string | null;
  lastSyncAt: string | null;
  lastSyncSource: 'initial' | 'poll' | null;
  lastSyncedMessageCount: number;
  archivedMessagesAvailable: number;
  contactsLoaded: number;
  channelsLoaded: number;
  lastPortRefreshAt: string | null;
  detectedPortCount: number;
  lastProbeAt: string | null;
  lastProbePortPath: string | null;
  lastProbeOutcome: 'success' | 'failed' | null;
  lastProbeError: string | null;
  connectedAt: string | null;
  lastDisconnectedAt: string | null;
  lastConnectionStatus: ConnectionStatus | null;
}

const MAX_FEED_ENTRIES = 250;

const INITIAL_DIAGNOSTICS: RuntimeDiagnostics = {
  nodeKey: null,
  lastSyncAt: null,
  lastSyncSource: null,
  lastSyncedMessageCount: 0,
  archivedMessagesAvailable: 0,
  contactsLoaded: 0,
  channelsLoaded: 0,
  lastPortRefreshAt: null,
  detectedPortCount: 0,
  lastProbeAt: null,
  lastProbePortPath: null,
  lastProbeOutcome: null,
  lastProbeError: null,
  connectedAt: null,
  lastDisconnectedAt: null,
  lastConnectionStatus: null
};

interface RuntimeState {
  diagnostics: RuntimeDiagnostics;
  feed: LiveFeedEntry[];
  beginSession: (nodeKey: string) => void;
  setPortSnapshot: (detectedPortCount: number) => void;
  recordProbe: (input: {
    portPath: string;
    outcome: 'success' | 'failed';
    error?: string | null;
    transport: ConnectionTransport | null;
  }) => void;
  recordSync: (input: {
    source: 'initial' | 'poll';
    syncedMessageCount: number;
    archivedMessagesAvailable?: number;
    contactsLoaded?: number;
    channelsLoaded?: number;
    transport: ConnectionTransport | null;
  }) => void;
  recordConnection: (input: {
    status: ConnectionStatus;
    transport: ConnectionTransport | null;
    error?: string | null;
  }) => void;
  addFeedEntry: (entry: Omit<LiveFeedEntry, 'id' | 'at'> & { at?: string }) => void;
}

export const useRuntimeStore = create<RuntimeState>((set) => ({
  diagnostics: INITIAL_DIAGNOSTICS,
  feed: [],
  beginSession: (nodeKey) =>
    set((state) => {
      if (state.diagnostics.nodeKey === nodeKey) {
        return state;
      }

      return {
        diagnostics: {
          ...INITIAL_DIAGNOSTICS,
          nodeKey
        },
        feed: []
      };
    }),
  setPortSnapshot: (detectedPortCount) =>
    set((state) => ({
      diagnostics: {
        ...state.diagnostics,
        lastPortRefreshAt: new Date().toISOString(),
        detectedPortCount
      }
    })),
  recordProbe: ({ portPath, outcome, error, transport }) =>
    set((state) => {
      const entry: LiveFeedEntry = {
        id: crypto.randomUUID(),
        at: new Date().toISOString(),
        kind: 'probe',
        title: outcome === 'success' ? `Connected via ${portPath}` : `Probe failed on ${portPath}`,
        detail: outcome === 'success' ? 'MeshCore companion radio responded on this transport.' : (error ?? 'Probe failed.'),
        tone: outcome === 'success' ? 'success' : 'warning',
        transport
      };

      return {
      diagnostics: {
        ...state.diagnostics,
        lastProbeAt: new Date().toISOString(),
        lastProbePortPath: portPath,
        lastProbeOutcome: outcome,
        lastProbeError: error ?? null
      },
      feed: [entry, ...state.feed].slice(0, MAX_FEED_ENTRIES)
    };
    }),
  recordSync: ({ source, syncedMessageCount, archivedMessagesAvailable, contactsLoaded, channelsLoaded, transport }) =>
    set((state) => {
      const entry: LiveFeedEntry = {
        id: crypto.randomUUID(),
        at: new Date().toISOString(),
        kind: 'sync',
        title: source === 'initial' ? 'Initial sync complete' : 'Queue sync complete',
        detail:
          source === 'initial'
            ? `${syncedMessageCount} queued messages, ${archivedMessagesAvailable ?? 0} archived, ${contactsLoaded ?? 0} contacts, ${channelsLoaded ?? 0} channels.`
            : `${syncedMessageCount} waiting messages pulled from the companion radio.`,
        tone: 'success',
        transport
      };

      return {
      diagnostics: {
        ...state.diagnostics,
        lastSyncAt: new Date().toISOString(),
        lastSyncSource: source,
        lastSyncedMessageCount: syncedMessageCount,
        archivedMessagesAvailable: archivedMessagesAvailable ?? state.diagnostics.archivedMessagesAvailable,
        contactsLoaded: contactsLoaded ?? state.diagnostics.contactsLoaded,
        channelsLoaded: channelsLoaded ?? state.diagnostics.channelsLoaded
      },
      feed:
        source === 'initial' || syncedMessageCount > 0
          ? [entry, ...state.feed].slice(0, MAX_FEED_ENTRIES)
          : state.feed
    };
    }),
  recordConnection: ({ status, transport, error }) =>
    set((state) => {
      const entry: LiveFeedEntry = {
        id: crypto.randomUUID(),
        at: new Date().toISOString(),
        kind: 'connection',
        title: `Connection ${status}`,
        detail: error ?? (transport ? `Transport: ${transport}.` : 'No active transport.'),
        tone: status === 'error' ? 'error' : status === 'connected' ? 'success' : 'neutral',
        transport
      };

      return {
      diagnostics: {
        ...state.diagnostics,
        connectedAt: status === 'connected' ? new Date().toISOString() : state.diagnostics.connectedAt,
        lastDisconnectedAt: status === 'disconnected' ? new Date().toISOString() : state.diagnostics.lastDisconnectedAt,
        lastConnectionStatus: status
      },
      feed: [entry, ...state.feed].slice(0, MAX_FEED_ENTRIES)
    };
    }),
  addFeedEntry: (entry) =>
    set((state) => ({
      feed: [
        {
          id: crypto.randomUUID(),
          at: entry.at ?? new Date().toISOString(),
          ...entry
        },
        ...state.feed
      ].slice(0, MAX_FEED_ENTRIES)
    }))
}));
