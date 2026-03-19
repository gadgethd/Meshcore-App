import { create } from 'zustand';
import type { ConnectionTransport } from '@shared/meshcore';

interface AppSettingsState {
  autoConnectUsb: boolean;
  probeAllSerialPorts: boolean;
  preferredTransport: ConnectionTransport;
  setAutoConnectUsb: (enabled: boolean) => void;
  setProbeAllSerialPorts: (enabled: boolean) => void;
  setPreferredTransport: (transport: ConnectionTransport) => void;
}

const STORAGE_KEY = 'meshcore-desktop-settings';

function defaultSettings(): Pick<AppSettingsState, 'autoConnectUsb' | 'probeAllSerialPorts' | 'preferredTransport'> {
  return {
    autoConnectUsb: true,
    probeAllSerialPorts: true,
    preferredTransport: 'usb'
  };
}

function loadInitialSettings(): Pick<AppSettingsState, 'autoConnectUsb' | 'probeAllSerialPorts' | 'preferredTransport'> {
  if (typeof window === 'undefined') {
    return defaultSettings();
  }

  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) {
      return defaultSettings();
    }

    const parsed = JSON.parse(raw) as Partial<Pick<AppSettingsState, 'autoConnectUsb' | 'probeAllSerialPorts' | 'preferredTransport'>>;
    return {
      autoConnectUsb: parsed.autoConnectUsb ?? true,
      probeAllSerialPorts: parsed.probeAllSerialPorts ?? true,
      preferredTransport: parsed.preferredTransport === 'bluetooth' ? 'bluetooth' : 'usb'
    };
  } catch {
    return defaultSettings();
  }
}

function persistSettings(settings: Pick<AppSettingsState, 'autoConnectUsb' | 'probeAllSerialPorts' | 'preferredTransport'>): void {
  if (typeof window === 'undefined') {
    return;
  }

  window.localStorage.setItem(STORAGE_KEY, JSON.stringify(settings));
}

const initialSettings = loadInitialSettings();

export const useSettingsStore = create<AppSettingsState>((set, get) => ({
  autoConnectUsb: initialSettings.autoConnectUsb,
  probeAllSerialPorts: initialSettings.probeAllSerialPorts,
  preferredTransport: initialSettings.preferredTransport,
  setAutoConnectUsb: (enabled) => {
    set({ autoConnectUsb: enabled });
    persistSettings({
      autoConnectUsb: enabled,
      probeAllSerialPorts: get().probeAllSerialPorts,
      preferredTransport: get().preferredTransport
    });
  },
  setProbeAllSerialPorts: (enabled) => {
    set({ probeAllSerialPorts: enabled });
    persistSettings({
      autoConnectUsb: get().autoConnectUsb,
      probeAllSerialPorts: enabled,
      preferredTransport: get().preferredTransport
    });
  },
  setPreferredTransport: (transport) => {
    set({ preferredTransport: transport });
    persistSettings({
      autoConnectUsb: get().autoConnectUsb,
      probeAllSerialPorts: get().probeAllSerialPorts,
      preferredTransport: transport
    });
  }
}));
