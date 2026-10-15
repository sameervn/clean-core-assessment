import type { ReactNode } from "react";
import { ShieldCheck } from "lucide-react";
import { YashLogo } from "@/components/yash-logo";

/** Branded split layout shared by sign-in, setup and password screens. */
export function AuthLayout({ eyebrow, title, children, footnote }: { eyebrow: string; title: string; children: ReactNode; footnote?: ReactNode }) {
  return (
    <div className="grid min-h-[100dvh] bg-[#f3f6f9] lg:grid-cols-[minmax(0,1.05fr)_minmax(0,1fr)]">
      <aside className="relative hidden overflow-hidden bg-[#081d33] text-[#d9e6f0] lg:flex lg:flex-col lg:justify-between lg:p-12">
        <div aria-hidden className="pointer-events-none absolute inset-0 opacity-[0.14]"
          style={{ backgroundImage: "linear-gradient(#70d6c2 1px, transparent 1px), linear-gradient(90deg, #70d6c2 1px, transparent 1px)", backgroundSize: "44px 44px" }} />
        <div aria-hidden className="pointer-events-none absolute -bottom-40 -right-24 h-[30rem] w-[30rem] rounded-full border-[56px] border-[#70d6c2]/10" />
        <div className="relative"><YashLogo /></div>
        <div className="relative max-w-md space-y-6">
          <p className="font-mono text-xs uppercase tracking-[0.28em] text-[#70d6c2]">Clean Core Assessment Accelerator</p>
          <p className="text-4xl font-semibold leading-[1.1] text-white">Classify every custom object. Plan every wave. Keep the core clean.</p>
          <div className="grid grid-cols-4 gap-2 pt-2 font-mono text-[11px]">
            {[["A", "Standard"], ["B", "Dev ext."], ["C", "Classic"], ["D", "Modif."]].map(([l, t]) => (
              <div key={l} className="rounded border border-white/10 bg-white/[0.04] p-2">
                <div className="text-lg font-semibold text-white">{l}</div><div className="text-[#9db4c6]">{t}</div>
              </div>
            ))}
          </div>
        </div>
        <p className="relative flex items-center gap-2 text-xs text-[#9db4c6]">
          <ShieldCheck className="h-4 w-4 text-[#70d6c2]" /> Accounts are managed by your administrator. There is no public sign-up.
        </p>
      </aside>
      <main className="flex items-center justify-center p-5 sm:p-10">
        <div className="w-full max-w-sm animate-in fade-in slide-in-from-bottom-2 duration-500">
          <div className="mb-8 lg:hidden"><YashLogo /></div>
          <p className="font-mono text-[11px] uppercase tracking-[0.24em] text-[#0b7a6b]">{eyebrow}</p>
          <h1 className="mt-2 text-2xl font-semibold tracking-tight text-[#081d33]">{title}</h1>
          <div className="mt-7">{children}</div>
          {footnote && <div className="mt-8 border-t pt-4 text-xs leading-relaxed text-slate-500">{footnote}</div>}
        </div>
      </main>
    </div>
  );
}
