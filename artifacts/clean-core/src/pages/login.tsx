import { useState, type FormEvent } from "react";
import { Loader2, LogIn, Terminal } from "lucide-react";
import { AuthLayout } from "@/components/auth-layout";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useAuth } from "@/lib/auth";

export default function LoginPage({ setupRequired, notice }: { setupRequired: boolean; notice?: string }) {
  const { login } = useAuth();
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (setupRequired) {
    return (
      <AuthLayout eyebrow="First deployment" title="An administrator must finish setup"
        footnote="The bootstrap password is never shown, typed or stored in the browser and is never reset on restart.">
        <div className="space-y-4 text-sm text-slate-700" data-testid="setup-required">
          <p>No accounts exist yet. The first <strong>admin</strong> account is created on the server from a deployment-specific secret.</p>
          <ol className="space-y-3">
            {[
              <>Set <code className="rounded bg-slate-200 px-1 font-mono text-xs">CC_BOOTSTRAP_PASSWORD</code> (14–128 characters) through your secret manager.</>,
              <>Restart the API server. It creates <code className="rounded bg-slate-200 px-1 font-mono text-xs">admin</code> exactly once.</>,
              <>Sign in as <strong>admin</strong> and choose a new password when prompted, then remove the secret.</>,
            ].map((step, i) => (
              <li key={i} className="flex gap-3"><span className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-[#081d33] font-mono text-[10px] text-white">{i + 1}</span><span>{step}</span></li>
            ))}
          </ol>
          <p className="flex items-center gap-2 rounded border border-dashed border-slate-300 p-3 text-xs text-slate-500"><Terminal className="h-4 w-4" /> Browser-based bootstrap is intentionally disabled.</p>
          <Button variant="outline" onClick={() => window.location.reload()} data-testid="button-recheck-setup">Check again</Button>
        </div>
      </AuthLayout>
    );
  }

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (busy) return;
    setBusy(true); setError(null);
    try {
      await login(username.trim(), password);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Sign-in failed.");
      setPassword("");
    } finally { setBusy(false); }
  };

  return (
    <AuthLayout eyebrow="Secure sign-in" title="Sign in to Clean Core"
      footnote="Forgot your password? Ask a Clean Core administrator to issue a temporary one. You will choose a new password at next sign-in.">
      {notice && <p role="status" className="mb-5 rounded-md border border-[#70d6c2]/60 bg-[#70d6c2]/10 p-3 text-sm text-[#0b4d44]" data-testid="text-auth-notice">{notice}</p>}
      <form onSubmit={submit} className="space-y-4">
        <div className="space-y-1.5">
          <Label htmlFor="username">Username</Label>
          <Input id="username" autoComplete="username" autoFocus value={username} onChange={e => setUsername(e.target.value)} required maxLength={64} className="h-11 bg-white" data-testid="input-username" />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="password">Password</Label>
          <Input id="password" type="password" autoComplete="current-password" value={password} onChange={e => setPassword(e.target.value)} required maxLength={128} className="h-11 bg-white" data-testid="input-password" />
        </div>
        {error && <p role="alert" className="text-sm text-destructive" data-testid="text-login-error">{error}</p>}
        <Button type="submit" disabled={busy || !username.trim() || !password} className="h-11 w-full bg-[#081d33] text-white hover:bg-[#0f2c4a]" data-testid="button-login">
          {busy ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <LogIn className="mr-2 h-4 w-4" />} Sign in
        </Button>
      </form>
    </AuthLayout>
  );
}
