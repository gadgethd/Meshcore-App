import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { format } from 'date-fns';
import { toHex } from '@shared/meshcore';
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

function messageDirectionLabel(message: MeshcoreMessage): string {
  if (message.direction === 'incoming') return 'Inbound';
  if (message.direction === 'outgoing') return 'Outbound';
  return 'System';
}

export function MessageThread({ threadKey, title, subtitle, messages }: MessageThreadProps) {
  const bottomRef = useRef<HTMLDivElement>(null);
  const previousThreadKeyRef = useRef<string | null>(null);
  const shouldAnimateNextMessageRef = useRef(false);
  const [selectedMessage, setSelectedMessage] = useState<MeshcoreMessage | null>(null);

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

  useEffect(() => {
    setSelectedMessage(null);
  }, [threadKey]);

  useEffect(() => {
    if (!selectedMessage) {
      return;
    }

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setSelectedMessage(null);
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => {
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, [selectedMessage]);

  return (
    <>
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
                    <button
                      key={message.id}
                      type="button"
                      className="my-3 flex items-center gap-3 px-2 text-left"
                      onClick={() => setSelectedMessage(message)}
                    >
                      <div className="h-px flex-1 bg-white/[0.06]" />
                      <p className="shrink-0 text-[11px] text-white/25">{message.body}</p>
                      <div className="h-px flex-1 bg-white/[0.06]" />
                    </button>
                  );
                }

                const isOutgoing = message.direction === 'outgoing';

                return (
                  <article key={message.id} className={`flex flex-col ${isOutgoing ? 'items-end' : 'items-start'}`}>
                    {/* Author label — only for incoming channel messages */}
                    {!isOutgoing && shouldShowAuthor(message) ? (
                      <p className="mb-1 ml-1 text-[11px] font-medium text-white/45">{message.authorLabel}</p>
                    ) : null}

                    <div
                      role="button"
                      tabIndex={0}
                      className={`max-w-[72%] cursor-pointer rounded-2xl px-3.5 py-2.5 transition hover:ring-1 hover:ring-cyan-300/30 ${
                        isOutgoing
                          ? 'rounded-br-[6px] bg-sky-500/18 ring-1 ring-sky-400/25'
                          : 'rounded-bl-[6px] bg-white/[0.07] ring-1 ring-white/[0.07]'
                      }`}
                      onClick={() => setSelectedMessage(message)}
                      onKeyDown={(event) => {
                        if (event.key === 'Enter' || event.key === ' ') {
                          event.preventDefault();
                          setSelectedMessage(message);
                        }
                      }}
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

      {selectedMessage ? (
        <div
          className="absolute inset-0 z-40 flex items-center justify-center bg-slate-950/55 p-5 backdrop-blur-sm"
          onClick={() => setSelectedMessage(null)}
        >
          <div
            className="mesh-panel w-full max-w-xl overflow-hidden"
            onClick={(event) => event.stopPropagation()}
          >
            <div className="flex items-start justify-between gap-4 border-b border-white/[0.07] px-5 py-4">
              <div>
                <h3 className="text-base font-semibold text-white">Packet details</h3>
                <p className="mt-1 text-sm text-white/35">Fields currently available from the app&apos;s MeshCore message model.</p>
              </div>
              <button
                type="button"
                className="rounded-full border border-white/10 px-3 py-1 text-xs font-medium text-white/60 transition hover:border-white/20 hover:text-white"
                onClick={() => setSelectedMessage(null)}
              >
                Close
              </button>
            </div>
            <div className="space-y-4 px-5 py-5">
              <div>
                <p className="text-xs font-medium uppercase tracking-widest text-white/30">Body</p>
                <p className="mt-2 whitespace-pre-wrap rounded-2xl border border-white/10 bg-black/10 px-3 py-3 text-sm leading-relaxed text-slate-100">
                  {selectedMessage.body}
                </p>
              </div>
              <div className="grid gap-4 md:grid-cols-2">
                <div>
                  <p className="text-xs font-medium uppercase tracking-widest text-white/30">Direction</p>
                  <p className="mt-1 text-sm font-semibold text-white">{messageDirectionLabel(selectedMessage)}</p>
                </div>
                <div>
                  <p className="text-xs font-medium uppercase tracking-widest text-white/30">Author</p>
                  <p className="mt-1 text-sm font-semibold text-white">{selectedMessage.authorLabel || '—'}</p>
                </div>
                <div>
                  <p className="text-xs font-medium uppercase tracking-widest text-white/30">Sent</p>
                  <p className="mt-1 text-sm font-semibold text-white">{format(new Date(selectedMessage.sentAt), 'yyyy-MM-dd HH:mm:ss')}</p>
                  <p className="mt-1 text-xs text-white/35">{selectedMessage.sentAt}</p>
                </div>
                <div>
                  <p className="text-xs font-medium uppercase tracking-widest text-white/30">Conversation</p>
                  <p className="mt-1 break-all font-mono text-sm text-white/75">{selectedMessage.conversationKey}</p>
                </div>
                <div>
                  <p className="text-xs font-medium uppercase tracking-widest text-white/30">Hop count</p>
                  <p className="mt-1 text-sm font-semibold text-white">
                    {typeof selectedMessage.hopCount === 'number' ? selectedMessage.hopCount : '—'}
                  </p>
                </div>
                <div>
                  <p className="text-xs font-medium uppercase tracking-widest text-white/30">Channel</p>
                  <p className="mt-1 text-sm font-semibold text-white">
                    {typeof selectedMessage.channelIndex === 'number' ? `#${selectedMessage.channelIndex}` : 'Direct message'}
                  </p>
                </div>
                <div>
                  <p className="text-xs font-medium uppercase tracking-widest text-white/30">Public key</p>
                  <p className="mt-1 break-all font-mono text-sm text-white/75">
                    {selectedMessage.publicKey ? toHex(selectedMessage.publicKey) : '—'}
                  </p>
                </div>
                <div>
                  <p className="text-xs font-medium uppercase tracking-widest text-white/30">Acknowledgement</p>
                  <p className="mt-1 text-sm font-semibold text-white">
                    {selectedMessage.direction === 'outgoing'
                      ? selectedMessage.acknowledged
                        ? 'Confirmed'
                        : 'Pending'
                      : 'N/A'}
                  </p>
                  {typeof selectedMessage.expectedAckCrc === 'number' ? (
                    <p className="mt-1 font-mono text-xs text-white/35">CRC {selectedMessage.expectedAckCrc}</p>
                  ) : null}
                </div>
              </div>
            </div>
          </div>
        </div>
      ) : null}
    </>
  );
}
