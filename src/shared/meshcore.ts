export type ConnectionStatus =
  | 'disconnected'
  | 'connecting'
  | 'syncing'
  | 'connected'
  | 'error';

export type ConnectionTransport = 'usb' | 'bluetooth';
export type AppUpdateStatus =
  | 'idle'
  | 'checking'
  | 'available'
  | 'not-available'
  | 'downloading'
  | 'downloaded'
  | 'error'
  | 'unsupported';

export const MAX_MESHCORE_MESSAGE_CHARS = 133;

export interface SerialPortInfo {
  path: string;
  manufacturer?: string;
  serialNumber?: string;
  friendlyName: string;
}

export interface MeshcoreContact {
  publicKey: number[];
  displayName: string;
  shortHex: string;
  type?: number;
  nodeId?: string;
  routeHopCodes?: string[];
  advLat: number;
  advLon: number;
  lastSeenAt: string;
}

export interface MeshcoreChannel {
  index: number;
  name: string;
  unreadCount: number;
  memberCount: number;
}

export type ConversationKey = `dm:${string}` | `channel:${number}`;

export interface MeshcoreMessage {
  id: string;
  conversationKey: ConversationKey;
  body: string;
  sentAt: string;
  direction: 'incoming' | 'outgoing' | 'system';
  authorLabel: string;
  mentioned?: boolean;
  hopCount?: number;
  publicKey?: number[];
  channelIndex?: number;
  expectedAckCrc?: number;
  acknowledged?: boolean;
}

export interface SendDirectMessageInput {
  publicKey: number[];
  body: string;
}

export interface SendChannelMessageInput {
  channelIndex: number;
  body: string;
}

export interface CreateHashtagChannelInput {
  hashtag: string;
}

export interface MeshcoreDeviceSettings {
  type: number;
  txPower: number;
  maxTxPower: number;
  publicKey: number[];
  advLat: number;
  advLon: number;
  manualAddContacts: boolean;
  radioFreq: number;
  radioBw: number;
  radioSf: number;
  radioCr: number;
  name: string;
}

export interface UpdateMeshcoreDeviceSettingsInput {
  txPower: number;
  advLat: number;
  advLon: number;
  manualAddContacts: boolean;
  radioFreq: number;
  radioBw: number;
  radioSf: number;
  radioCr: number;
  name: string;
}

export type MeshcorePushEvent =
  | { type: 'message'; message: MeshcoreMessage }
  | { type: 'advert'; contact: MeshcoreContact }
  | { type: 'battery'; batteryMillivolts: number | null }
  | { type: 'connection'; status: ConnectionStatus; error?: string }
  | { type: 'send-confirmed'; ackCrc: number };

export interface MeshcoreDeviceInfo {
  firmwareVersion: string;
  firmwareBuildDate: string;
  manufacturerModel: string;
}

export interface AppUpdateState {
  status: AppUpdateStatus;
  currentVersion: string;
  availableVersion: string | null;
  downloadedVersion: string | null;
  releaseName: string | null;
  releaseNotes: string | null;
  progressPercent: number | null;
  bytesPerSecond: number | null;
  transferredBytes: number | null;
  totalBytes: number | null;
  lastCheckedAt: string | null;
  message: string | null;
}

export interface DesktopNotificationInput {
  title: string;
  body: string;
}

export interface MeshcoreAPI {
  listPorts: () => Promise<SerialPortInfo[]>;
  connect: (portPath: string) => Promise<void>;
  disconnect: () => Promise<void>;
  syncTime: () => Promise<void>;
  getSelfInfo: () => Promise<{ name: string }>;
  getDeviceSettings: () => Promise<MeshcoreDeviceSettings>;
  getDeviceInfo: () => Promise<MeshcoreDeviceInfo>;
  getAppUpdateState: () => Promise<AppUpdateState>;
  checkForAppUpdates: () => Promise<AppUpdateState>;
  downloadAppUpdate: () => Promise<AppUpdateState>;
  installAppUpdate: () => Promise<void>;
  quitApp: () => Promise<void>;
  showDesktopNotification: (input: DesktopNotificationInput) => Promise<void>;
  getContacts: () => Promise<MeshcoreContact[]>;
  getChannels: () => Promise<MeshcoreChannel[]>;
  getWaitingMessages: () => Promise<MeshcoreMessage[]>;
  getBattery: () => Promise<number | null>;
  updateDeviceSettings: (input: UpdateMeshcoreDeviceSettingsInput) => Promise<MeshcoreDeviceSettings>;
  createHashtagChannel: (input: CreateHashtagChannelInput) => Promise<MeshcoreChannel>;
  sendDirectMessage: (input: SendDirectMessageInput) => Promise<MeshcoreMessage>;
  sendChannelMessage: (input: SendChannelMessageInput) => Promise<MeshcoreMessage>;
  reboot: () => Promise<void>;
  sendAdvert: (type: 'flood' | 'zero-hop') => Promise<void>;
  onPush: (listener: (event: MeshcorePushEvent) => void) => () => void;
  onAppUpdate: (listener: (event: AppUpdateState) => void) => () => void;
}

