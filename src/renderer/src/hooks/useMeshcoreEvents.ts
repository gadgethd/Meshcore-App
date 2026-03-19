import { startTransition, useEffect, useRef } from 'react';
import type {
  ConnectionTransport,
  MeshcoreChannel,
  MeshcoreDeviceSettings,
  MeshcoreAPI,
  MeshcoreMessage,
  MeshcorePushEvent,
  SendChannelMessageInput,
  SendDirectMessageInput,
  SerialPortInfo
} from '@shared/meshcore';
import { MAX_MESHCORE_MESSAGE_CHARS, shortHex } from '@shared/meshcore';
import { useIPC } from '@renderer/hooks/useIPC';
import { bleMeshcoreClient } from '@renderer/lib/ble-meshcore-client';
import { getContactArchiveNodeKey, loadArchivedContacts, saveArchivedContacts } from '@renderer/lib/contact-archive';
import { getMessageArchiveNodeKey, loadArchivedMessages, saveArchivedMessages } from '@renderer/lib/message-archive';
import { useChannelsStore } from '@renderer/store/channels.store';
import { useConnectionStore } from '@renderer/store/connection.store';
import { useContactsStore } from '@renderer/store/contacts.store';
import { useMapArchiveStore } from '@renderer/store/map-archive.store';
import { useMessagesStore } from '@renderer/store/messages.store';
import { useRuntimeStore } from '@renderer/store/runtime.store';
import { useSettingsStore } from '@renderer/store/settings.store';

type HydratedTransport = Pick<
  MeshcoreAPI,
  'syncTime' | 'getSelfInfo' | 'getDeviceSettings' | 'getContacts' | 'getChannels' | 'getWaitingMessages' | 'getBattery'
>;

interface ConnectOptions {
  suppressError?: boolean;
}

function formatSerialConnectionError(error: unknown, portPath?: string): string {
  const fallback = error instanceof Error ? error.message : 'Unknown MeshCore error';
  const normalized = fallback.toLowerCase();

  if (normalized.includes('permission') || normalized.includes('eacces')) {
    return `Permission denied while opening ${portPath ?? 'the serial device'}. On Linux, add your user to the dialout group and re-log in.`;
  }

  if (normalized.includes('cannot lock port')) {
    return `The serial device ${portPath ?? ''} is already in use by another application.`.trim();
  }

  if (normalized.includes('cannot open') || normalized.includes('no such file') || normalized.includes('enoent')) {
    return `Could not open ${portPath ?? 'the selected serial device'}. Check the device path and refresh the port list.`;
  }

  if (normalized.includes('timed out')) {
    return `Timed out waiting for the MeshCore radio on ${portPath ?? 'the selected port'}. Confirm the companion radio firmware is running.`;
  }

  return fallback;
}

function formatBluetoothConnectionError(error: unknown): string {
  const fallback = error instanceof Error ? error.message : 'Unknown Bluetooth error';
  const normalized = fallback.toLowerCase();

  if (normalized.includes('not available')) {
    return 'Bluetooth is not available in this Electron session. Check that Bluetooth is enabled on the machine.';
  }

  if (normalized.includes('no bluetooth device selected')) {
    return 'No Bluetooth MeshCore node was selected.';
  }

  if (normalized.includes('timed out')) {
    return 'Timed out while scanning for a Bluetooth MeshCore node.';
  }

  if (normalized.includes('gatt setup failed:')) {
    // Surface the real BlueZ/GATT error so it can be diagnosed
    return fallback;
  }

  if (normalized.includes('disconnected')) {
    return 'The Bluetooth MeshCore node disconnected before setup finished.';
  }

  return fallback;
}

function normalizeError(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }

  return 'Unknown MeshCore error';
}

function describeMessageFeed(message: MeshcoreMessage): { title: string; detail: string } {
  const target =
    typeof message.channelIndex === 'number'
      ? `Channel ${message.channelIndex}`
      : 'Direct message';
  const hopSummary =
    typeof message.hopCount === 'number'
      ? ` • ${message.hopCount} ${message.hopCount === 1 ? 'hop' : 'hops'}`
      : '';
  const bodySummary = message.body.length > 120 ? `${message.body.slice(0, 117)}...` : message.body;

  return {
    title: `${target} packet`,
    detail: `${message.authorLabel}: ${bodySummary}${hopSummary}`
  };
}

