import { useEffect, useLayoutEffect, useRef } from 'react';
import { format } from 'date-fns';
import type { MeshcoreMessage } from '@shared/meshcore';

interface MessageThreadProps {
  threadKey: string;
  title: string;
  subtitle: string;
  messages: MeshcoreMessage[];
}

function shouldShowAuthor(message: MeshcoreMessage): boolean {
  return !(typeof message.channelIndex === 'number' && /^Channel \d+$/.test(message.authorLabel));
}

export function MessageThread({ threadKey, title, subtitle, messages }: MessageThreadProps) {
  const bottomRef = useRef<HTMLDivElement>(null);
  const previousThreadKeyRef = useRef<string | null>(null);
  const shouldAnimateNextMessageRef = useRef(false);

  // Jump to newest immediately whenever the user opens a different thread.
  useLayoutEffect(() => {
    if (previousThreadKeyRef.current === threadKey) {
      return;
    }

    previousThreadKeyRef.current = threadKey;
    shouldAnimateNextMessageRef.current = false;
    bottomRef.current?.scrollIntoView({ behavior: 'instant' });
  }, [threadKey]);

  // Smooth-scroll only when a new message arrives in the currently open thread.
  useEffect(() => {
    if (!shouldAnimateNextMessageRef.current) {
      shouldAnimateNextMessageRef.current = true;
      return;
    }

    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages.length, threadKey]);

  return (
    <div className="mesh-panel flex h-full min-h-[480px] flex-col overflow-hidden">
      {/* Header */}
      <div className="shrink-0 border-b border-white/[0.07] px-5 py-4">
        <h2 className="text-base font-semibold text-white">{title}</h2>
        {subtitle ? <p className="mt-0.5 text-sm text-white/35">{subtitle}</p> : null}
      </div>

      {/* Message list */}
      <div className="flex-1 overflow-y-auto px-4 py-4">
        {messages.length === 0 ? (
          <div className="flex h-full items-center justify-center">
            <p className="text-sm text-white/20">No messages yet.</p>
          </div>
        ) : (
          <div className="flex flex-col gap-1.5">
            {messages.map((message) => {
              /* ── System message ── */
              if (message.direction === 'system') {
                return (
                  <div key={message.id} className="my-3 flex items-center gap-3 px-2">
                    <div className="h-px flex-1 bg-white/[0.06]" />
                    <p className="shrink-0 text-[11px] text-white/25">{message.body}</p>
                    <div className="h-px flex-1 bg-white/[0.06]" />
                  </div>
                );
              }

              const isOutgoing = message.direction === 'outgoing';

              return (
                <article key={message.id} className={`flex flex-col ${isOutgoing ? 'items-end' : 'items-start'}`}>
                  {/* Author label — only for incoming channel messages */}
                  {!isOutgoing && shouldShowAuthor(message) ? (
                    <p className="mb-1 ml-1 text-[11px] font-medium text-white/45">{message.authorLabel}</p>
                  ) : null}

                  {/* Bubble */}
                  <div
                    className={`max-w-[72%] rounded-2xl px-3.5 py-2.5 ${
                      isOutgoing
                        ? 'rounded-br-[6px] bg-sky-500/18 ring-1 ring-sky-400/25'
                        : 'rounded-bl-[6px] bg-white/[0.07] ring-1 ring-white/[0.07]'
                    }`}
                  >
                    <p className="whitespace-pre-wrap text-sm leading-relaxed text-slate-100">{message.body}</p>
                    <div
                      className={`mt-1 flex items-center gap-1.5 ${isOutgoing ? 'justify-end' : 'justify-start'}`}
                    >
                      {typeof message.hopCount === 'number' ? (
                        <span className="text-[10px] text-white/25">{message.hopCount} {message.hopCount === 1 ? 'hop' : 'hops'}</span>
                      ) : null}
                      <time className="text-[10px] text-white/25" dateTime={message.sentAt}>
                        {format(new Date(message.sentAt), 'HH:mm')}
                      </time>
                      {isOutgoing && message.acknowledged ? (
                        <span className="text-[10px] text-emerald-400" title="Heard by repeater">✓</span>
                      ) : null}
                    </div>
                  </div>
                </article>
              );
            })}
            <div ref={bottomRef} />
          </div>
        )}
      </div>
    </div>
  );
}