export const IPC_CHANNELS = {
  listPorts: 'meshcore:listPorts',
  connect: 'meshcore:connect',
  disconnect: 'meshcore:disconnect',
  syncTime: 'meshcore:syncTime',
  getSelfInfo: 'meshcore:getSelfInfo',
  getDeviceSettings: 'meshcore:getDeviceSettings',
  getDeviceInfo: 'meshcore:getDeviceInfo',
  getAppUpdateState: 'appUpdate:getState',
  checkForAppUpdates: 'appUpdate:check',
  downloadAppUpdate: 'appUpdate:download',
  installAppUpdate: 'appUpdate:install',
  quitApp: 'app:quit',
  showDesktopNotification: 'desktopNotification:show',
  getContacts: 'meshcore:getContacts',
  getChannels: 'meshcore:getChannels',
  getWaitingMessages: 'meshcore:getWaitingMessages',
  getBattery: 'meshcore:getBattery',
  updateDeviceSettings: 'meshcore:updateDeviceSettings',
  createHashtagChannel: 'meshcore:createHashtagChannel',
  sendDirectMessage: 'meshcore:sendDirectMessage',
  sendChannelMessage: 'meshcore:sendChannelMessage',
  reboot: 'meshcore:reboot',
  sendAdvert: 'meshcore:sendAdvert',
  push: 'meshcore:push',
  appUpdate: 'appUpdate:state'
} as const;

export function toHex(bytes: number[]): string {
  return bytes.map((value) => value.toString(16).padStart(2, '0')).join('');
}

export function shortHex(bytes: number[]): string {
  return toHex(bytes).slice(0, 8);
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

export function normalizeMentionLabel(label: string): string {
  return label.replace(/\s+/g, ' ').trim();
}

export function sanitizeMentionLabel(label: string): string {
  let normalized = normalizeMentionLabel(label);

  if (normalized.startsWith('@[') && normalized.endsWith(']')) {
    normalized = normalized.slice(2, -1);
  } else if (normalized.startsWith('@')) {
    normalized = normalized.slice(1);
  }

  return normalizeMentionLabel(normalized);
}

export function formatMentionToken(label: string): string {
  return `@[${sanitizeMentionLabel(label)}]`;
}

export function formatMentionDisplay(label: string): string {
  return `@${sanitizeMentionLabel(label)}`;
}

export function prettifyMentionText(text: string): string {
  return text.replace(/@\[([^\]]+)\]/g, (_, label: string) => formatMentionDisplay(label));
}

export function isChannelFallbackAuthorLabel(label: string): boolean {
  return /^Channel \d+$/i.test(normalizeMentionLabel(label));
}

export function extractChannelSenderLabel(body: string): string | null {
  const trimmed = body.trim();
  const delimiterIndex = trimmed.indexOf(':');

  if (delimiterIndex <= 0) {
    return null;
  }

  const sender = sanitizeMentionLabel(trimmed.slice(0, delimiterIndex));
  if (!sender || isChannelFallbackAuthorLabel(sender)) {
    return null;
  }

  return sender;
}

export function buildNodeMentionAliases(name: string | null | undefined, publicKey?: number[] | null): string[] {
  const aliases = new Set<string>();
  const normalizedName = normalizeMentionLabel(name ?? '');

  if (normalizedName) {
    aliases.add(normalizedName);
  }

  if (publicKey && publicKey.length > 0) {
    const shortKey = shortHex(publicKey);
    aliases.add(shortKey);
    aliases.add(shortKey.slice(0, 6));
  }

  return [...aliases];
}