function notificationTitle(message: MeshcoreMessage): string {
  if (typeof message.channelIndex === 'number') {
    return `# Channel ${message.channelIndex}`;
  }

  return message.authorLabel || 'MeshCore message';
}

function notificationBody(message: MeshcoreMessage): string {
  const body = message.body.trim();
  return body.length > 160 ? `${body.slice(0, 157)}...` : body;
}

async function maybeRequestNotificationPermission(): Promise<void> {
  if (typeof Notification === 'undefined') {
    return;
  }

  if (Notification.permission !== 'default') {
    return;
  }

  try {
    await Notification.requestPermission();
  } catch {}
}

export function useMeshcoreEvents() {
  const activeTransportRef = useRef<ConnectionTransport | null>(null);
  const autoConnectAttemptRef = useRef<{ signature: string; attemptedAt: number } | null>(null);
  const archiveNodeKeyRef = useRef<string | null>(null);
  const contactArchiveNodeKeyRef = useRef<string | null>(null);
  const connectInFlightRef = useRef(false);
  const messageSyncInFlightRef = useRef(false);
  const pendingChannelAcksRef = useRef<string[]>([]);

  useIPC<MeshcorePushEvent>(window.meshcoreAPI.onPush, (event) => {
    handlePushEvent(event, 'usb');
  });

  useEffect(() => {
    void refreshPorts();
    void maybeRequestNotificationPermission();

    const unsubscribe = bleMeshcoreClient.onPush((event) => {
      handlePushEvent(event, 'bluetooth');
    });
    const interval = window.setInterval(() => {
      if (activeTransportRef.current === 'usb' && useConnectionStore.getState().status === 'connected') {
        void syncWaitingMessages({ silent: true });
      } else if (activeTransportRef.current !== 'bluetooth') {
        void refreshPorts({ silent: true });
      }
    }, 4000);

    return () => {
      unsubscribe();
      window.clearInterval(interval);
    };
  }, []);

  function clearNodeData(): void {
    archiveNodeKeyRef.current = null;
    contactArchiveNodeKeyRef.current = null;
    pendingChannelAcksRef.current = [];
    useMessagesStore.getState().setActiveNodeKey(null);

    startTransition(() => {
      useContactsStore.getState().replaceContacts([]);
      useMapArchiveStore.getState().clearArchivedContacts();
      useChannelsStore.getState().replaceChannels([]);
      useMessagesStore.getState().replaceMessages([]);
    });

    useConnectionStore.getState().setNodeName(null);
    useConnectionStore.getState().setDeviceSettings(null);
    useConnectionStore.getState().setBattery(null);
  }

  function setActiveTransport(transport: ConnectionTransport | null): void {
    activeTransportRef.current = transport;
    useConnectionStore.getState().setTransport(transport);
  }

  function addFeedMessage(message: MeshcoreMessage, transport: ConnectionTransport | null, tone: 'neutral' | 'success' = 'neutral'): void {
    const description = describeMessageFeed(message);
    useRuntimeStore.getState().addFeedEntry({
      kind: 'message',
      title: description.title,
      detail: description.detail,
      tone,
      transport,
      at: message.sentAt
    });
  }

  function handlePushEvent(event: MeshcorePushEvent, source: ConnectionTransport): void {
    switch (event.type) {
      case 'message':
        useMessagesStore.getState().appendMessage(event.message);
        addFeedMessage(event.message, source);
        if (
          event.message.direction === 'incoming' &&
          typeof Notification !== 'undefined' &&
          Notification.permission === 'granted' &&
          !document.hasFocus()
        ) {
          const notification = new Notification(notificationTitle(event.message), {
            body: notificationBody(event.message),
            tag: event.message.conversationKey
          });

          notification.onclick = () => {
            window.focus();
            notification.close();
          };
        }
        if (archiveNodeKeyRef.current) {
          void saveArchivedMessages(archiveNodeKeyRef.current, [event.message]);
        }
        return;
      case 'advert':
        useContactsStore.getState().upsertContact(event.contact);
        if (contactArchiveNodeKeyRef.current) {
          const archivedContacts = saveArchivedContacts(contactArchiveNodeKeyRef.current, [event.contact]);
          useMapArchiveStore.getState().replaceArchivedContacts(archivedContacts);
        }
        useRuntimeStore.getState().addFeedEntry({
          kind: 'advert',
          title: `Advert from ${event.contact.displayName}`,
          detail: `${shortHex(event.contact.publicKey)} • last seen ${new Date(event.contact.lastSeenAt).toLocaleTimeString()}`,
          tone: 'neutral',
          transport: source,
          at: event.contact.lastSeenAt
        });
        return;
      case 'send-confirmed': {
        const matched = useMessagesStore.getState().acknowledgeMessage(event.ackCrc);
        if (!matched) {
          const pendingId = pendingChannelAcksRef.current.shift();
          if (pendingId) {
            useMessagesStore.getState().acknowledgeMessageById(pendingId);
          }
        }
        useRuntimeStore.getState().addFeedEntry({
          kind: 'ack',
          title: 'Transmission confirmed',
          detail: `Ack CRC ${event.ackCrc} was confirmed by the mesh.`,
          tone: 'success',
          transport: source
        });
        return;
      }
      case 'battery':
        useConnectionStore.getState().setBattery(event.batteryMillivolts);
        return;
      case 'connection':
        useConnectionStore.getState().setStatus(event.status);
        if (event.error) {
          useConnectionStore.getState().setError(event.error);
        }
        const diagnostics = useRuntimeStore.getState().diagnostics;
        if (diagnostics.lastConnectionStatus !== event.status || event.error) {
          useRuntimeStore.getState().recordConnection({
            status: event.status,
            transport: source,
            error: event.error
          });
        }

        if (event.status === 'disconnected' && activeTransportRef.current === source) {
          setActiveTransport(null);
          clearNodeData();
        }

        if (event.status === 'error' && activeTransportRef.current === source) {
          setActiveTransport(null);
        }
        return;
    }
  }

  function autoConnectSignature(port: SerialPortInfo | null): string | null {
    if (!port) {
      return null;
    }

    return `${port.path}:${port.serialNumber ?? port.friendlyName}`;
  }

  function autoConnectBatchSignature(ports: SerialPortInfo[]): string | null {
    if (ports.length === 0) {
      return null;
    }

    return ports.map((port) => autoConnectSignature(port)).filter(Boolean).join('|');
  }

  function shouldAttemptAutoConnect(signature: string | null): boolean {
    if (!signature) {
      return false;
    }

    const lastAttempt = autoConnectAttemptRef.current;
    if (!lastAttempt) {
      return true;
    }

    if (lastAttempt.signature !== signature) {
      return true;
    }

    return Date.now() - lastAttempt.attemptedAt > 15000;
  }

  function noteAutoConnectAttempt(signature: string | null): void {
    if (!signature) {
      return;
    }

    autoConnectAttemptRef.current = {
      signature,
      attemptedAt: Date.now()
    };
  }

  async function hydrateTransport(transport: ConnectionTransport, client: HydratedTransport): Promise<void> {
    useConnectionStore.getState().setStatus('syncing');
    useRuntimeStore.getState().recordConnection({ status: 'syncing', transport });

    // syncTime must be first per companion protocol requirements
    try {
      await client.syncTime();
    } catch (error) {
      if (transport === 'usb') {
        throw error;
      }
    }

    const selfInfo = await client.getSelfInfo();
    const deviceSettings = await client.getDeviceSettings();
    const archiveNodeKey = getMessageArchiveNodeKey(deviceSettings.publicKey);
    const contactArchiveNodeKey = getContactArchiveNodeKey(deviceSettings.publicKey);
    const archivedMessages = await loadArchivedMessages(archiveNodeKey);
    const archivedContacts = loadArchivedContacts(contactArchiveNodeKey);
    const contacts = await client.getContacts();
    const channels = await client.getChannels();
    const waitingMessages = await client.getWaitingMessages();
    const batteryMillivolts = await client.getBattery();
    const hydratedMessages = [...archivedMessages, ...waitingMessages];
    const hydratedArchivedContacts = saveArchivedContacts(contactArchiveNodeKey, [...archivedContacts, ...contacts]);

    archiveNodeKeyRef.current = archiveNodeKey;
    contactArchiveNodeKeyRef.current = contactArchiveNodeKey;
    useRuntimeStore.getState().beginSession(archiveNodeKey);
    if (waitingMessages.length > 0) {
      await saveArchivedMessages(archiveNodeKey, waitingMessages);
    }

    // Set node key before replaceMessages so unread counts are computed against persisted read timestamps
    useMessagesStore.getState().setActiveNodeKey(archiveNodeKey);
    useRuntimeStore.getState().recordSync({
      source: 'initial',
      syncedMessageCount: waitingMessages.length,
      archivedMessagesAvailable: hydratedMessages.length,
      contactsLoaded: contacts.length,
      channelsLoaded: channels.length,
      transport
    });
    for (const message of waitingMessages) {
      addFeedMessage(message, transport, 'success');
    }

    startTransition(() => {
      useContactsStore.getState().replaceContacts(contacts);
      useMapArchiveStore.getState().replaceArchivedContacts(hydratedArchivedContacts);
      useChannelsStore.getState().replaceChannels(channels);
      useMessagesStore.getState().replaceMessages(hydratedMessages);
    });

    setActiveTransport(transport);
    useConnectionStore.getState().setNodeName(selfInfo.name);
    useConnectionStore.getState().setDeviceSettings(deviceSettings);
    useConnectionStore.getState().setBattery(batteryMillivolts);
    useConnectionStore.getState().setError(null);
    useConnectionStore.getState().setStatus('connected');
    useRuntimeStore.getState().recordConnection({ status: 'connected', transport });
  }

  async function syncWaitingMessages(options?: { silent?: boolean }): Promise<void> {
    if (messageSyncInFlightRef.current || activeTransportRef.current !== 'usb') {
      return;
    }

    messageSyncInFlightRef.current = true;

    try {
      const waitingMessages = await window.meshcoreAPI.getWaitingMessages();
      const diagnostics = useRuntimeStore.getState().diagnostics;
      if (waitingMessages.length > 0) {
        useMessagesStore.getState().appendMessages(waitingMessages);
        if (archiveNodeKeyRef.current) {
          await saveArchivedMessages(archiveNodeKeyRef.current, waitingMessages);
        }
        for (const message of waitingMessages) {
          addFeedMessage(message, 'usb', 'success');
        }
      }
      useRuntimeStore.getState().recordSync({
        source: 'poll',
        syncedMessageCount: waitingMessages.length,
        archivedMessagesAvailable: diagnostics.archivedMessagesAvailable + waitingMessages.length,
        transport: 'usb'
      });
    } catch (error) {
      if (!options?.silent) {
        useConnectionStore.getState().setError(normalizeError(error));
      }
    } finally {
      messageSyncInFlightRef.current = false;
    }
  }

  async function refreshPorts(options?: { silent?: boolean }): Promise<void> {
    try {
      const ports = await window.meshcoreAPI.listPorts();
      useConnectionStore.getState().setPorts(ports);
      useRuntimeStore.getState().setPortSnapshot(ports.length);

      const connectionState = useConnectionStore.getState();
      const selectedPort = connectionState.portPath;
      const bestPort = ports[0] ?? null;
      const selectedPortPresent = selectedPort ? ports.some((port) => port.path === selectedPort) : false;

      if (
        activeTransportRef.current === 'usb' &&
        selectedPort &&
        !selectedPortPresent &&
        !connectInFlightRef.current
      ) {
        setActiveTransport(null);
        clearNodeData();
        useConnectionStore.getState().setPortPath(null);
        useConnectionStore.getState().setStatus('disconnected');
      }

      if (!selectedPort && bestPort) {
        useConnectionStore.getState().setPortPath(bestPort.path);
      }

      if (selectedPort && !selectedPortPresent && bestPort) {
        useConnectionStore.getState().setPortPath(bestPort.path);
      }

      if (
        activeTransportRef.current !== 'bluetooth' &&
        ports.length > 0 &&
        !connectInFlightRef.current &&
        useSettingsStore.getState().preferredTransport === 'usb' &&
        useSettingsStore.getState().autoConnectUsb &&
        (connectionState.status === 'disconnected' || connectionState.status === 'error') &&
        shouldAttemptAutoConnect(autoConnectBatchSignature(ports))
      ) {
        const signature = autoConnectBatchSignature(ports);
        noteAutoConnectAttempt(signature);
        void autoConnect(ports).catch(() => {});
      }
    } catch (error) {
      if (!options?.silent) {
        useConnectionStore.getState().setError(normalizeError(error));
      }
    }
  }

  async function autoConnect(ports: SerialPortInfo[]): Promise<void> {
    let lastError: string | null = null;
    const candidates = useSettingsStore.getState().probeAllSerialPorts ? ports : ports.slice(0, 1);

    for (const port of candidates) {
      try {
        await connect(port.path, { suppressError: true });
        useRuntimeStore.getState().recordProbe({
          portPath: port.path,
          outcome: 'success',
          transport: 'usb'
        });
        return;
      } catch (error) {
        lastError = formatSerialConnectionError(error, port.path);
        useRuntimeStore.getState().recordProbe({
          portPath: port.path,
          outcome: 'failed',
          error: lastError,
          transport: 'usb'
        });
      }
    }

    if (lastError) {
      useConnectionStore.getState().setTransport(null);
      useConnectionStore.getState().setStatus('error');
      useConnectionStore.getState().setError(lastError);
    }
  }

  async function connect(portPath: string, options?: ConnectOptions): Promise<void> {
    const trimmedPortPath = portPath.trim();
    if (!trimmedPortPath) {
      const message = 'Enter a serial device path or choose one of the detected radios.';
      useConnectionStore.getState().setStatus('error');
      useConnectionStore.getState().setError(message);
      throw new Error(message);
    }

    if (connectInFlightRef.current) {
      return;
    }

    connectInFlightRef.current = true;
    useConnectionStore.getState().setStatus('connecting');
    useConnectionStore.getState().setError(null);
    useConnectionStore.getState().setTransport('usb');
    useConnectionStore.getState().setPortPath(trimmedPortPath);
    useRuntimeStore.getState().recordConnection({ status: 'connecting', transport: 'usb' });

    try {
      if (activeTransportRef.current === 'bluetooth') {
        await bleMeshcoreClient.disconnect();
      }

      await window.meshcoreAPI.connect(trimmedPortPath);
      await hydrateTransport('usb', window.meshcoreAPI);
    } catch (error) {
      setActiveTransport(null);
      useConnectionStore.getState().setTransport(null);
      if (!options?.suppressError) {
        useConnectionStore.getState().setStatus('error');
        const formattedError = formatSerialConnectionError(error, trimmedPortPath);
        useConnectionStore.getState().setError(formattedError);
        useRuntimeStore.getState().recordConnection({ status: 'error', transport: null, error: formattedError });
      } else {
        useConnectionStore.getState().setStatus('disconnected');
      }
      throw error;
    } finally {
      connectInFlightRef.current = false;
    }
  }

  async function connectBluetooth(): Promise<void> {
    if (connectInFlightRef.current) {
      return;
    }

    connectInFlightRef.current = true;
    useConnectionStore.getState().setStatus('connecting');
    useConnectionStore.getState().setError(null);
    useConnectionStore.getState().setTransport('bluetooth');
    useConnectionStore.getState().setPortPath(null);
    useRuntimeStore.getState().recordConnection({ status: 'connecting', transport: 'bluetooth' });

    try {
      if (activeTransportRef.current === 'usb') {
        await window.meshcoreAPI.disconnect();
      }

      await bleMeshcoreClient.connect();
      await hydrateTransport('bluetooth', bleMeshcoreClient);
    } catch (error) {
      setActiveTransport(null);
      useConnectionStore.getState().setTransport(null);
      useConnectionStore.getState().setStatus('error');
      const formattedError = formatBluetoothConnectionError(error);
      useConnectionStore.getState().setError(formattedError);
      useRuntimeStore.getState().recordConnection({ status: 'error', transport: null, error: formattedError });
      throw error;
    } finally {
      connectInFlightRef.current = false;
    }
  }

  async function disconnect(): Promise<void> {
    if (activeTransportRef.current === 'bluetooth') {
      await bleMeshcoreClient.disconnect();
    } else {
      await window.meshcoreAPI.disconnect();
    }

    clearNodeData();
    setActiveTransport(null);
    useConnectionStore.getState().setStatus('disconnected');
    autoConnectAttemptRef.current = null;
    useRuntimeStore.getState().recordConnection({ status: 'disconnected', transport: null });
  }

  async function sendDirectMessage(input: SendDirectMessageInput): Promise<void> {
    if ([...input.body].length > MAX_MESHCORE_MESSAGE_CHARS) {
      throw new Error(`Messages are limited to ${MAX_MESHCORE_MESSAGE_CHARS} characters.`);
    }

    const message =
      activeTransportRef.current === 'bluetooth'
        ? await bleMeshcoreClient.sendDirectMessage(input)
        : await window.meshcoreAPI.sendDirectMessage(input);
    useMessagesStore.getState().appendMessage(message);
    if (archiveNodeKeyRef.current) {
      await saveArchivedMessages(archiveNodeKeyRef.current, [message]);
    }
  }

  async function sendChannelMessage(input: SendChannelMessageInput): Promise<void> {
    if ([...input.body].length > MAX_MESHCORE_MESSAGE_CHARS) {
      throw new Error(`Messages are limited to ${MAX_MESHCORE_MESSAGE_CHARS} characters.`);
    }

    const message =
      activeTransportRef.current === 'bluetooth'
        ? await bleMeshcoreClient.sendChannelMessage(input)
        : await window.meshcoreAPI.sendChannelMessage(input);
    pendingChannelAcksRef.current.push(message.id);
    useMessagesStore.getState().appendMessage(message);
    if (archiveNodeKeyRef.current) {
      await saveArchivedMessages(archiveNodeKeyRef.current, [message]);
    }
  }

  async function updateDeviceSettings(input: import('@shared/meshcore').UpdateMeshcoreDeviceSettingsInput): Promise<MeshcoreDeviceSettings> {
    const deviceSettings =
      activeTransportRef.current === 'bluetooth'
        ? await bleMeshcoreClient.updateDeviceSettings(input)
        : await window.meshcoreAPI.updateDeviceSettings(input);
    useConnectionStore.getState().setDeviceSettings(deviceSettings);
    useConnectionStore.getState().setNodeName(deviceSettings.name);
    return deviceSettings;
  }

  async function createHashtagChannel(hashtag: string): Promise<MeshcoreChannel> {
    const channel = await window.meshcoreAPI.createHashtagChannel({ hashtag });
    const channels = await window.meshcoreAPI.getChannels();
    useChannelsStore.getState().replaceChannels(channels);
    return channel;
  }

  async function getDeviceInfo(): Promise<import('@shared/meshcore').MeshcoreDeviceInfo> {
    return window.meshcoreAPI.getDeviceInfo();
  }

  async function reboot(): Promise<void> {
    await window.meshcoreAPI.reboot();
  }

  async function sendAdvert(type: 'flood' | 'zero-hop'): Promise<void> {
    await window.meshcoreAPI.sendAdvert(type);
  }

  return {
    connect,
    connectBluetooth,
    disconnect,
    refreshPorts,
    syncWaitingMessages,
    updateDeviceSettings,
    createHashtagChannel,
    sendDirectMessage,
    sendChannelMessage,
    getDeviceInfo,
    reboot,
    sendAdvert
  };
}
