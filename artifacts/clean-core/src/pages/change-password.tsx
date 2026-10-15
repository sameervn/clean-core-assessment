import { useState, type FormEvent } from "react";
import { KeyRound, Loader2, LogOut } from "lucide-react";
import { AuthLayout } from "@/components/auth-layout";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useAuth } from "@/lib/auth";

export const PASSWORD_MIN = 14;
export const PASSWORD_MAX = 128;

export function passwordProblem(pw: string): string | null {
  if (pw.length < PASSWORD_MIN) return `Use at least ${PASSWORD_MIN} characters (${pw.length} so far).`;
  if (pw.length > PASSWORD_MAX) return `Use at most ${PASSWORD_MAX} characters.`;
  return null;
}

export function PasswordMeter({ value }: { value: string }) {
  const pct = Math.min(100, (value.length / PASSWORD_MIN) * 100);
  const ok = value.length >= PASSWORD_MIN && value.length <= PASSWORD_MAX;
  return (
    <div className="space-y-1" aria-hidden>
      <div className="h-1 overflow-hidden rounded bg-slate-200">
        <div className={`h-full origin-left transition-transform duration-300 ${ok ? "bg-[#0b7a6b]" : "bg-amber-500"}`} style={{ transform: `scaleX(${pct / 100})` }} />
      </div>
      <p className="font-mono text-[11px] text-slate-500">{value.length}/{PASSWORD_MIN}+ characters · a long passphrase is best</p>
    </div>
  );
}

/** Mandatory when mustChangePassword is set; also reachable voluntarily. */
export default function ChangePasswordPage({ forced, onCancel }: { forced: boolean; onCancel?: () => void }) {
  const { user, changePassword, logout } = useAuth();
  const [current, setCurrent] = useState("");
  const [next, setNext] = useState("");
  const [confirm, setConfirm] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const problem = passwordProblem(next) || (next === current && next ? "Choose a password different from the current one." : null)
    || (confirm && confirm !== next ? "Passwords do not match." : null);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (busy || problem || confirm !== next) return;
    setBusy(true); setError(null);
    try { await changePassword(current, next); }
    catch (err) { setError(err instanceof Error ? err.message : "Could not change the password."); }
    finally { setBusy(false); }
  };

  return (
    <AuthLayout eyebrow={forced ? "Action required" : "Account security"} title={forced ? "Choose a new password" : "Change password"}
      footnote="Changing your password signs out every session for this account, including this one.">
      {forced && <p className="mb-5 text-sm text-slate-600" data-testid="text-force-change">Signed in as <strong>{user?.username}</strong> with a temporary password. Set your own before using the assessment.</p>}
      <form onSubmit={submit} className="space-y-4">
        <div className="space-y-1.5">
          <Label htmlFor="current-password">{forced ? "Temporary password" : "Current password"}</Label>
          <Input id="current-password" type="password" autoComplete="current-password" value={current} onChange={e => setCurrent(e.target.value)} required maxLength={PASSWORD_MAX} className="h-11 bg-white" data-testid="input-current-password" />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="new-password">New password</Label>
          <Input id="new-password" type="password" autoComplete="new-password" value={next} onChange={e => setNext(e.target.value)} required maxLength={PASSWORD_MAX} className="h-11 bg-white" data-testid="input-new-password" />
          <PasswordMeter value={next} />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="confirm-password">Confirm new password</Label>
          <Input id="confirm-password" type="password" autoComplete="new-password" value={confirm} onChange={e => setConfirm(e.target.value)} required maxLength={PASSWORD_MAX} className="h-11 bg-white" data-testid="input-confirm-password" />
        </div>
        {next && problem && <p className="text-sm text-amber-700" data-testid="text-password-problem">{problem}</p>}
        {error && <p role="alert" className="text-sm text-destructive" data-testid="text-password-error">{error}</p>}
        <Button type="submit" disabled={busy || !!problem || !current || confirm !== next} className="h-11 w-full bg-[#081d33] text-white hover:bg-[#0f2c4a]" data-testid="button-change-password">
          {busy ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <KeyRound className="mr-2 h-4 w-4" />} Update password
        </Button>
        {forced
          ? <Button type="button" variant="ghost" className="w-full" onClick={() => logout().catch((e: Error) => setError(e.message))} data-testid="button-logout"><LogOut className="mr-2 h-4 w-4" /> Sign out instead</Button>
          : <Button type="button" variant="ghost" className="w-full" onClick={onCancel} data-testid="button-cancel-password">Back to assessment</Button>}
      </form>
    </AuthLayout>
  );
}
