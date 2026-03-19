import { EventEmitter } from 'node:events';
import { randomUUID } from 'node:crypto';
import type {
  CreateHashtagChannelInput,
  ConnectionStatus,
  MeshcoreChannel,
  MeshcoreContact,
  MeshcoreDeviceInfo,
  MeshcoreDeviceSettings,
  MeshcoreMessage,
  MeshcorePushEvent,
  SendChannelMessageInput,
  SendDirectMessageInput,
  UpdateMeshcoreDeviceSettingsInput
} from '@shared/meshcore';
import {
  decodeRouteHopCodes,
  getChannelConversationKey,
  getDirectConversationKey,
  normalizeLastSeenAt,
  shortHex
} from '@shared/meshcore';

interface MeshcoreLibraryContact {
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

interface MeshcoreLibraryChannel {
  channelIdx: number;
  name: string;
  secret: Uint8Array;
}

interface MeshcoreLibraryContactMessage {
  pubKeyPrefix: Uint8Array;
  pathLen: number;
  senderTimestamp: number;
  text: string;
}

interface MeshcoreLibraryChannelMessage {
  channelIdx: number;
  pathLen: number;
  senderTimestamp: number;
  text: string;
}

interface MeshcoreLibraryWaitingMessage {
  contactMessage?: MeshcoreLibraryContactMessage;
  channelMessage?: MeshcoreLibraryChannelMessage;
}

interface MeshcoreLibraryBattery {
  batteryMilliVolts: number;
}

interface MeshcoreLibraryDeviceInfo {
  firmwareVer: string;
  firmware_build_date: string;
  manufacturerModel: string;
}

interface MeshcoreLibrarySelfInfo {
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

interface MeshcoreConnection {
  emit: (event: string | number, payload?: unknown) => void;
  on: (event: string | number, callback: (...args: unknown[]) => void) => void;
  off: (event: string | number, callback: (...args: unknown[]) => void) => void;
  connect: () => Promise<void>;
  close: () => Promise<void>;
  syncDeviceTime: () => Promise<void>;
  getSelfInfo: (timeoutMillis?: number | null) => Promise<MeshcoreLibrarySelfInfo>;
  getContacts: () => Promise<MeshcoreLibraryContact[]>;
  findContactByPublicKeyPrefix: (prefix: Uint8Array) => Promise<MeshcoreLibraryContact | undefined>;
  getChannels: () => Promise<MeshcoreLibraryChannel[]>;
  getWaitingMessages: () => Promise<MeshcoreLibraryWaitingMessage[]>;
  getBatteryVoltage: () => Promise<MeshcoreLibraryBattery>;
  setChannel: (channelIndex: number, name: string, secret: Uint8Array) => Promise<unknown>;
  setAdvertName: (name: string) => Promise<unknown>;
  setAdvertLatLong: (latitude: number, longitude: number) => Promise<unknown>;
  setTxPower: (txPower: number) => Promise<unknown>;
  setRadioParams: (radioFreq: number, radioBw: number, radioSf: number, radioCr: number) => Promise<unknown>;
  setOtherParams: (manualAddContacts: boolean) => Promise<unknown>;
  sendTextMessage: (publicKey: Uint8Array, text: string) => Promise<{ result: number; expectedAckCrc: number; estTimeout: number }>;
  sendChannelTextMessage: (channelIndex: number, text: string) => Promise<unknown>;
  reboot: () => Promise<unknown>;
  sendFloodAdvert: () => Promise<unknown>;
  sendZeroHopAdvert: () => Promise<unknown>;
  deviceQuery: () => Promise<MeshcoreLibraryDeviceInfo>;
}

interface MeshcoreConstants {
  ResponseCodes: {
    ContactMsgRecv: number;
    ChannelMsgRecv: number;
  };
  PushCodes: {
    Advert: number;
    NewAdvert: number;
    MsgWaiting: number;
    SendConfirmed: number;
  };
}

type MeshcoreModule = {
  NodeJSSerialConnection: new (path: string) => MeshcoreConnection;
  Constants: MeshcoreConstants;
  TransportKeyUtil: {
    getHashtagRegionKey: (regionName: string) => Promise<Uint8Array>;
  };
};

type ConnectionListener = {
  event: string | number;
  handler: (...args: unknown[]) => void;
};

const COMPANION_V3_CONTACT_MESSAGE_CODE = 0x10;
const COMPANION_V3_CHANNEL_MESSAGE_CODE = 0x11;

let meshcoreLibraryPatched = false;

function readUInt32LE(bytes: Uint8Array, offset: number): number {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  return view.getUint32(offset, true);
}

function decodeUtf8(bytes: Uint8Array): string {
  return new TextDecoder().decode(bytes);
}

function parseCompanionV3ContactMessage(frame: Uint8Array): MeshcoreLibraryContactMessage & { pathLen: number; txtType: number } {
  let offset = 1;
  offset += 3; // SNR + reserved

  const pubKeyPrefix = frame.slice(offset, offset + 6);
  offset += 6;

  const pathLen = frame[offset] ?? 0;
  const txtType = frame[offset + 1] ?? 0;
  offset += 2;

  const senderTimestamp = offset + 4 <= frame.length ? readUInt32LE(frame, offset) : 0;
  offset += 4;

  if (txtType === 2) {
    offset += 4; // signed-message auth code
  }

  return {
    pubKeyPrefix,
    pathLen,
    txtType,
    senderTimestamp,
    text: decodeUtf8(frame.slice(offset))
  };
}

function parseCompanionV3ChannelMessage(frame: Uint8Array): MeshcoreLibraryChannelMessage & { pathLen: number; txtType: number } {
  let offset = 1;
  offset += 3; // SNR + reserved

  const channelIdx = frame[offset] ?? 0;
  const pathLen = frame[offset + 1] ?? 0;
  const txtType = frame[offset + 2] ?? 0;
  offset += 3;

  const senderTimestamp = offset + 4 <= frame.length ? readUInt32LE(frame, offset) : 0;
  offset += 4;

  return {
    channelIdx,
    pathLen,
    txtType,
    senderTimestamp,
    text: decodeUtf8(frame.slice(offset))
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

function patchOfficialMeshcoreLibrary(module: MeshcoreModule): void {
  if (meshcoreLibraryPatched) {
    return;
  }

  const connectionPrototype = findConnectionPrototype(module.NodeJSSerialConnection.prototype);
  if (!connectionPrototype) {
    return;
  }

  const originalOnFrameReceived = connectionPrototype.onFrameReceived;
  if (typeof originalOnFrameReceived !== 'function') {
    return;
  }

  module.Constants.ResponseCodes = {
    ...module.Constants.ResponseCodes,
    ContactMsgRecvV3: COMPANION_V3_CONTACT_MESSAGE_CODE,
    ChannelMsgRecvV3: COMPANION_V3_CHANNEL_MESSAGE_CODE
  } as MeshcoreConstants['ResponseCodes'] & {
    ContactMsgRecvV3: number;
    ChannelMsgRecvV3: number;
  };

  connectionPrototype.onFrameReceived = function patchedOnFrameReceived(this: MeshcoreConnection, frame: Uint8Array): void {
    const responseCode = frame[0];

    if (responseCode === COMPANION_V3_CONTACT_MESSAGE_CODE) {
      this.emit('rx', frame);
      this.emit(module.Constants.ResponseCodes.ContactMsgRecv, parseCompanionV3ContactMessage(frame));
      return;
    }

    if (responseCode === COMPANION_V3_CHANNEL_MESSAGE_CODE) {
      this.emit('rx', frame);
      this.emit(module.Constants.ResponseCodes.ChannelMsgRecv, parseCompanionV3ChannelMessage(frame));
      return;
    }

    Reflect.apply(originalOnFrameReceived, this, [frame]);
  };

  meshcoreLibraryPatched = true;
}

function createContact(publicKey: number[], displayName: string, advLat: number, advLon: number): MeshcoreContact {
  return {
    publicKey,
    displayName,
    shortHex: shortHex(publicKey),
    advLat,
    advLon,
    lastSeenAt: new Date().toISOString()
  };
}

function createMessage(
  message: Omit<MeshcoreMessage, 'id' | 'sentAt'> & { sentAt?: string }
): MeshcoreMessage {
  const { sentAt, ...rest } = message;

  return {
    id: randomUUID(),
    sentAt: sentAt ?? new Date().toISOString(),
    ...rest
  };
}

function toIsoDate(epochSeconds: number | undefined): string {
  if (!epochSeconds) {
    return new Date().toISOString();
  }

  return new Date(epochSeconds * 1000).toISOString();
}

function normalizeError(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }

  return 'Unknown MeshCore error';
}

function mapLibraryContact(contact: MeshcoreLibraryContact): MeshcoreContact {
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

function mapLibraryChannel(channel: MeshcoreLibraryChannel): MeshcoreChannel {
  return {
    index: channel.channelIdx,
    name: channel.name || `Channel ${channel.channelIdx}`,
    unreadCount: 0,
    memberCount: 0
  };
}

function isConfiguredLibraryChannel(channel: MeshcoreLibraryChannel): boolean {
  if (channel.name.trim().length > 0) {
    return true;
  }

  return Array.from(channel.secret).some((value) => value !== 0);
}

function mapSelfInfo(selfInfo: MeshcoreLibrarySelfInfo): MeshcoreDeviceSettings {
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

class MockMeshcoreState {
  private selfInfo: MeshcoreDeviceSettings = {
    type: 1,
    txPower: 14,
    maxTxPower: 22,
    publicKey: Array.from({ length: 32 }, (_, index) => index),
    advLat: 515073000,
    advLon: -1278000,
    manualAddContacts: false,
    radioFreq: 869525000,
    radioBw: 250000,
    radioSf: 11,
    radioCr: 5,
    name: 'MeshCore Alpha'
  };
  private batteryMillivolts = 4010;
  private contacts: MeshcoreContact[] = [
    { ...createContact([0xde, 0xad, 0xbe, 0xef], 'Hilltop Relay', 515073000, -1278000), type: 2 },
    { ...createContact([0xca, 0xfe, 0xba, 0xbe], 'Alice', 515102000, -1312000), type: 1 },
    { ...createContact([0xab, 0xcd, 0xef, 0x01], 'Bob', 515111000, -1291000), type: 1 }
  ];
  private channels: MeshcoreChannel[] = [
    { index: 0, name: 'General', unreadCount: 0, memberCount: 9 },
    { index: 1, name: 'Ops', unreadCount: 0, memberCount: 3 }
  ];
  private messages: MeshcoreMessage[] = [
    createMessage({
      conversationKey: getChannelConversationKey(0),
      channelIndex: 0,
      body: 'MeshCore Desktop scaffold is online.',
      direction: 'system',
      authorLabel: 'System'
    }),
    createMessage({
      conversationKey: getDirectConversationKey([0xca, 0xfe, 0xba, 0xbe]),
      publicKey: [0xca, 0xfe, 0xba, 0xbe],
      body: 'Mock transport is active. Set MESHCORE_DESKTOP_MOCK=0 to use real hardware.',
      direction: 'incoming',
      authorLabel: 'Alice'
    })
  ];
  private timers = new Set<ReturnType<typeof setTimeout>>();

  constructor(private emit: (event: MeshcorePushEvent) => void) {}

  async connect(): Promise<void> {
    for (const contact of this.contacts) {
      const timer = setTimeout(() => {
        this.emit({ type: 'advert', contact });
        this.timers.delete(timer);
      }, 250);

      this.timers.add(timer);
    }
  }

  async disconnect(): Promise<void> {
    for (const timer of this.timers) {
      clearTimeout(timer);
    }
    this.timers.clear();
  }

  async syncTime(): Promise<void> {}

  async getSelfInfo(): Promise<{ name: string }> {
    return { name: this.selfInfo.name };
  }

  async getDeviceSettings(): Promise<MeshcoreDeviceSettings> {
    return structuredClone(this.selfInfo);
  }

  async getContacts(): Promise<MeshcoreContact[]> {
    return structuredClone(this.contacts);
  }

  async getChannels(): Promise<MeshcoreChannel[]> {
    return structuredClone(this.channels);
  }

  async getWaitingMessages(): Promise<MeshcoreMessage[]> {
    return structuredClone(this.messages);
  }

  async getBattery(): Promise<number | null> {
    return this.batteryMillivolts;
  }

  async updateDeviceSettings(input: UpdateMeshcoreDeviceSettingsInput): Promise<MeshcoreDeviceSettings> {
    this.selfInfo = {
      ...this.selfInfo,
      ...input
    };

    return structuredClone(this.selfInfo);
  }

  async getDeviceInfo(): Promise<MeshcoreDeviceInfo> {
    return {
      firmwareVersion: 'mock-1.0.0',
      firmwareBuildDate: '2025-01-01',
      manufacturerModel: 'Mock Device'
    };
  }

  async reboot(): Promise<void> {}

  async sendAdvert(_type: 'flood' | 'zero-hop'): Promise<void> {}

  async createHashtagChannel(input: CreateHashtagChannelInput): Promise<MeshcoreChannel> {
    const normalizedTag = input.hashtag.trim().replace(/^#*/, '');
    const nextIndex = this.channels.length === 0 ? 0 : Math.max(...this.channels.map((channel) => channel.index)) + 1;
    const channel: MeshcoreChannel = {
      index: nextIndex,
      name: normalizedTag,
      unreadCount: 0,
      memberCount: 0
    };

    this.channels.push(channel);
    return structuredClone(channel);
  }

  async sendDirectMessage(input: SendDirectMessageInput): Promise<MeshcoreMessage> {
    const message = createMessage({
      conversationKey: getDirectConversationKey(input.publicKey),
      publicKey: input.publicKey,
      body: input.body,
      direction: 'outgoing',
      authorLabel: 'You'
    });

    this.messages.push(message);

    const replyContact = this.contacts.find((contact) => shortHex(contact.publicKey) === shortHex(input.publicKey));
    if (replyContact) {
      const timer = setTimeout(() => {
        const reply = createMessage({
          conversationKey: getDirectConversationKey(input.publicKey),
          publicKey: input.publicKey,
          body: `Auto-reply from ${replyContact.displayName}. Replace the mock adapter with live hardware when ready.`,
          direction: 'incoming',
          authorLabel: replyContact.displayName
        });

        this.messages.push(reply);
        this.emit({ type: 'message', message: reply });
        this.timers.delete(timer);
      }, 1200);

      this.timers.add(timer);
    }

    return structuredClone(message);
  }

  async sendChannelMessage(input: SendChannelMessageInput): Promise<MeshcoreMessage> {
    const message = createMessage({
      conversationKey: getChannelConversationKey(input.channelIndex),
      channelIndex: input.channelIndex,
      body: input.body,
      direction: 'outgoing',
      authorLabel: 'You'
    });

    this.messages.push(message);
    return structuredClone(message);
  }
}

export class MeshcoreManager {
  private events = new EventEmitter();
  private status: ConnectionStatus = 'disconnected';
  private batteryMillivolts: number | null = null;
  private connection: MeshcoreConnection | null = null;
  private connectionListeners: ConnectionListener[] = [];
  private rawChannels: MeshcoreLibraryChannel[] = [];
  private readonly mockMode = process.env.MESHCORE_DESKTOP_MOCK === '1';
  private readonly mockState = new MockMeshcoreState((event) => this.emit(event));

  onPush(listener: (event: MeshcorePushEvent) => void): () => void {
    this.events.on('push', listener);
    return () => {
      this.events.off('push', listener);
    };
  }

  async connect(portPath: string): Promise<void> {
    const trimmedPortPath = portPath.trim();
    if (!trimmedPortPath) {
      throw new Error('No serial device path provided.');
    }

    await this.disconnect();

    if (this.mockMode) {
      await this.mockState.connect();
      this.setStatus('connected');
      return;
    }

    try {
      const { NodeJSSerialConnection, Constants } = (await import('@liamcottle/meshcore.js')) as MeshcoreModule;
      patchOfficialMeshcoreLibrary({ NodeJSSerialConnection, Constants } as MeshcoreModule);
      const connection = new NodeJSSerialConnection(trimmedPortPath);

      this.connection = connection;
      this.attachConnectionListeners(connection, Constants);

      await this.waitForConnection(connection);
      this.setStatus('connected');
    } catch (error) {
      await this.teardownConnection();
      this.setStatus('error', normalizeError(error));
      throw error;
    }
  }

  async disconnect(): Promise<void> {
    if (this.mockMode) {
      await this.mockState.disconnect();
      this.batteryMillivolts = null;
      this.setStatus('disconnected');
      return;
    }

    await this.teardownConnection();
    this.batteryMillivolts = null;
    this.setStatus('disconnected');
  }

  async syncTime(): Promise<void> {
    if (this.mockMode) {
      await this.mockState.syncTime();
      return;
    }

    this.ensureConnected();
    await this.connection!.syncDeviceTime();
  }

  async getSelfInfo(): Promise<{ name: string }> {
    if (this.mockMode) {
      return this.mockState.getSelfInfo();
    }

    this.ensureConnected();
    const selfInfo = await this.connection!.getSelfInfo(5000);
    return {
      name: selfInfo.name || 'MeshCore'
    };
  }

  async getDeviceSettings(): Promise<MeshcoreDeviceSettings> {
    if (this.mockMode) {
      return this.mockState.getDeviceSettings();
    }

    this.ensureConnected();
    const selfInfo = await this.connection!.getSelfInfo(5000);
    return mapSelfInfo(selfInfo);
  }

  async getContacts(): Promise<MeshcoreContact[]> {
    if (this.mockMode) {
      return this.mockState.getContacts();
    }

    this.ensureConnected();
    const contacts = await this.connection!.getContacts();
    return contacts.map(mapLibraryContact);
  }

  async getChannels(): Promise<MeshcoreChannel[]> {
    if (this.mockMode) {
      return this.mockState.getChannels();
    }

    this.ensureConnected();
    const channels = await this.connection!.getChannels();
    this.rawChannels = channels;
    return channels.filter(isConfiguredLibraryChannel).map(mapLibraryChannel);
  }

  async getWaitingMessages(): Promise<MeshcoreMessage[]> {
    if (this.mockMode) {
      return this.mockState.getWaitingMessages();
    }

    this.ensureConnected();
    const waitingMessages = await this.connection!.getWaitingMessages();
    const messages = await Promise.all(waitingMessages.map((message) => this.mapWaitingMessage(message)));
    return messages.filter((message): message is MeshcoreMessage => message !== null);
  }

  async getBattery(): Promise<number | null> {
    if (this.mockMode) {
      return this.mockState.getBattery();
    }

    this.ensureConnected();
    const battery = await this.connection!.getBatteryVoltage();
    this.batteryMillivolts = battery.batteryMilliVolts;
    return this.batteryMillivolts;
  }

  async updateDeviceSettings(input: UpdateMeshcoreDeviceSettingsInput): Promise<MeshcoreDeviceSettings> {
    if (this.mockMode) {
      return this.mockState.updateDeviceSettings(input);
    }

    this.ensureConnected();
    await this.connection!.setAdvertName(input.name);
    await this.connection!.setAdvertLatLong(input.advLat, input.advLon);
    await this.connection!.setTxPower(input.txPower);
    await this.connection!.setRadioParams(input.radioFreq, input.radioBw, input.radioSf, input.radioCr);
    await this.connection!.setOtherParams(input.manualAddContacts);

    return this.getDeviceSettings();
  }

  async getDeviceInfo(): Promise<MeshcoreDeviceInfo> {
    if (this.mockMode) {
      return this.mockState.getDeviceInfo();
    }

    this.ensureConnected();
    const info = await this.connection!.deviceQuery();
    return {
      firmwareVersion: info.firmwareVer || '',
      firmwareBuildDate: info.firmware_build_date || '',
      manufacturerModel: info.manufacturerModel || ''
    };
  }

  async reboot(): Promise<void> {
    if (this.mockMode) {
      return this.mockState.reboot();
    }

    this.ensureConnected();
    await this.connection!.reboot();
  }

  async sendAdvert(type: 'flood' | 'zero-hop'): Promise<void> {
    if (this.mockMode) {
      return this.mockState.sendAdvert(type);
    }

    this.ensureConnected();
    if (type === 'flood') {
      await this.connection!.sendFloodAdvert();
    } else {
      await this.connection!.sendZeroHopAdvert();
    }
  }

  async createHashtagChannel(input: CreateHashtagChannelInput): Promise<MeshcoreChannel> {
    if (this.mockMode) {
      return this.mockState.createHashtagChannel(input);
    }

    this.ensureConnected();
    const normalizedTag = input.hashtag.trim().replace(/^#*/, '');
    if (!normalizedTag) {
      throw new Error('Enter a hashtag channel name.');
    }

    const { TransportKeyUtil } = (await import('@liamcottle/meshcore.js')) as MeshcoreModule;
    const rawChannels = this.rawChannels.length > 0 ? this.rawChannels : await this.connection!.getChannels();
    this.rawChannels = rawChannels;

    const firstUnusedChannel = rawChannels.find((channel) => !isConfiguredLibraryChannel(channel));
    const nextIndex = firstUnusedChannel
      ? firstUnusedChannel.channelIdx
      : rawChannels.reduce((highestIndex, channel) => Math.max(highestIndex, channel.channelIdx), -1) + 1;

    const secret = (await TransportKeyUtil.getHashtagRegionKey(`#${normalizedTag}`)).slice(0, 16);
    await this.connection!.setChannel(nextIndex, normalizedTag, secret);

    this.rawChannels = await this.connection!.getChannels();
    const createdChannel = this.rawChannels.find((channel) => channel.channelIdx === nextIndex);
    if (!createdChannel) {
      throw new Error('Channel was created but could not be reloaded.');
    }

    return mapLibraryChannel(createdChannel);
  }

  async sendDirectMessage(input: SendDirectMessageInput): Promise<MeshcoreMessage> {
    if (this.mockMode) {
      return this.mockState.sendDirectMessage(input);
    }

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
    if (this.mockMode) {
      return this.mockState.sendChannelMessage(input);
    }

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

  private async waitForConnection(connection: MeshcoreConnection): Promise<void> {
    await new Promise<void>((resolve, reject) => {
      const timeout = setTimeout(() => {
        connection.off('connected', onConnected);
        connection.off('disconnected', onDisconnected);
        reject(new Error('Timed out while opening the MeshCore serial connection.'));
      }, 10000);

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
        reject(new Error('MeshCore radio disconnected during connect.'));
      };

      connection.on('connected', onConnected);
      connection.on('disconnected', onDisconnected);

      void connection.connect().catch((error) => {
        clearTimeout(timeout);
        connection.off('connected', onConnected);
        connection.off('disconnected', onDisconnected);
        reject(error);
      });
    });
  }

  private attachConnectionListeners(connection: MeshcoreConnection, constants: MeshcoreConstants): void {
    this.detachConnectionListeners();

    const register = (event: string | number, handler: (...args: unknown[]) => void) => {
      connection.on(event, handler);
      this.connectionListeners.push({ event, handler });
    };

    register('disconnected', () => {
      this.connection = null;
      this.batteryMillivolts = null;
      this.detachConnectionListeners();
      this.setStatus('disconnected');
    });

    register(constants.PushCodes.Advert, (payload) => {
      this.emitAdvert(payload as MeshcoreLibraryContact);
    });

    register(constants.PushCodes.NewAdvert, (payload) => {
      this.emitAdvert(payload as MeshcoreLibraryContact);
    });

    register(constants.PushCodes.SendConfirmed, (payload) => {
      const { ackCode } = payload as { ackCode: number };
      this.emit({ type: 'send-confirmed', ackCrc: ackCode });
    });

    register(constants.PushCodes.MsgWaiting, async () => {
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
        this.setStatus('error', normalizeError(error));
      }
    });
  }

  private detachConnectionListeners(): void {
    if (!this.connection) {
      this.connectionListeners = [];
      return;
    }

    for (const listener of this.connectionListeners) {
      this.connection.off(listener.event, listener.handler);
    }

    this.connectionListeners = [];
  }

  private async teardownConnection(): Promise<void> {
    if (!this.connection) {
      this.connectionListeners = [];
      return;
    }

    const connection = this.connection;
    this.detachConnectionListeners();
    this.connection = null;

    try {
      await connection.close();
    } catch {}
  }

  private ensureConnected(): void {
    if (!this.mockMode && (!this.connection || this.status === 'disconnected')) {
      throw new Error('No MeshCore radio connected.');
    }
  }

  private emitAdvert(contact: MeshcoreLibraryContact): void {
    this.emit({ type: 'advert', contact: mapLibraryContact(contact) });
  }

  private async mapWaitingMessage(waitingMessage: MeshcoreLibraryWaitingMessage): Promise<MeshcoreMessage | null> {
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

  private setStatus(status: ConnectionStatus, error?: string): void {
    this.status = status;
    this.emit({ type: 'connection', status, error });
  }

  private emit(event: MeshcorePushEvent): void {
    this.events.emit('push', structuredClone(event));
  }
}
