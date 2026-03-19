import Constants from '@liamcottle/meshcore.js/src/constants.js';
import WebBleConnection from '@liamcottle/meshcore.js/src/connection/web_ble_connection.js';
import type {
  MeshcoreChannel,
  MeshcoreContact,
  MeshcoreDeviceSettings,
  MeshcoreMessage,
  MeshcorePushEvent,
  SendChannelMessageInput,
  SendDirectMessageInput
} from '@shared/meshcore';
import {
  decodeRouteHopCodes,
  getChannelConversationKey,
  getDirectConversationKey,
  normalizeLastSeenAt,
  shortHex
} from '@shared/meshcore';

interface BleLibraryContact {
  publicKey: Uint8Array;
  type: number;
  outPathLen: number;
  outPath: Uint8Array;
  advName: string;
  advLat: number;
  advLon: number;
  lastAdvert: number;
  lastMod: number;
}

interface BleLibraryChannel {
  channelIdx: number;
  name: string;
}

interface BleLibraryBattery {
  batteryMilliVolts: number;
}

interface BleLibrarySelfInfo {
  type: number;
  txPower: number;
  maxTxPower: number;
  publicKey: Uint8Array;
  advLat: number;
  advLon: number;
  manualAddContacts: number;
  radioFreq: number;
  radioBw: number;
  radioSf: number;
  radioCr: number;
  name: string;
}

interface BleLibraryContactMessage {
  pubKeyPrefix: Uint8Array;
  pathLen: number;
  senderTimestamp: number;
  text: string;
}

interface BleLibraryChannelMessage {
  channelIdx: number;
  pathLen: number;
  senderTimestamp: number;
  text: string;
}

interface BleLibraryWaitingMessage {
  contactMessage?: BleLibraryContactMessage;
  channelMessage?: BleLibraryChannelMessage;
}

interface BleConnection {
  emit?: (event: string | number, payload?: unknown) => void;
  on: (event: string | number, callback: (...args: unknown[]) => void) => void;
  off: (event: string | number, callback: (...args: unknown[]) => void) => void;
  close: () => Promise<void>;
  syncDeviceTime: () => Promise<void>;
  getSelfInfo: (timeoutMillis?: number | null) => Promise<BleLibrarySelfInfo>;
  getContacts: () => Promise<BleLibraryContact[]>;
  findContactByPublicKeyPrefix: (prefix: Uint8Array) => Promise<BleLibraryContact | undefined>;
  getChannels: () => Promise<BleLibraryChannel[]>;
  getWaitingMessages: () => Promise<BleLibraryWaitingMessage[]>;
  getBatteryVoltage: () => Promise<BleLibraryBattery>;
  sendTextMessage: (publicKey: Uint8Array, text: string) => Promise<{ result: number; expectedAckCrc: number; estTimeout: number }>;
  sendChannelTextMessage: (channelIndex: number, text: string) => Promise<unknown>;
  setAdvertName: (name: string) => Promise<unknown>;
  setAdvertLatLong: (lat: number, lon: number) => Promise<unknown>;
  setTxPower: (txPower: number) => Promise<unknown>;
  setRadioParams: (radioFreq: number, radioBw: number, radioSf: number, radioCr: number) => Promise<unknown>;
  sendCommandSetOtherParams: (manualAddContacts: number) => Promise<unknown>;
}

type Listener = {
  event: string | number;
  handler: (...args: unknown[]) => void;
};

const COMPANION_V3_CONTACT_MESSAGE_CODE = 0x10;
const COMPANION_V3_CHANNEL_MESSAGE_CODE = 0x11;

let bleLibraryPatched = false;

function toIsoDate(epochSeconds: number | undefined): string {
  if (!epochSeconds) {
    return new Date().toISOString();
  }

  return new Date(epochSeconds * 1000).toISOString();
}

function createMessage(
  message: Omit<MeshcoreMessage, 'id' | 'sentAt'> & { sentAt?: string }
): MeshcoreMessage {
  const { sentAt, ...rest } = message;
  return {
    id: crypto.randomUUID(),
    sentAt: sentAt ?? new Date().toISOString(),
    ...rest
  };
}

