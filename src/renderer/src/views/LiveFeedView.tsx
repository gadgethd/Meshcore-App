import { useMemo, useState } from 'react';
import { format, formatDistanceToNow } from 'date-fns';
import { useRuntimeStore, type LiveFeedEntryKind } from '@renderer/store/runtime.store';

type FeedFilter = 'all' | LiveFeedEntryKind;

const FILTERS: Array<{ key: FeedFilter; label: string }> = [
  { key: 'all', label: 'All' },
  { key: 'message', label: 'Messages' },
  { key: 'advert', label: 'Adverts' },
  { key: 'sync', label: 'Sync' },
  { key: 'connection', label: 'Connection' },
  { key: 'probe', label: 'Probes' },
  { key: 'ack', label: 'Acks' }
];

function toneClasses(tone: 'neutral' | 'success' | 'warning' | 'error'): string {
  if (tone === 'success') {
    return 'border-emerald-400/20 bg-emerald-400/6';
  }

  if (tone === 'warning') {
    return 'border-amber-400/20 bg-amber-400/6';
  }

  if (tone === 'error') {
    return 'border-rose-400/20 bg-rose-400/6';
  }

  return 'border-white/8 bg-white/[0.04]';
}

function formatRelative(value: string | null): string {
  if (!value) {
    return '—';
  }

  return formatDistanceToNow(new Date(value), { addSuffix: true });
}

export function LiveFeedView() {
  const feed = useRuntimeStore((state) => state.feed);
  const diagnostics = useRuntimeStore((state) => state.diagnostics);
  const [filter, setFilter] = useState<FeedFilter>('all');

  const filteredFeed = useMemo(
    () => (filter === 'all' ? feed : feed.filter((entry) => entry.kind === filter)),
    [feed, filter]
  );

  return (
    <div className="grid h-full gap-4 xl:grid-cols-[minmax(0,1fr)_320px]">
      <section className="mesh-panel flex min-h-0 flex-col overflow-hidden px-5 py-5">
        <div className="border-b border-white/[0.07] pb-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <h2 className="text-base font-semibold text-white">Live Feed</h2>
              <p className="mt-0.5 text-sm text-white/40">Recent packets, adverts, sync activity, and connection events seen by this session.</p>
            </div>
            <span className="mesh-pill">{filteredFeed.length} entries</span>
          </div>
          <div className="mt-4 flex flex-wrap gap-2">
            {FILTERS.map((option) => (
              <button
                key={option.key}
                type="button"
                onClick={() => setFilter(option.key)}
                className={`rounded-full border px-3 py-1.5 text-xs font-medium transition ${
                  filter === option.key
                    ? 'border-cyan-300/40 bg-cyan-300/12 text-cyan-200'
                    : 'border-white/10 bg-white/[0.03] text-slate-300 hover:border-white/20 hover:text-white'
                }`}
              >
                {option.label}
              </button>
            ))}
          </div>
        </div>

        <div className="mt-4 flex-1 space-y-3 overflow-y-auto">
          {filteredFeed.length === 0 ? (
            <div className="flex h-full items-center justify-center rounded-3xl border border-dashed border-white/10 bg-black/10 px-5 py-8 text-sm text-slate-400">
              No live feed entries yet.
            </div>
          ) : (
            filteredFeed.map((entry) => (
              <article key={entry.id} className={`rounded-2xl border px-4 py-3 ${toneClasses(entry.tone)}`}>
                <div className="flex items-start justify-between gap-4">
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <p className="text-sm font-semibold text-white">{entry.title}</p>
                      <span className="mesh-pill">{entry.kind}</span>
                      {entry.transport ? (
                        <span className="mesh-pill">{entry.transport === 'usb' ? 'USB' : 'BLE'}</span>
                      ) : null}
                    </div>
                    <p className="mt-1 whitespace-pre-wrap text-sm text-slate-300">{entry.detail}</p>
                  </div>
                  <div className="shrink-0 text-right">
                    <p className="text-xs text-white/45">{format(new Date(entry.at), 'HH:mm:ss')}</p>
                    <p className="mt-1 text-[11px] text-white/25">{formatDistanceToNow(new Date(entry.at), { addSuffix: true })}</p>
                  </div>
                </div>
              </article>
            ))
          )}
        </div>
      </section>

      <aside className="mesh-panel overflow-y-auto px-5 py-5">
        <p className="mb-4 text-sm font-semibold text-white/60">Session Diagnostics</p>
        <div className="space-y-4 text-sm">
          <div>
            <p className="text-slate-400">Last sync</p>
            <p className="mt-1 font-semibold text-white">{formatRelative(diagnostics.lastSyncAt)}</p>
          </div>
          <div>
            <p className="text-slate-400">Last sync source</p>
            <p className="mt-1 font-semibold capitalize text-white">{diagnostics.lastSyncSource ?? '—'}</p>
          </div>
          <div>
            <p className="text-slate-400">Last queued pull</p>
            <p className="mt-1 font-semibold text-white">{diagnostics.lastSyncedMessageCount}</p>
          </div>
          <div>
            <p className="text-slate-400">Archived messages available</p>
            <p className="mt-1 font-semibold text-white">{diagnostics.archivedMessagesAvailable}</p>
          </div>
          <div>
            <p className="text-slate-400">Contacts / channels</p>
            <p className="mt-1 font-semibold text-white">{diagnostics.contactsLoaded} / {diagnostics.channelsLoaded}</p>
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
          <div>
            <p className="text-slate-400">Connected</p>
            <p className="mt-1 font-semibold text-white">{formatRelative(diagnostics.connectedAt)}</p>
          </div>
          <div>
            <p className="text-slate-400">Last disconnect</p>
            <p className="mt-1 font-semibold text-white">{formatRelative(diagnostics.lastDisconnectedAt)}</p>
          </div>
        </div>
      </aside>
    </div>
  );
}
