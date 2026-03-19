import { useState } from 'react';
import { ArrowUp } from 'lucide-react';
import { trimMeshcoreMessageToCharLimit } from '@shared/meshcore';

interface MessageComposerProps {
  disabled?: boolean;
  label: string;
  maxChars: number;
  onSend: (body: string) => Promise<void>;
}

export function MessageComposer({ disabled, maxChars, onSend }: MessageComposerProps) {
  const [body, setBody] = useState('');
  const charCount = [...body].length;
  const remaining = maxChars - charCount;
  const canSend = !disabled && !!body.trim() && remaining >= 0;

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
    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault();
      if (canSend) void doSend();
    }
  }

  return (
    <div className="mt-3 overflow-hidden rounded-2xl border border-white/[0.08] bg-white/[0.03] backdrop-blur-sm">
      <textarea
        className="w-full resize-none bg-transparent px-4 pt-3.5 pb-1 text-sm leading-relaxed text-slate-100 outline-none placeholder:text-white/25"
        placeholder="Transmit into the mesh… (Enter to send, Shift+Enter for newline)"
        value={body}
        disabled={disabled}
        rows={3}
        onChange={(e) => setBody(trimMeshcoreMessageToCharLimit(e.target.value, maxChars))}
        onKeyDown={handleKeyDown}
      />
      <div className="flex items-center justify-between px-4 pb-3 pt-1">
        <span
          className={`text-[11px] transition-colors ${
            remaining < 20 ? 'text-amber-400/70' : 'text-white/20'
          }`}
        >
          {remaining} chars left
        </span>
        <button
          type="button"
          disabled={!canSend}
          onClick={() => void doSend()}
          className="flex h-7 w-7 items-center justify-center rounded-full bg-sky-500 text-white shadow-[0_2px_10px_rgba(14,165,233,0.5)] transition-all hover:bg-sky-400 disabled:bg-white/10 disabled:shadow-none disabled:opacity-30"
        >
          <ArrowUp size={14} />
        </button>
      </div>
    </div>
  );
}
