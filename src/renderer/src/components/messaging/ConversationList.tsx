import type { ReactNode } from 'react';
import type { ConversationKey } from '@shared/meshcore';

export interface ConversationListItem {
  key: ConversationKey;
  title: string;
  subtitle: string;
  badge?: string;
  moveUpDisabled?: boolean;
  moveDownDisabled?: boolean;
  onMoveUp?: () => void;
  onMoveDown?: () => void;
}

export interface ConversationSection {
  title: string;
  items: ConversationListItem[];
}

interface ConversationListProps {
  sections: ConversationSection[];
  activeKey: ConversationKey | null;
  onSelect: (key: ConversationKey) => void;
  headerSlot?: ReactNode;
}

function hashHue(str: string): number {
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    hash = str.charCodeAt(i) + ((hash << 5) - hash);
  }
  return Math.abs(hash) % 360;
}

export function ConversationList({ sections, activeKey, onSelect, headerSlot }: ConversationListProps) {
  return (
    <div className="mesh-panel flex h-full flex-col overflow-hidden">
      {headerSlot ? (
        <div className="shrink-0 border-b border-white/[0.07] px-4 py-4">
          {headerSlot}
        </div>
      ) : null}

      <div className="flex-1 overflow-y-auto p-2">
        {sections.map((section) => (
          <section key={section.title} className="mb-3">
            <p className="mb-1.5 px-2 text-[10px] font-semibold uppercase tracking-widest text-white/25">
              {section.title}
            </p>

            <div className="space-y-0.5">
              {section.items.map((item) => {
                const isActive = item.key === activeKey;
                const hue = hashHue(item.key);
                const initials = item.title.replace(/^#/, '').charAt(0).toUpperCase();
                const hasReorder = !!(item.onMoveUp || item.onMoveDown);

                return (
                  <div key={item.key} className="flex items-center gap-1">
                    <button
                      type="button"
                      onClick={() => onSelect(item.key)}
                      className={`flex min-w-0 flex-1 items-center gap-2.5 rounded-xl px-2.5 py-2 text-left transition-all ${
                        isActive
                          ? 'bg-sky-400/12 text-white'
                          : 'text-slate-400 hover:bg-white/[0.06] hover:text-white'
                      }`}
                    >
                      {/* Avatar */}
                      <span
                        className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-xs font-bold text-white"
                        style={{
                          background: `hsl(${hue}, 55%, 45%)`,
                          opacity: isActive ? 1 : 0.65,
                        }}
                      >
                        {initials}
                      </span>

                      <div className="min-w-0 flex-1">
                        <div className="flex items-center justify-between gap-2">
                          <p className="truncate text-sm font-medium leading-tight">{item.title}</p>
                          {item.badge ? (
                            <span className="flex h-[18px] min-w-[18px] shrink-0 items-center justify-center rounded-full bg-sky-400 px-1 text-[10px] font-bold text-slate-900">
                              {item.badge}
                            </span>
                          ) : null}
                        </div>
                        <p className="mt-0.5 truncate text-[11px] text-white/30">{item.subtitle}</p>
                      </div>
                    </button>

                    {hasReorder ? (
                      <div className="flex shrink-0 flex-col gap-px">
                        <button
                          type="button"
                          className="flex h-5 w-5 items-center justify-center rounded text-[10px] text-white/25 transition hover:bg-white/10 hover:text-white/55 disabled:opacity-20"
                          disabled={item.moveUpDisabled}
                          onClick={item.onMoveUp}
                          aria-label={`Move ${item.title} up`}
                        >
                          ↑
                        </button>
                        <button
                          type="button"
                          className="flex h-5 w-5 items-center justify-center rounded text-[10px] text-white/25 transition hover:bg-white/10 hover:text-white/55 disabled:opacity-20"
                          disabled={item.moveDownDisabled}
                          onClick={item.onMoveDown}
                          aria-label={`Move ${item.title} down`}
                        >
                          ↓
                        </button>
                      </div>
                    ) : null}
                  </div>
                );
              })}
            </div>
          </section>
        ))}
      </div>
    </div>
  );
}
