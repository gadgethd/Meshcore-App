import { useEffect, useState } from 'react';
import type { ConnectionStatus, SerialPortInfo } from '@shared/meshcore';

interface ConnectionPanelProps {
  ports: SerialPortInfo[];
  status: ConnectionStatus;
  selectedPort: string | null;
  batteryMillivolts: number | null;
  error: string | null;
  onSelectPort: (portPath: string) => void;
  onRefresh: () => Promise<void>;
  onConnect: (portPath: string) => Promise<void>;
  onDisconnect: () => Promise<void>;
}

function statusLabel(status: ConnectionStatus): string {
  switch (status) {
    case 'connected':
      return 'Connected';
    case 'connecting':
      return 'Connecting';
    case 'syncing':
      return 'Syncing';
    case 'error':
      return 'Error';
    default:
      return 'Disconnected';
  }
}

function platformExamples(): string[] {
  if (navigator.userAgent.includes('Windows')) {
    return ['COM3', 'COM4'];
  }

  if (navigator.userAgent.includes('Mac')) {
    return ['/dev/cu.usbmodem14401', '/dev/cu.usbserial-0001'];
  }

  return ['/dev/ttyUSB0', '/dev/ttyACM0'];
}

export function ConnectionPanel({
  ports,
  status,
  selectedPort,
  batteryMillivolts,
  error,
  onSelectPort,
  onRefresh,
  onConnect,
  onDisconnect
}: ConnectionPanelProps) {
  const [draftPort, setDraftPort] = useState(selectedPort ?? '');
  const busy = status === 'connecting' || status === 'syncing';
  const examples = platformExamples();

  useEffect(() => {
    if (selectedPort) {
      setDraftPort(selectedPort);
    } else if (!draftPort && ports[0]) {
      setDraftPort(ports[0].path);
    }
  }, [selectedPort, draftPort, ports]);

  return (
    <section className="mesh-panel space-y-4 px-5 py-5">
      <div className="flex items-start justify-between gap-4">
        <div>
          <p className="text-xs uppercase tracking-[0.3em] text-cyan-200/70">Radio Link</p>
          <h2 className="mt-2 text-2xl font-semibold text-white">Serial Transport</h2>
        </div>
        <span className={`mesh-pill ${status === 'connected' ? 'bg-emerald-400/20 text-emerald-100' : 'bg-white/10'}`}>
          {statusLabel(status)}
        </span>
      </div>

      <label className="space-y-2 text-sm text-slate-300">
        <span>Detected ports</span>
        <select
          className="mesh-input"
          value={draftPort}
          onChange={(event) => {
            setDraftPort(event.target.value);
            onSelectPort(event.target.value);
          }}
        >
          {ports.length === 0 ? <option value="">No ports detected</option> : null}
          {ports.map((port) => (
            <option key={port.path} value={port.path}>
              {port.friendlyName}
            </option>
          ))}
        </select>
      </label>

      <label className="space-y-2 text-sm text-slate-300">
        <span>Manual device path</span>
        <input
          className="mesh-input"
          type="text"
          spellCheck={false}
          value={draftPort}
          placeholder={examples[0]}
          onChange={(event) => {
            const nextPort = event.target.value;
            setDraftPort(nextPort);
            onSelectPort(nextPort);
          }}
        />
      </label>

      <div className="rounded-2xl border border-white/10 bg-black/10 px-3 py-3 text-sm text-slate-300">
        <p className="font-medium text-white">Radio connection</p>
        <p className="mt-2">
          Connect to a MeshCore companion radio over USB serial. If auto-detection misses the device, enter the path
          manually.
        </p>
        <p className="mt-2 text-slate-400">Examples: {examples.join(', ')}</p>
        <p className="mt-2 text-slate-400">
          Linux note: if you see a permission error, add your user to the <code>dialout</code> group and sign back in.
        </p>
      </div>

      <div className="grid grid-cols-2 gap-3">
        <button className="mesh-button-secondary" type="button" onClick={() => void onRefresh()}>
          Refresh
        </button>
        {status === 'connected' ? (
          <button className="mesh-button-danger" type="button" onClick={() => void onDisconnect()}>
            Disconnect
          </button>
        ) : (
          <button
            className="mesh-button-primary"
            type="button"
            disabled={!draftPort.trim() || busy}
            onClick={() => void onConnect(draftPort)}
          >
            {busy ? 'Working…' : 'Connect'}
          </button>
        )}
      </div>

      <dl className="grid grid-cols-2 gap-3 text-sm">
        <div className="rounded-2xl border border-white/10 bg-black/10 p-3">
          <dt className="text-slate-400">Battery</dt>
          <dd className="mt-1 text-lg font-semibold text-white">
            {batteryMillivolts ? `${(batteryMillivolts / 1000).toFixed(2)}V` : 'n/a'}
          </dd>
        </div>
        <div className="rounded-2xl border border-white/10 bg-black/10 p-3">
          <dt className="text-slate-400">Detected</dt>
          <dd className="mt-1 text-lg font-semibold text-white">{ports.length}</dd>
        </div>
      </dl>

      {error ? <p className="rounded-2xl border border-rose-400/30 bg-rose-400/10 px-3 py-2 text-sm text-rose-100">{error}</p> : null}
    </section>
  );
}