export function messageMentionsAlias(body: string, alias: string): boolean {
  const normalizedAlias = sanitizeMentionLabel(alias);
  if (!normalizedAlias) {
    return false;
  }

  const escapedAlias = escapeRegExp(normalizedAlias);
  const pattern = new RegExp(`(^|\\s)(?:@\\[${escapedAlias}\\]|@${escapedAlias})(?=$|[\\s,.:;!?])`, 'i');
  return pattern.test(body);
}

export function messageMentionsNode(body: string, aliases: string[]): boolean {
  return aliases.some((alias) => messageMentionsAlias(body, alias));
}

export function fromHex(hex: string): number[] {
  const normalized = hex.trim().toLowerCase();
  if (normalized.length % 2 !== 0) {
    return [];
  }

  const bytes: number[] = [];
  for (let index = 0; index < normalized.length; index += 2) {
    const value = Number.parseInt(normalized.slice(index, index + 2), 16);
    if (Number.isNaN(value)) {
      return [];
    }

    bytes.push(value);
  }

  return bytes;
}

export function getDirectConversationKey(publicKey: number[]): ConversationKey {
  return `dm:${toHex(publicKey)}`;
}

export function getChannelConversationKey(channelIndex: number): ConversationKey {
  return `channel:${channelIndex}`;
}

export function hasGpsFix(contact: MeshcoreContact): boolean {
  return contact.advLat !== 0 || contact.advLon !== 0;
}

export function isDirectMessageContact(contact: MeshcoreContact): boolean {
  return contact.type === 1 || contact.type === undefined;
}

export function normalizeLastSeenAt(value: string | number | Date): string {
  const parsed = value instanceof Date ? value : new Date(value);

  if (!Number.isFinite(parsed.getTime())) {
    return new Date().toISOString();
  }

  const now = new Date();
  return parsed > now ? now.toISOString() : parsed.toISOString();
}

export function decodeRouteHopCodes(pathLen: number | undefined, path: Uint8Array | number[] | undefined): string[] {
  if (!Number.isFinite(pathLen) || pathLen === undefined || pathLen < 0 || pathLen === 0xff || !path) {
    return [];
  }

  const hashSize = (pathLen >> 6) + 1;
  const hashCount = pathLen & 63;
  const bytes = path instanceof Uint8Array ? path : new Uint8Array(path);
  const requiredLength = hashSize * hashCount;

  if (hashCount <= 0 || bytes.length < requiredLength) {
    return [];
  }

  const hops: string[] = [];
  for (let index = 0; index < hashCount; index += 1) {
    const start = index * hashSize;
    const end = start + hashSize;
    const fullHex = Array.from(bytes.slice(start, end))
      .map((value) => value.toString(16).padStart(2, '0'))
      .join('');
    hops.push(fullHex.slice(0, 2));
  }

  return hops;
}

function scaleCoordinate(rawValue: number, maxDegrees: number): number {
  if (!Number.isFinite(rawValue)) {
    return Number.NaN;
  }

  const scaledE7 = rawValue / 1e7;
  const scaledE6 = rawValue / 1e6;
  const e7Valid = Math.abs(scaledE7) <= maxDegrees;
  const e6Valid = Math.abs(scaledE6) <= maxDegrees;

  if (e6Valid && !e7Valid) {
    return scaledE6;
  }

  if (e7Valid && !e6Valid) {
    return scaledE7;
  }

  if (e6Valid && e7Valid) {
    // Some radios appear to advertise microdegrees instead of 1e7-scaled values.
    // When both are technically valid, prefer the higher-magnitude position rather
    // than biasing the map toward the Gulf of Guinea.
    return Math.abs(scaledE6) >= Math.abs(scaledE7) ? scaledE6 : scaledE7;
  }

  return scaledE7;
}

export function contactLatitude(contact: MeshcoreContact): number {
  return scaleCoordinate(contact.advLat, 90);
}

export function contactLongitude(contact: MeshcoreContact): number {
  return scaleCoordinate(contact.advLon, 180);
}

export function contactCoordinates(contact: MeshcoreContact): [number, number] | null {
  const latitude = contactLatitude(contact);
  const longitude = contactLongitude(contact);

  if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) {
    return null;
  }

  if (Math.abs(latitude) > 90 || Math.abs(longitude) > 180) {
    return null;
  }

  return [latitude, longitude];
}

export function trimMeshcoreMessageToCharLimit(body: string, maxChars: number): string {
  return [...body].slice(0, maxChars).join('');
}