function mapContact(contact: BleLibraryContact): MeshcoreContact {
  const publicKey = Array.from(contact.publicKey);

  return {
    publicKey,
    displayName: contact.advName || `Node ${shortHex(publicKey)}`,
    shortHex: shortHex(publicKey),
    type: contact.type,
    routeHopCodes: decodeRouteHopCodes(contact.outPathLen, contact.outPath),
    advLat: contact.advLat,
    advLon: contact.advLon,
    lastSeenAt: normalizeLastSeenAt(toIsoDate(contact.lastAdvert || contact.lastMod))
  };
}

function mapChannel(channel: BleLibraryChannel): MeshcoreChannel {
  return {
    index: channel.channelIdx,
    name: channel.name || `Channel ${channel.channelIdx}`,
    unreadCount: 0,
    memberCount: 0
  };
}

function readUInt32LE(bytes: Uint8Array, offset: number): number {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  return view.getUint32(offset, true);
}

function decodeUtf8(bytes: Uint8Array): string {
  return new TextDecoder().decode(bytes);
}

function parseCompanionV3ContactMessage(frame: Uint8Array): BleLibraryContactMessage & { txtType: number } {
  let offset = 1;
  offset += 3;

  const pubKeyPrefix = frame.slice(offset, offset + 6);
  offset += 6;

  const pathLen = frame[offset] ?? 0;
  const txtType = frame[offset + 1] ?? 0;
  offset += 2;

  const senderTimestamp = offset + 4 <= frame.length ? readUInt32LE(frame, offset) : 0;
  offset += 4;

  if (txtType === 2) {
    offset += 4;
  }

  return {
    pubKeyPrefix,
    pathLen,
    senderTimestamp,
    text: decodeUtf8(frame.slice(offset)),
    txtType
  };
}

function parseCompanionV3ChannelMessage(frame: Uint8Array): BleLibraryChannelMessage & { txtType: number } {
  let offset = 1;
  offset += 3;

  const channelIdx = frame[offset] ?? 0;
  const pathLen = frame[offset + 1] ?? 0;
  const txtType = frame[offset + 2] ?? 0;
  offset += 3;

  const senderTimestamp = offset + 4 <= frame.length ? readUInt32LE(frame, offset) : 0;
  offset += 4;

  return {
    channelIdx,
    pathLen,
    senderTimestamp,
    text: decodeUtf8(frame.slice(offset)),
    txtType
  };
}

function findConnectionPrototype(candidate: object | null): Record<string, unknown> | null {
  let prototype: object | null = candidate;

  while (prototype) {
    if (typeof Reflect.get(prototype, 'onFrameReceived') === 'function') {
      return prototype as Record<string, unknown>;
    }

    prototype = Object.getPrototypeOf(prototype);
  }

  return null;
}

