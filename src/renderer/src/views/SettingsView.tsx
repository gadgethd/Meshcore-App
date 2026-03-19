import { useEffect, useState } from 'react';
import { formatDistanceToNow } from 'date-fns';
import type {
  AppUpdateState,
  ConnectionTransport,
  MeshcoreDeviceInfo,
  MeshcoreDeviceSettings,
  UpdateMeshcoreDeviceSettingsInput
} from '@shared/meshcore';
import { APP_VERSION } from '@shared/app-meta';
import { toHex } from '@shared/meshcore';
import { useRuntimeStore } from '@renderer/store/runtime.store';
import { useSettingsStore } from '@renderer/store/settings.store';

interface SettingsViewProps {
  nodeName: string | null;
  status: string;
  transport: ConnectionTransport | null;
  portPath: string | null;
  deviceSettings: MeshcoreDeviceSettings | null;
  batteryMillivolts: number | null;
  lastError: string | null;
  connected: boolean;
  onSave: (input: UpdateMeshcoreDeviceSettingsInput) => Promise<MeshcoreDeviceSettings>;
  onConnectBluetooth: () => Promise<void>;
  onGetDeviceInfo: () => Promise<MeshcoreDeviceInfo>;
  onReboot: () => Promise<void>;
  onSendAdvert: (type: 'flood' | 'zero-hop') => Promise<void>;
}

function SettingToggle({
  title,
  description,
  checked,
  onChange
}: {
  title: string;
  description: string;
  checked: boolean;
  onChange: (checked: boolean) => void;
}) {
  return (
    <label className="flex items-start justify-between gap-4 rounded-3xl border border-white/10 bg-white/5 px-5 py-4">
      <div>
        <p className="text-sm font-semibold text-white">{title}</p>
        <p className="mt-1 text-sm text-slate-400">{description}</p>
      </div>
      <input
        className="mt-1 h-5 w-5 shrink-0 accent-cyan-300"
        type="checkbox"
        checked={checked}
        onChange={(event) => onChange(event.target.checked)}
      />
    </label>
  );
}

function formatBattery(batteryMillivolts: number | null): string {
  if (batteryMillivolts === null) {
    return 'Unknown';
  }

  return `${(batteryMillivolts / 1000).toFixed(2)} V`;
}

function formatRelative(value: string | null): string {
  if (!value) {
    return '—';
  }

  return formatDistanceToNow(new Date(value), { addSuffix: true });
}

function formatBytes(value: number | null): string {
  if (!value || value <= 0) {
    return '—';
  }

  if (value >= 1024 * 1024) {
    return `${(value / (1024 * 1024)).toFixed(1)} MB`;
  }

  if (value >= 1024) {
    return `${(value / 1024).toFixed(1)} KB`;
  }

  return `${value} B`;
}

function sanitizeReleaseNotesHtml(html: string): string {
  if (typeof window === 'undefined' || !html.trim()) {
    return '';
  }

  const parser = new DOMParser();
  const document = parser.parseFromString(`<div>${html}</div>`, 'text/html');

  for (const element of document.querySelectorAll('script, style, iframe, object, embed, link, meta')) {
    element.remove();
  }

  for (const element of document.body.querySelectorAll('*')) {
    for (const attribute of [...element.attributes]) {
      const name = attribute.name.toLowerCase();
      const value = attribute.value.trim();

      if (name.startsWith('on') || name === 'style') {
        element.removeAttribute(attribute.name);
        continue;
      }

      if ((name === 'href' || name === 'src') && value && !/^https?:|^mailto:/i.test(value)) {
        element.removeAttribute(attribute.name);
        continue;
      }

      if (name === 'target') {
        element.setAttribute('target', '_blank');
        element.setAttribute('rel', 'noreferrer');
      }
    }
  }

  return document.body.innerHTML;
}

