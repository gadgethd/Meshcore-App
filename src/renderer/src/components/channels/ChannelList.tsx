import type { MeshcoreChannel } from '@shared/meshcore';

interface ChannelListProps {
  channels: MeshcoreChannel[];
}

export function ChannelList({ channels }: ChannelListProps) {
  return (
    <section className="mesh-panel px-5 py-5">
      <p className="text-xs uppercase tracking-[0.3em] text-cyan-200/70">Channels</p>
      <h2 className="mt-2 text-2xl font-semibold text-white">Groups</h2>
      <div className="mt-5 space-y-3">
        {channels.map((channel) => (
          <article key={channel.index} className="rounded-3xl border border-white/10 bg-white/5 px-4 py-4">
            <div className="flex items-center justify-between gap-4">
              <div>
                <h3 className="text-lg font-medium text-white">#{channel.name}</h3>
                <p className="mt-1 text-sm text-slate-400">Channel index {channel.index}</p>
              </div>
              <span className="mesh-pill">{channel.memberCount} nodes</span>
            </div>
          </article>
        ))}
        {channels.length === 0 ? <p className="text-sm text-slate-400">No channels loaded yet.</p> : null}
      </div>
    </section>
  );
}