function patchBleLibrary(): void {
  if (bleLibraryPatched) {
    return;
  }

  const connectionPrototype = findConnectionPrototype(WebBleConnection.prototype);
  if (!connectionPrototype) {
    return;
  }

  const originalOnFrameReceived = connectionPrototype.onFrameReceived;
  if (typeof originalOnFrameReceived !== 'function') {
    return;
  }

  connectionPrototype.onFrameReceived = function patchedOnFrameReceived(this: BleConnection, frame: Uint8Array): void {
    const responseCode = frame[0];

    if (responseCode === COMPANION_V3_CONTACT_MESSAGE_CODE) {
      this.emit?.('rx', frame);
      this.emit?.(Constants.ResponseCodes.ContactMsgRecv, parseCompanionV3ContactMessage(frame));
      return;
    }

    if (responseCode === COMPANION_V3_CHANNEL_MESSAGE_CODE) {
      this.emit?.('rx', frame);
      this.emit?.(Constants.ResponseCodes.ChannelMsgRecv, parseCompanionV3ChannelMessage(frame));
      return;
    }

    Reflect.apply(originalOnFrameReceived, this, [frame]);
  };

  // Replace init() with a version that retries the GATT connection up to 3 times.
  // On Linux/BlueZ, the first gatt.connect() attempt frequently gets a transient
  // disconnect (device transitions from scan-phase to connection-phase). Retrying
  // after a brief delay is the standard workaround.
  const wbcProto = WebBleConnection.prototype as Record<string, unknown>;
  const SERVICE_UUID = Constants.Ble.ServiceUuid.toLowerCase();
  const CHAR_RX_UUID = Constants.Ble.CharacteristicUuidRx.toLowerCase();
  const CHAR_TX_UUID = Constants.Ble.CharacteristicUuidTx.toLowerCase();

  wbcProto.init = async function patchedInit(
    this: BleConnection & {
      bleDevice: { gatt: { connect: () => Promise<unknown>; connected: boolean }; addEventListener: (event: string, handler: () => void) => void };
      gattServer: unknown;
      rxCharacteristic: unknown;
      txCharacteristic: { startNotifications: () => Promise<void>; addEventListener: (event: string, handler: (e: Event) => void) => void } | null;
      onConnected: () => Promise<void>;
      onFrameReceived: (frame: Uint8Array) => void;
    }
  ): Promise<void> {
    let gattError: Error | null = null;

    const onGattDisconnected = () => {
      this.emit?.('disconnected');
    };
    this.bleDevice.addEventListener('gattserverdisconnected', onGattDisconnected);

    try {
      const gattServer = await this.bleDevice.gatt.connect();
      this.gattServer = gattServer;

      const server = gattServer as {
        getPrimaryService: (uuid: string) => Promise<{
          getCharacteristics: () => Promise<Array<{ uuid: string; startNotifications: () => Promise<void>; addEventListener: (e: string, h: (ev: Event) => void) => void }>>;
        }>;
      };
      const service = await server.getPrimaryService(SERVICE_UUID);
      const characteristics = await service.getCharacteristics();

      this.rxCharacteristic = characteristics.find((c) => c.uuid.toLowerCase() === CHAR_RX_UUID) ?? null;
      this.txCharacteristic = characteristics.find((c) => c.uuid.toLowerCase() === CHAR_TX_UUID) ?? null;

      if (!this.txCharacteristic) {
        throw new Error(`BLE TX characteristic not found on device. Check that NUS is enabled in MeshCore firmware.`);
      }

      await this.txCharacteristic.startNotifications();
      this.txCharacteristic.addEventListener('characteristicvaluechanged', (event: Event) => {
        const target = event.target as unknown as { value?: DataView | null } | null;
        const value = target?.value;
        if (!value) {
          return;
        }

        this.onFrameReceived(new Uint8Array(value.buffer, value.byteOffset, value.byteLength));
      });

      await this.onConnected();
      return;
    } catch (err) {
      gattError = err instanceof Error ? err : new Error(String(err));
    }

    // Store the real error so waitForConnected can surface it
    (this as unknown as Record<string, unknown>)._gattError = gattError;
    this.emit?.('disconnected');
  };

  bleLibraryPatched = true;
}

class BleMeshcoreClient {
  private connection: BleConnection | null = null;
  private cachedSelfInfo: BleLibrarySelfInfo | null = null;
  private listeners: Listener[] = [];
  private pushListeners = new Set<(event: MeshcorePushEvent) => void>();

  onPush = (listener: (event: MeshcorePushEvent) => void): (() => void) => {
    this.pushListeners.add(listener);
    return () => {
      this.pushListeners.delete(listener);
    };
  };

  async connect(): Promise<void> {
    await this.disconnect();
    patchBleLibrary();

    const bluetoothNavigator = navigator as Navigator & { bluetooth?: unknown };
    if (!bluetoothNavigator.bluetooth) {
      throw new Error('Web Bluetooth is not available in this Electron build.');
    }

    const connection = (await WebBleConnection.open()) as BleConnection | null;
    if (!connection) {
      throw new Error('No Bluetooth device selected.');
    }

    this.connection = connection;
    this.cachedSelfInfo = null;
    this.attachListeners(connection);
    await this.waitForConnected(connection);
    await new Promise((resolve) => window.setTimeout(resolve, 250));
    this.emit({ type: 'connection', status: 'connected' });
  }

  async disconnect(): Promise<void> {
    if (!this.connection) {
      this.listeners = [];
      return;
    }

    const connection = this.connection;
    this.detachListeners();
    this.connection = null;
    this.cachedSelfInfo = null;

    try {
      await connection.close();
    } catch {}

    this.emit({ type: 'connection', status: 'disconnected' });
  }

  async syncTime(): Promise<void> {
    this.ensureConnected();
    await this.connection!.syncDeviceTime();
  }

  async getSelfInfo(): Promise<{ name: string }> {
    this.ensureConnected();
    const selfInfo = this.cachedSelfInfo ?? await this.connection!.getSelfInfo(5000);
    this.cachedSelfInfo = selfInfo;
    return {
      name: selfInfo.name || 'MeshCore'
    };
  }