export function SettingsView({
  nodeName,
  status,
  transport,
  portPath,
  deviceSettings,
  batteryMillivolts,
  lastError,
  connected,
  onSave,
  onConnectBluetooth,
  onGetDeviceInfo,
  onReboot,
  onSendAdvert
}: SettingsViewProps) {
  const {
    autoConnectUsb,
    probeAllSerialPorts,
    preferredTransport,
    setAutoConnectUsb,
    setProbeAllSerialPorts,
    setPreferredTransport
  } = useSettingsStore();
  const [draft, setDraft] = useState<UpdateMeshcoreDeviceSettingsInput | null>(null);
  const [saving, setSaving] = useState(false);
  const [saveStatus, setSaveStatus] = useState<'idle' | 'success' | 'error'>('idle');
  const [connectingBluetooth, setConnectingBluetooth] = useState(false);
  const [deviceInfo, setDeviceInfo] = useState<MeshcoreDeviceInfo | null>(null);
  const [appUpdate, setAppUpdate] = useState<AppUpdateState | null>(null);
  const [updateAction, setUpdateAction] = useState<'idle' | 'checking' | 'downloading' | 'installing'>('idle');
  const diagnostics = useRuntimeStore((state) => state.diagnostics);
  const releaseNotesHtml = appUpdate?.releaseNotes ? sanitizeReleaseNotesHtml(appUpdate.releaseNotes) : '';
  const [rebootConfirm, setRebootConfirm] = useState(false);
  const [rebooting, setRebooting] = useState(false);
  const [advertStatus, setAdvertStatus] = useState<{ type: 'flood' | 'zero-hop' | null; sending: boolean }>({ type: null, sending: false });

  useEffect(() => {
    if (!deviceSettings) {
      setDraft(null);
      setDeviceInfo(null);
      return;
    }

    setDraft({
      name: deviceSettings.name,
      txPower: deviceSettings.txPower,
      advLat: deviceSettings.advLat,
      advLon: deviceSettings.advLon,
      manualAddContacts: deviceSettings.manualAddContacts,
      radioFreq: deviceSettings.radioFreq,
      radioBw: deviceSettings.radioBw,
      radioSf: deviceSettings.radioSf,
      radioCr: deviceSettings.radioCr
    });

    void onGetDeviceInfo()
      .then(setDeviceInfo)
      .catch(() => {});
  }, [deviceSettings]);

  useEffect(() => {
    let cancelled = false;

    void window.meshcoreAPI.getAppUpdateState().then((state) => {
      if (!cancelled) {
        setAppUpdate(state);
      }
    });

    const unsubscribe = window.meshcoreAPI.onAppUpdate((state) => {
      setAppUpdate(state);
      if (state.status !== 'checking' && state.status !== 'downloading') {
        setUpdateAction('idle');
      }
    });

    return () => {
      cancelled = true;
      unsubscribe();
    };
  }, []);

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    if (!draft) {
      return;
    }

    setSaving(true);
    setSaveStatus('idle');
    try {
      const updated = await onSave({
        ...draft,
        name: draft.name.trim() || 'MeshCore'
      });
      setDraft({
        name: updated.name,
        txPower: updated.txPower,
        advLat: updated.advLat,
        advLon: updated.advLon,
        manualAddContacts: updated.manualAddContacts,
        radioFreq: updated.radioFreq,
        radioBw: updated.radioBw,
        radioSf: updated.radioSf,
        radioCr: updated.radioCr
      });
      setSaveStatus('success');
    } catch {
      setSaveStatus('error');
    } finally {
      setSaving(false);
      setTimeout(() => setSaveStatus('idle'), 3000);
    }
  }

  async function handleConnectBluetooth(): Promise<void> {
    setConnectingBluetooth(true);
    try {
      await onConnectBluetooth();
    } finally {
      setConnectingBluetooth(false);
    }
  }

  async function handleReboot(): Promise<void> {
    if (!rebootConfirm) {
      setRebootConfirm(true);
      setTimeout(() => setRebootConfirm(false), 4000);
      return;
    }

    setRebooting(true);
    setRebootConfirm(false);
    try {
      await onReboot();
    } finally {
      setRebooting(false);
    }
  }

  async function handleSendAdvert(type: 'flood' | 'zero-hop'): Promise<void> {
    setAdvertStatus({ type, sending: true });
    try {
      await onSendAdvert(type);
    } finally {
      setAdvertStatus({ type: null, sending: false });
    }
  }

  async function handleCheckForUpdates(): Promise<void> {
    setUpdateAction('checking');
    try {
      const state = await window.meshcoreAPI.checkForAppUpdates();
      setAppUpdate(state);
    } finally {
      setUpdateAction('idle');
    }
  }

  async function handleDownloadUpdate(): Promise<void> {
    setUpdateAction('downloading');
    try {
      const state = await window.meshcoreAPI.downloadAppUpdate();
      setAppUpdate(state);
    } finally {
      setUpdateAction('idle');
    }
  }

  async function handleInstallUpdate(): Promise<void> {
    setUpdateAction('installing');
    await window.meshcoreAPI.installAppUpdate();
  }

  return (
    <div className="grid h-full gap-6 xl:grid-cols-[minmax(0,1.15fr)_360px]">
      <form className="mesh-panel overflow-y-auto px-5 py-5" onSubmit={(event) => void handleSubmit(event)}>
        <div className="border-b border-white/[0.07] pb-4">
          <h2 className="text-base font-semibold text-white">Settings</h2>
          <p className="mt-0.5 text-sm text-white/40">Configure the desktop app and connected companion radio.</p>
        </div>
        <div className="mt-5 space-y-4">
          <div className="rounded-3xl border border-white/10 bg-white/5 px-5 py-4">
            <p className="text-sm font-semibold text-white">App updates</p>
            <p className="mt-1 text-sm text-slate-400">Check GitHub Releases, download a new build in-app, and restart when it is ready to install.</p>
            <div className="mt-4 grid gap-4 md:grid-cols-[minmax(0,1fr)_auto] md:items-start">
              <div className="space-y-2 text-sm">
                <div>
                  <p className="text-slate-400">Current version</p>
                  <p className="mt-1 font-semibold text-white">{appUpdate?.currentVersion ?? APP_VERSION}</p>
                </div>
                <div>
                  <p className="text-slate-400">Update status</p>
                  <p className="mt-1 font-semibold capitalize text-white">{appUpdate?.status ?? 'idle'}</p>
                </div>
                {appUpdate?.availableVersion ? (
                  <div>
                    <p className="text-slate-400">Available version</p>
                    <p className="mt-1 font-semibold text-white">{appUpdate.availableVersion}</p>
                  </div>
                ) : null}
                {appUpdate?.message ? (
                  <p className="rounded-2xl border border-white/10 bg-black/10 px-3 py-2 text-sm text-slate-300">{appUpdate.message}</p>
                ) : null}
                {appUpdate?.status === 'downloading' ? (
                  <div className="space-y-2">
                    <div className="h-2 overflow-hidden rounded-full bg-white/8">
                      <div
                        className="h-full rounded-full bg-cyan-300 transition-[width]"
                        style={{ width: `${Math.max(0, Math.min(100, appUpdate.progressPercent ?? 0))}%` }}
                      />
                    </div>
                    <p className="text-xs text-slate-400">
                      {Math.round(appUpdate.progressPercent ?? 0)}% • {formatBytes(appUpdate.transferredBytes)} / {formatBytes(appUpdate.totalBytes)}
                    </p>
                  </div>
                ) : null}
                {appUpdate?.releaseNotes ? (
                  <details className="rounded-2xl border border-white/10 bg-black/10 px-3 py-2 text-sm text-slate-300">
                    <summary className="cursor-pointer font-medium text-white">Release notes</summary>
                    <div
                      className="mt-2 space-y-2 text-sm text-slate-300 [&_a]:text-cyan-300 [&_a]:underline [&_code]:rounded [&_code]:bg-white/10 [&_code]:px-1 [&_code]:py-0.5 [&_li]:ml-5 [&_li]:list-disc [&_p]:mb-2 [&_strong]:text-white [&_tt]:rounded [&_tt]:bg-white/10 [&_tt]:px-1 [&_tt]:py-0.5"
                      dangerouslySetInnerHTML={{ __html: releaseNotesHtml }}
                    />
                  </details>
                ) : null}
              </div>
              <div className="flex flex-col gap-2">
                <button
                  type="button"
                  className="mesh-button-secondary"
                  disabled={updateAction !== 'idle' || appUpdate?.status === 'downloading'}
                  onClick={() => void handleCheckForUpdates()}
                >
                  {updateAction === 'checking' ? 'Checking…' : 'Check for Updates'}
                </button>
                <button
                  type="button"
                  className="mesh-button-primary"
                  disabled={updateAction !== 'idle' || appUpdate?.status !== 'available'}
                  onClick={() => void handleDownloadUpdate()}
                >
                  {updateAction === 'downloading' || appUpdate?.status === 'downloading' ? 'Downloading…' : 'Download Update'}
                </button>
                <button
                  type="button"
                  className="mesh-button-primary"
                  disabled={updateAction !== 'idle' || appUpdate?.status !== 'downloaded'}
                  onClick={() => void handleInstallUpdate()}
                >
                  {updateAction === 'installing' ? 'Restarting…' : 'Restart to Install'}
                </button>
              </div>
            </div>
          </div>
          <div className="rounded-3xl border border-white/10 bg-white/5 px-5 py-4">
            <p className="text-sm font-semibold text-white">Transport</p>
            <p className="mt-1 text-sm text-slate-400">Choose whether the desktop app should prefer USB or Bluetooth in the desktop UI and auto-connect behavior.</p>
            <div className="mt-4 grid gap-3 md:grid-cols-2">
              {([
                ['usb', 'USB', 'Auto-detect and connect over serial when a companion radio is attached.'],
                ['bluetooth', 'Bluetooth', 'Set Bluetooth as the preferred transport shown in the app.']
              ] as const).map(([value, label, description]) => (
                <button
                  key={value}
                  type="button"
                  className={`rounded-2xl border px-4 py-4 text-left transition ${
                    preferredTransport === value
                      ? 'border-cyan-300/50 bg-cyan-300/12 text-white'
                      : 'border-white/10 bg-black/10 text-slate-300 hover:border-white/20 hover:text-white'
                  }`}
                  onClick={() => setPreferredTransport(value)}
                >
                  <p className="text-sm font-semibold">{label}</p>
                  <p className="mt-1 text-sm text-slate-400">{description}</p>
                </button>
              ))}
            </div>
            {preferredTransport === 'bluetooth' ? (
              <div className="mt-4 flex items-center justify-between gap-4 rounded-2xl border border-white/10 bg-black/10 px-4 py-3">
                <div>
                  <p className="text-sm font-semibold text-white">Connect Bluetooth Node</p>
                  <p className="mt-1 text-sm text-slate-400">Pairing in the operating system is not enough. Click here to let the app request and open the MeshCore BLE device.</p>
                </div>
                <button
                  className="mesh-button-primary"
                  type="button"
                  disabled={connectingBluetooth || (connected && transport === 'bluetooth')}
                  onClick={() => void handleConnectBluetooth()}
                >
                  {connectingBluetooth ? 'Connecting' : connected && transport === 'bluetooth' ? 'Connected' : 'Connect Bluetooth'}
                </button>
              </div>
            ) : null}
          </div>
          <SettingToggle
            title="Auto-connect USB nodes"
            description="Connect automatically when the app detects a serial radio."
            checked={autoConnectUsb}
            onChange={setAutoConnectUsb}
          />
          <SettingToggle
            title="Probe all candidate serial ports"
            description="Try each detected serial device until a real MeshCore node responds."
            checked={probeAllSerialPorts}
            onChange={setProbeAllSerialPorts}
          />
          {draft ? (
            <>
              <div className="rounded-3xl border border-white/10 bg-white/5 px-5 py-4">
                <p className="text-sm font-semibold text-white">Device identity</p>
                <div className="mt-4 grid gap-4 md:grid-cols-2">
                  <label className="space-y-2 text-sm text-slate-300">
                    <span>Name</span>
                    <input
                      className="mesh-input"
                      value={draft.name}
                      disabled={!connected || saving}
                      onChange={(event) => setDraft((current) => current ? { ...current, name: event.target.value } : current)}
                    />
                  </label>
                  <label className="space-y-2 text-sm text-slate-300">
                    <span>TX Power</span>
                    <input
                      className="mesh-input"
                      type="number"
                      value={draft.txPower}
                      disabled={!connected || saving}
                      onChange={(event) => setDraft((current) => current ? { ...current, txPower: Number(event.target.value) } : current)}
                    />
                  </label>
                  <label className="space-y-2 text-sm text-slate-300">
                    <span>Advert Latitude</span>
                    <input
                      className="mesh-input"
                      type="number"
                      value={draft.advLat}
                      disabled={!connected || saving}
                      onChange={(event) => setDraft((current) => current ? { ...current, advLat: Number(event.target.value) } : current)}
                    />
                  </label>
                  <label className="space-y-2 text-sm text-slate-300">
                    <span>Advert Longitude</span>
                    <input
                      className="mesh-input"
                      type="number"
                      value={draft.advLon}
                      disabled={!connected || saving}
                      onChange={(event) => setDraft((current) => current ? { ...current, advLon: Number(event.target.value) } : current)}
                    />
                  </label>
                </div>
              </div>
              <div className="rounded-3xl border border-white/10 bg-white/5 px-5 py-4">
                <p className="text-sm font-semibold text-white">Radio parameters</p>
                <div className="mt-4 grid gap-4 md:grid-cols-2">
                  <label className="space-y-2 text-sm text-slate-300">
                    <span>Frequency</span>
                    <input
                      className="mesh-input"
                      type="number"
                      value={draft.radioFreq}
                      disabled={!connected || saving}
                      onChange={(event) => setDraft((current) => current ? { ...current, radioFreq: Number(event.target.value) } : current)}
                    />
                  </label>
                  <label className="space-y-2 text-sm text-slate-300">
                    <span>Bandwidth</span>
                    <input
                      className="mesh-input"
                      type="number"
                      value={draft.radioBw}
                      disabled={!connected || saving}
                      onChange={(event) => setDraft((current) => current ? { ...current, radioBw: Number(event.target.value) } : current)}
                    />
                  </label>
                  <label className="space-y-2 text-sm text-slate-300">
                    <span>Spreading Factor</span>
                    <input
                      className="mesh-input"
                      type="number"
                      value={draft.radioSf}
                      disabled={!connected || saving}
                      onChange={(event) => setDraft((current) => current ? { ...current, radioSf: Number(event.target.value) } : current)}
                    />
                  </label>
                  <label className="space-y-2 text-sm text-slate-300">
                    <span>Coding Rate</span>
                    <input
                      className="mesh-input"
                      type="number"
                      value={draft.radioCr}
                      disabled={!connected || saving}
                      onChange={(event) => setDraft((current) => current ? { ...current, radioCr: Number(event.target.value) } : current)}
                    />
                  </label>
                </div>
                <label className="mt-4 flex items-start justify-between gap-4 rounded-2xl border border-white/10 bg-black/10 px-4 py-3">
                  <div>
                    <p className="text-sm font-semibold text-white">Manual Add Contacts</p>
                    <p className="mt-1 text-sm text-slate-400">Toggle whether contacts need to be manually added on the device.</p>
                  </div>
                  <input
                    className="mt-1 h-5 w-5 shrink-0 accent-cyan-300"
                    type="checkbox"
                    checked={draft.manualAddContacts}
                    disabled={!connected || saving}
                    onChange={(event) => setDraft((current) => current ? { ...current, manualAddContacts: event.target.checked } : current)}
                  />
                </label>
              </div>
              <div className="flex items-center justify-end gap-3">
                {saveStatus === 'success' ? (
                  <p className="text-sm text-emerald-400">Settings saved.</p>
                ) : saveStatus === 'error' ? (
                  <p className="text-sm text-rose-400">Save failed. Check connection.</p>
                ) : null}
                <button className="mesh-button-primary" type="submit" disabled={!connected || saving}>
                  {saving ? 'Saving' : 'Save Radio Settings'}
                </button>
              </div>
            </>
          ) : (
            <div className="rounded-3xl border border-dashed border-white/15 bg-black/10 px-5 py-8 text-sm text-slate-400">
              Connect to a companion radio to view and edit MeshCore device settings.
            </div>
          )}
          {connected ? (
            <div className="rounded-3xl border border-white/10 bg-white/5 px-5 py-4">
              <p className="text-sm font-semibold text-white">Node actions</p>
              <p className="mt-1 text-sm text-slate-400">Send an advert so nearby nodes know you are present, or reboot the radio.</p>
              <div className="mt-4 flex flex-wrap gap-3">
                <button
                  type="button"
                  className="mesh-button-secondary"
                  disabled={advertStatus.sending}
                  onClick={() => void handleSendAdvert('flood')}
                >
                  {advertStatus.sending && advertStatus.type === 'flood' ? 'Sending…' : 'Flood Advert'}
                </button>
                <button
                  type="button"
                  className="mesh-button-secondary"
                  disabled={advertStatus.sending}
                  onClick={() => void handleSendAdvert('zero-hop')}
                >
                  {advertStatus.sending && advertStatus.type === 'zero-hop' ? 'Sending…' : 'Zero-Hop Advert'}
                </button>
                <button
                  type="button"
                  className={`mesh-button-secondary ${rebootConfirm ? 'border-rose-400/50 text-rose-300 hover:border-rose-400/70' : ''}`}
                  disabled={rebooting}
                  onClick={() => void handleReboot()}
                >
                  {rebooting ? 'Rebooting…' : rebootConfirm ? 'Confirm reboot?' : 'Reboot Node'}
                </button>
              </div>
            </div>
          ) : null}
        </div>
      </form>
      <aside className="mesh-panel overflow-y-auto px-5 py-5">
        <p className="mb-4 text-sm font-semibold text-white/60">Current State</p>
        <div className="mt-4 space-y-4 text-sm">
          <div>
            <p className="text-slate-400">Node</p>
            <p className="mt-1 font-semibold text-white">{nodeName ?? 'No node connected'}</p>
          </div>
          <div>
            <p className="text-slate-400">Status</p>
            <p className="mt-1 font-semibold text-white">{status}</p>
          </div>
          <div>
            <p className="text-slate-400">Active transport</p>
            <p className="mt-1 font-semibold text-white">{transport ? (transport === 'usb' ? 'USB' : 'Bluetooth') : 'Not connected'}</p>
          </div>
          <div>
            <p className="text-slate-400">Preferred transport</p>
            <p className="mt-1 font-semibold text-white">{preferredTransport === 'usb' ? 'USB' : 'Bluetooth'}</p>
          </div>
          <div>
            <p className="text-slate-400">Serial path</p>
            <p className="mt-1 break-all font-semibold text-white">{transport === 'usb' ? (portPath ?? 'Not connected') : 'N/A'}</p>
          </div>
          <div>
            <p className="text-slate-400">Battery</p>
            <p className="mt-1 font-semibold text-white">{formatBattery(batteryMillivolts)}</p>
          </div>
          <div>
            <p className="text-slate-400">Last sync</p>
            <p className="mt-1 font-semibold text-white">{formatRelative(diagnostics.lastSyncAt)}</p>
          </div>
          <div>
            <p className="text-slate-400">Sync source</p>
            <p className="mt-1 font-semibold capitalize text-white">{diagnostics.lastSyncSource ?? '—'}</p>
          </div>
          <div>
            <p className="text-slate-400">Last queue pull</p>
            <p className="mt-1 font-semibold text-white">{diagnostics.lastSyncedMessageCount}</p>
          </div>
          <div>
            <p className="text-slate-400">Archived messages available</p>
            <p className="mt-1 font-semibold text-white">{diagnostics.archivedMessagesAvailable}</p>
          </div>
          <div>
            <p className="text-slate-400">Detected serial ports</p>
            <p className="mt-1 font-semibold text-white">{diagnostics.detectedPortCount}</p>
          </div>
          <div>
            <p className="text-slate-400">Last port refresh</p>
            <p className="mt-1 font-semibold text-white">{formatRelative(diagnostics.lastPortRefreshAt)}</p>
          </div>
          <div>
            <p className="text-slate-400">Last probe</p>
            <p className="mt-1 font-semibold text-white">
              {diagnostics.lastProbePortPath
                ? `${diagnostics.lastProbeOutcome ?? 'unknown'} on ${diagnostics.lastProbePortPath}`
                : '—'}
            </p>
            {diagnostics.lastProbeError ? (
              <p className="mt-1 text-xs text-amber-200">{diagnostics.lastProbeError}</p>
            ) : null}
          </div>
          {deviceSettings ? (
            <>
              <div>
                <p className="text-slate-400">Public key</p>
                <p className="mt-1 break-all font-semibold text-white">{toHex(deviceSettings.publicKey)}</p>
              </div>
              <div>
                <p className="text-slate-400">Radio type</p>
                <p className="mt-1 font-semibold text-white">{deviceSettings.type}</p>
              </div>
              <div>
                <p className="text-slate-400">Max TX power</p>
                <p className="mt-1 font-semibold text-white">{deviceSettings.maxTxPower}</p>
              </div>
            </>
          ) : null}
          {deviceInfo ? (
            <>
              <div>
                <p className="text-slate-400">Firmware</p>
                <p className="mt-1 font-semibold text-white">{deviceInfo.firmwareVersion || '—'}</p>
              </div>
              {deviceInfo.firmwareBuildDate ? (
                <div>
                  <p className="text-slate-400">Build date</p>
                  <p className="mt-1 font-semibold text-white">{deviceInfo.firmwareBuildDate}</p>
                </div>
              ) : null}
              {deviceInfo.manufacturerModel ? (
                <div>
                  <p className="text-slate-400">Model</p>
                  <p className="mt-1 font-semibold text-white">{deviceInfo.manufacturerModel}</p>
                </div>
              ) : null}
            </>
          ) : null}
          {lastError ? (
            <div>
              <p className="text-slate-400">Last error</p>
              <p className="mt-1 text-rose-200">{lastError}</p>
            </div>
          ) : null}
          <div className="border-t border-white/10 pt-4">
            <p className="text-slate-400">Version</p>
            <p className="mt-1 font-semibold text-white">
              {APP_VERSION}
            </p>
          </div>
        </div>
      </aside>
    </div>
  );
}
