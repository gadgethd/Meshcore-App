import type { ReactNode } from 'react';

interface AppShellProps {
  header: ReactNode;
  children: ReactNode;
}

export function AppShell({ header, children }: AppShellProps) {
  return (
    <div className="mx-auto flex h-screen max-w-[1440px] flex-col gap-5 overflow-hidden px-4 py-5 text-slate-100 md:px-6">
      <header className="mesh-panel flex flex-col gap-4 px-5 py-4 md:flex-row md:items-end md:justify-between">
        {header}
      </header>
      <main className="min-h-0 flex-1 overflow-hidden">{children}</main>
    </div>
  );
}