  async getDeviceSettings(): Promise<MeshcoreDeviceSettings> {
    this.ensureConnected();
    const selfInfo = await this.connection!.getSelfInfo(5000);
    this.cachedSelfInfo = selfInfo;
    return {
      type: selfInfo.type,
      txPower: selfInfo.txPower,
      maxTxPower: selfInfo.maxTxPower,
      publicKey: Array.from(selfInfo.publicKey),
      advLat: selfInfo.advLat,
      advLon: selfInfo.advLon,
      manualAddContacts: Boolean(selfInfo.manualAddContacts),
      radioFreq: selfInfo.radioFreq,
      radioBw: selfInfo.radioBw,
      radioSf: selfInfo.radioSf,
      radioCr: selfInfo.radioCr,
      name: selfInfo.name || 'MeshCore'
    };
  }

  async getContacts(): Promise<MeshcoreContact[]> {
    this.ensureConnected();
    const contacts = await this.connection!.getContacts();
    return contacts.map(mapContact);
  }

  async getChannels(): Promise<MeshcoreChannel[]> {
    this.ensureConnected();
    const channels = await this.connection!.getChannels();
    return channels.filter((ch) => ch.name.trim()).map(mapChannel);
  }

  async getWaitingMessages(): Promise<MeshcoreMessage[]> {
    this.ensureConnected();
    const waitingMessages = await this.connection!.getWaitingMessages();
    const messages = await Promise.all(waitingMessages.map((message) => this.mapWaitingMessage(message)));
    return messages.filter((message): message is MeshcoreMessage => message !== null);
  }

  async getBattery(): Promise<number | null> {
    this.ensureConnected();
    const battery = await this.connection!.getBatteryVoltage();
    return battery.batteryMilliVolts;
  }

  async updateDeviceSettings(input: import('@shared/meshcore').UpdateMeshcoreDeviceSettingsInput): Promise<MeshcoreDeviceSettings> {
    this.ensureConnected();

    await this.connection!.setAdvertName(input.name);
    await this.connection!.setAdvertLatLong(input.advLat, input.advLon);
    await this.connection!.setTxPower(input.txPower);
    await this.connection!.setRadioParams(input.radioFreq, input.radioBw, input.radioSf, input.radioCr);
    await this.connection!.sendCommandSetOtherParams(input.manualAddContacts ? 1 : 0);

    // Re-fetch fresh settings to confirm what the device accepted
    const updated = await this.getDeviceSettings();
    return updated;
  }

  async sendDirectMessage(input: SendDirectMessageInput): Promise<MeshcoreMessage> {
    this.ensureConnected();
    const sent = await this.connection!.sendTextMessage(new Uint8Array(input.publicKey), input.body);

    return createMessage({
      conversationKey: getDirectConversationKey(input.publicKey),
      publicKey: input.publicKey,
      body: input.body,
      direction: 'outgoing',
      authorLabel: 'You',
      expectedAckCrc: sent.expectedAckCrc
    });
  }

  async sendChannelMessage(input: SendChannelMessageInput): Promise<MeshcoreMessage> {
    this.ensureConnected();
    await this.connection!.sendChannelTextMessage(input.channelIndex, input.body);

    return createMessage({
      conversationKey: getChannelConversationKey(input.channelIndex),
      channelIndex: input.channelIndex,
      body: input.body,
      direction: 'outgoing',
      authorLabel: 'You'
    });
  }

  private async waitForConnected(connection: BleConnection): Promise<void> {
    // Allow enough time for up to 3 GATT retry attempts (each with backoff)
    await new Promise<void>((resolve, reject) => {
      const timeout = setTimeout(() => {
        connection.off('connected', onConnected);
        connection.off('disconnected', onDisconnected);
        reject(new Error('Timed out while opening the Bluetooth connection.'));
      }, 30000);

      const onConnected = () => {
        clearTimeout(timeout);
        connection.off('connected', onConnected);
        connection.off('disconnected', onDisconnected);
        resolve();
      };

      const onDisconnected = () => {
        clearTimeout(timeout);
        connection.off('connected', onConnected);
        connection.off('disconnected', onDisconnected);
        const gattError = (connection as unknown as Record<string, unknown>)._gattError;
        const detail = gattError instanceof Error ? gattError.message : null;
        reject(new Error(detail ? `GATT setup failed: ${detail}` : 'Bluetooth device disconnected during connect.'));
      };

      connection.on('connected', onConnected);
      connection.on('disconnected', onDisconnected);
    });
  }

