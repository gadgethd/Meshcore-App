import { useMemo, useRef, useState } from 'react';
import { ArrowUp } from 'lucide-react';
import { formatMentionDisplay, formatMentionToken, trimMeshcoreMessageToCharLimit } from '@shared/meshcore';

interface MentionCandidate {
  key: string;
  label: string;
  detail?: string;
}

interface MessageComposerProps {
  disabled?: boolean;
  label: string;
  maxChars: number;
  mentionCandidates?: MentionCandidate[];
  suggestedMention?: MentionCandidate | null;
  onSend: (body: string) => Promise<void>;
}

function getMentionQuery(body: string): { start: number; query: string } | null {
  const match = /(^|\s)@([^\s@]*)$/.exec(body);
  if (!match || match.index === undefined) {
    return null;
  }

  const leadingWhitespace = match[1] ?? '';
  const query = match[2] ?? '';
  const start = match.index + leadingWhitespace.length;
  return { start, query };
}

export function MessageComposer({
  disabled,
  maxChars,
  mentionCandidates = [],
  suggestedMention = null,
  onSend
}: MessageComposerProps) {
  const [body, setBody] = useState('');
  const [activeMentionIndex, setActiveMentionIndex] = useState(0);
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);
  const charCount = [...body].length;
  const remaining = maxChars - charCount;
  const canSend = !disabled && !!body.trim() && remaining >= 0;
  const mentionQuery = useMemo(() => getMentionQuery(body), [body]);
  const filteredMentions = useMemo(() => {
    if (!mentionQuery) {
      return [];
    }

    const query = mentionQuery.query.trim().toLowerCase();
    const candidates = mentionCandidates.filter((candidate) =>
      candidate.label.toLowerCase().includes(query)
    );

    return candidates.slice(0, 6);
  }, [mentionCandidates, mentionQuery]);

  function replaceMention(candidate: MentionCandidate): void {
    if (!mentionQuery) {
      return;
    }

    const mentionText = `${formatMentionToken(candidate.label)} `;
    const nextBody = `${body.slice(0, mentionQuery.start)}${mentionText}`;
    setBody(trimMeshcoreMessageToCharLimit(nextBody, maxChars));
    setActiveMentionIndex(0);
    queueMicrotask(() => {
      textareaRef.current?.focus();
      const end = nextBody.length;
      textareaRef.current?.setSelectionRange(end, end);
    });
  }

  async function doSend(): Promise<void> {
    const nextBody = body.trim();
    if (!nextBody) return;

    if ([...nextBody].length > maxChars) {
      setBody(trimMeshcoreMessageToCharLimit(nextBody, maxChars));
      return;
    }

    await onSend(nextBody);
    setBody('');
  }

  function handleKeyDown(event: React.KeyboardEvent<HTMLTextAreaElement>): void {
    if (mentionQuery && filteredMentions.length > 0) {
      if (event.key === 'ArrowDown') {
        event.preventDefault();
        setActiveMentionIndex((current) => (current + 1) % filteredMentions.length);
        return;
      }

      if (event.key === 'ArrowUp') {
        event.preventDefault();
        setActiveMentionIndex((current) => (current - 1 + filteredMentions.length) % filteredMentions.length);
        return;
      }

      if (event.key === 'Tab') {
        event.preventDefault();
        replaceMention(filteredMentions[activeMentionIndex] ?? filteredMentions[0]);
        return;
      }

      if (event.key === 'Enter' && !event.shiftKey) {
        event.preventDefault();
        replaceMention(filteredMentions[activeMentionIndex] ?? filteredMentions[0]);
        return;
      }
    }

    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault();
      if (canSend) void doSend();
    }
  }

  return (
    <div className="mt-3 rounded-2xl border border-white/[0.08] bg-white/[0.03] backdrop-blur-sm">
      <textarea
        ref={textareaRef}
        className="block w-full resize-none bg-transparent px-4 pt-3.5 pb-3 text-sm leading-relaxed text-slate-100 outline-none placeholder:text-white/25"
        placeholder="Transmit into the mesh… (Enter to send, Shift+Enter for newline)"
        value={body}
        disabled={disabled}
        rows={3}
        onChange={(e) => {
          setBody(trimMeshcoreMessageToCharLimit(e.target.value, maxChars));
          setActiveMentionIndex(0);
        }}
        onKeyDown={handleKeyDown}
      />
      {mentionQuery && filteredMentions.length > 0 ? (
        <div className="border-t border-white/[0.06] px-2 py-2">
          <div className="mb-1 px-2 text-[11px] uppercase tracking-widest text-white/25">Mention</div>
          <div className="flex flex-col gap-1">
            {filteredMentions.map((candidate, index) => (
              <button
                key={candidate.key}
                type="button"
                className={`flex items-center justify-between rounded-xl px-3 py-2 text-left text-sm transition ${
                  index === activeMentionIndex
                    ? 'bg-sky-400/15 text-sky-200'
                    : 'text-slate-300 hover:bg-white/[0.05] hover:text-white'
                }`}
                onMouseDown={(event) => {
                  event.preventDefault();
                  replaceMention(candidate);
                }}
              >
                <span className="truncate">{formatMentionDisplay(candidate.label)}</span>
                {candidate.detail ? <span className="ml-3 shrink-0 text-[11px] text-white/35">{candidate.detail}</span> : null}
              </button>
            ))}
          </div>
        </div>
      ) : null}
      <div className="flex min-h-12 shrink-0 items-center justify-between border-t border-white/[0.06] px-4 pb-3 pt-3">
        <div className="flex min-w-0 flex-col">
          {suggestedMention ? (
            <span className="truncate text-[11px] text-white/25">
              Type `@` to mention. Recent: {formatMentionDisplay(suggestedMention.label)}
            </span>
          ) : null}
          <span
            className={`text-[11px] transition-colors ${
              remaining < 20 ? 'text-amber-400/70' : 'text-white/20'
            }`}
          >
            {remaining} chars left
          </span>
        </div>
        <button
          type="button"
          disabled={!canSend}
          onClick={() => void doSend()}
          className="flex h-9 w-9 items-center justify-center rounded-full bg-sky-500 text-white shadow-[0_4px_14px_rgba(14,165,233,0.4)] transition-all hover:bg-sky-400 disabled:bg-white/10 disabled:shadow-none disabled:opacity-30"
        >
          <ArrowUp size={15} />
        </button>
      </div>
    </div>
  );
}
