import { useState } from 'react';
import { Activity, Hash, Map, MessageSquare, Settings2 } from 'lucide-react';
import { APP_VERSION } from '@shared/app-meta';
import { useMeshcoreEvents } from '@renderer/hooks/useMeshcoreEvents';
import { useChannelsStore } from '@renderer/store/channels.store';
import { useConnectionStore } from '@renderer/store/connection.store';
import { useContactsStore } from '@renderer/store/contacts.store';
import { useMapArchiveStore } from '@renderer/store/map-archive.store';
import { useMessagesStore } from '@renderer/store/messages.store';
import { useSettingsStore } from '@renderer/store/settings.store';
import { MapView } from '@renderer/views/MapView';
import { MessagesView } from '@renderer/views/MessagesView';
import { SettingsView } from '@renderer/views/SettingsView';
import { LiveFeedView } from '@renderer/views/LiveFeedView';

type ViewName = 'dms' | 'channels' | 'live' | 'map' | 'settings';

const NAV_ITEMS = [
  { key: 'dms' as const, label: 'Messages', icon: MessageSquare },
  { key: 'channels' as const, label: 'Channels', icon: Hash },
  { key: 'live' as const, label: 'Live', icon: Activity },
  { key: 'map' as const, label: 'Map', icon: Map },
  { key: 'settings' as const, label: 'Settings', icon: Settings2 },
];

export default function App() {
  const [view, setView] = useState<ViewName>('dms');
  const { sendDirectMessage, sendChannelMessage, updateDeviceSettings, createHashtagChannel, connectBluetooth, getDeviceInfo, reboot, sendAdvert } =
    useMeshcoreEvents();

  const { status, nodeName, transport, portPath, deviceSettings, batteryMillivolts, error } = useConnectionStore();
  const preferredTransport = useSettingsStore((state) => state.preferredTransport);
  const contacts = Object.values(useContactsStore((state) => state.contacts));
  const archivedMapContacts = Object.values(useMapArchiveStore((state) => state.archivedContacts));
  const channels = useChannelsStore((state) => state.channels);
  const conversations = useMessagesStore((state) => state.conversations);
  const unreadCounts = useMessagesStore((state) => state.unreadCounts);
  const connected = status === 'connected' || status === 'syncing';

  const dmUnread = Object.entries(unreadCounts)
    .filter(([key]) => key.startsWith('dm:'))
    .reduce((sum, [, n]) => sum + n, 0);
  const channelUnread = Object.entries(unreadCounts)
    .filter(([key]) => key.startsWith('channel:'))
    .reduce((sum, [, n]) => sum + n, 0);

  function badgeFor(key: ViewName): number {
    if (key === 'dms') return dmUnread;
    if (key === 'channels') return channelUnread;
    return 0;
  }

  return (
    <div className="flex h-screen flex-col overflow-hidden">
      {/* ── Title bar ────────────────────────────────────── */}
      <header
        className="flex h-11 shrink-0 items-center justify-between border-b border-white/[0.06] px-4"
        style={{ WebkitAppRegion: 'drag' } as React.CSSProperties}
      >
        <div
          className="flex items-center gap-2.5"
          style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}
        >
          <span className="text-sm font-semibold tracking-tight text-white/90">MeshCore</span>
          <span className="mesh-pill">{APP_VERSION}</span>
          <span className="mesh-pill">{preferredTransport === 'usb' ? 'USB' : 'BLE'}</span>
        </div>

        <div
          className="flex items-center gap-2.5 text-sm"
          style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}
        >
          <span
            className={`h-1.5 w-1.5 rounded-full transition-colors ${
              connected
                ? 'bg-emerald-400 shadow-[0_0_5px_rgba(52,211,153,0.8)]'
                : status === 'error'
                  ? 'bg-rose-400'
                  : 'bg-white/20'
            }`}
          />
          <span className="font-medium text-white/75">{nodeName ?? 'No device'}</span>
          {batteryMillivolts ? (
            <span className="text-white/35">{(batteryMillivolts / 1000).toFixed(2)} V</span>
          ) : null}
        </div>
      </header>

      {/* ── Body ─────────────────────────────────────────── */}
      <div className="flex min-h-0 flex-1">
        {/* ── Sidebar nav ───────────────────────────────── */}
        <aside className="flex w-48 shrink-0 flex-col border-r border-white/[0.06] px-2.5 py-3">
          <nav className="flex flex-col gap-0.5">
            {NAV_ITEMS.map(({ key, label, icon: Icon }) => {
              const isActive = view === key;
              const badge = badgeFor(key);

              return (
                <button
                  key={key}
                  type="button"
                  onClick={() => setView(key)}
                  className={`flex items-center gap-2.5 rounded-xl px-3 py-2.5 text-sm font-medium transition-all ${
                    isActive
                      ? 'bg-sky-400/15 text-sky-300'
                      : 'text-slate-400 hover:bg-white/[0.06] hover:text-slate-200'
                  }`}
                >
                  <Icon size={15} className="shrink-0" />
                  <span className="flex-1 text-left">{label}</span>
                  {badge > 0 && !isActive ? (
                    <span className="flex h-[18px] min-w-[18px] items-center justify-center rounded-full bg-sky-400 px-1 text-[10px] font-bold text-slate-900">
                      {badge > 99 ? '99+' : badge}
                    </span>
                  ) : null}
                </button>
              );
            })}
          </nav>
        </aside>

        {/* ── Content ───────────────────────────────────── */}
        <main className="min-h-0 flex-1 overflow-hidden p-4">
          {view === 'dms' ? (
            <MessagesView
              mode="dm"
              contacts={contacts}
              channels={channels}
              conversations={conversations}
              connected={connected}
              onSendDirectMessage={(publicKey, body) => sendDirectMessage({ publicKey, body })}
              onSendChannelMessage={(channelIndex, body) => sendChannelMessage({ channelIndex, body })}
            />
          ) : null}
          {view === 'channels' ? (
            <MessagesView
              mode="channel"
              contacts={contacts}
              channels={channels}
              conversations={conversations}
              connected={connected}
              onCreateHashtagChannel={createHashtagChannel}
              onSendDirectMessage={(publicKey, body) => sendDirectMessage({ publicKey, body })}
              onSendChannelMessage={(channelIndex, body) => sendChannelMessage({ channelIndex, body })}
            />
          ) : null}
          {view === 'live' ? <LiveFeedView /> : null}
          {view === 'map' ? <MapView contacts={contacts} archivedContacts={archivedMapContacts} /> : null}
          {view === 'settings' ? (
            <SettingsView
              nodeName={nodeName}
              status={status}
              transport={transport}
              portPath={portPath}
              deviceSettings={deviceSettings}
              batteryMillivolts={batteryMillivolts}
              lastError={error}
              connected={connected}
              onSave={updateDeviceSettings}
              onConnectBluetooth={connectBluetooth}
              onGetDeviceInfo={getDeviceInfo}
              onReboot={reboot}
              onSendAdvert={sendAdvert}
            />
          ) : null}
        </main>
      </div>
    </div>
  );
}