  private attachListeners(connection: BleConnection): void {
    this.detachListeners();

    const register = (event: string | number, handler: (...args: unknown[]) => void) => {
      connection.on(event, handler);
      this.listeners.push({ event, handler });
    };

    register('disconnected', () => {
      this.connection = null;
      this.cachedSelfInfo = null;
      this.detachListeners();
      this.emit({ type: 'connection', status: 'disconnected' });
    });

    register(Constants.PushCodes.Advert, (payload) => {
      this.emit({ type: 'advert', contact: mapContact(payload as BleLibraryContact) });
    });

    register(Constants.PushCodes.NewAdvert, (payload) => {
      this.emit({ type: 'advert', contact: mapContact(payload as BleLibraryContact) });
    });

    register(Constants.PushCodes.SendConfirmed, (payload) => {
      const { ackCode } = payload as { ackCode: number };
      this.emit({ type: 'send-confirmed', ackCrc: ackCode });
    });

    register(Constants.PushCodes.MsgWaiting, async () => {
      try {
        const waitingMessages = await this.connection?.getWaitingMessages();
        if (!waitingMessages) {
          return;
        }

        const messages = await Promise.all(waitingMessages.map((message) => this.mapWaitingMessage(message)));
        for (const message of messages) {
          if (message) {
            this.emit({ type: 'message', message });
          }
        }
      } catch (error) {
        this.emit({
          type: 'connection',
          status: 'error',
          error: error instanceof Error ? error.message : 'Bluetooth transport error'
        });
      }
    });
  }

  private detachListeners(): void {
    if (!this.connection) {
      this.listeners = [];
      return;
    }

    for (const listener of this.listeners) {
      this.connection.off(listener.event, listener.handler);
    }

    this.listeners = [];
  }

  private emit(event: MeshcorePushEvent): void {
    for (const listener of this.pushListeners) {
      listener(structuredClone(event));
    }
  }

  private ensureConnected(): void {
    if (!this.connection) {
      throw new Error('No Bluetooth MeshCore node connected.');
    }
  }

  private async mapWaitingMessage(waitingMessage: BleLibraryWaitingMessage): Promise<MeshcoreMessage | null> {
    if (waitingMessage.contactMessage) {
      const publicKey = await this.resolvePublicKey(waitingMessage.contactMessage.pubKeyPrefix);
      return createMessage({
        conversationKey: getDirectConversationKey(publicKey),
        publicKey,
        body: waitingMessage.contactMessage.text,
        direction: 'incoming',
        authorLabel: `Node ${shortHex(publicKey)}`,
        hopCount:
          waitingMessage.contactMessage.pathLen >= 0 && waitingMessage.contactMessage.pathLen < 0xff
            ? waitingMessage.contactMessage.pathLen
            : undefined,
        sentAt: toIsoDate(waitingMessage.contactMessage.senderTimestamp)
      });
    }

    if (waitingMessage.channelMessage) {
      return createMessage({
        conversationKey: getChannelConversationKey(waitingMessage.channelMessage.channelIdx),
        channelIndex: waitingMessage.channelMessage.channelIdx,
        body: waitingMessage.channelMessage.text,
        direction: 'incoming',
        authorLabel: `Channel ${waitingMessage.channelMessage.channelIdx}`,
        hopCount:
          waitingMessage.channelMessage.pathLen >= 0 && waitingMessage.channelMessage.pathLen < 0xff
            ? waitingMessage.channelMessage.pathLen
            : undefined,
        sentAt: toIsoDate(waitingMessage.channelMessage.senderTimestamp)
      });
    }

    return null;
  }

  private async resolvePublicKey(pubKeyPrefix: Uint8Array): Promise<number[]> {
    if (!this.connection) {
      return Array.from(pubKeyPrefix);
    }

    try {
      const contact = await this.connection.findContactByPublicKeyPrefix(pubKeyPrefix);
      if (!contact) {
        return Array.from(pubKeyPrefix);
      }

      return Array.from(contact.publicKey);
    } catch {
      return Array.from(pubKeyPrefix);
    }
  }
}

export const bleMeshcoreClient = new BleMeshcoreClient();
