import { useEffect, useState } from "react";
import { Link } from "wouter";
import type { KnowledgeSource } from "@workspace/api-client-react";
import { apiFetch } from "@/lib/api";

/** Never persist excerpts in accepted narratives or retain a link to a removed version. */
export function KnowledgeSources({ sources }: { sources?: KnowledgeSource[] }) {
  const [documents, setDocuments] = useState<Record<string, number> | null>(null);
  const [excerpts, setExcerpts] = useState<Record<string, Array<{ section: string; text: string }>>>({});
  const [error, setError] = useState("");
  useEffect(() => {
    let live = true;
    const check = async () => {
      try {
        const res = await apiFetch("/api/clean-core/knowledge");
        if (!res.ok) throw new Error();
        const body = await res.json();
        if (live) { setDocuments(Object.fromEntries(body.documents.filter((d: any) => d.status === "ready").map((d: any) => [d.id, d.version]))); setExcerpts({}); }
      } catch { if (live) { setDocuments(null); setExcerpts({}); } }
    };
    void check();
    const timer = window.setInterval(check, 30_000);
    window.addEventListener("focus", check);
    return () => { live = false; window.clearInterval(timer); window.removeEventListener("focus", check); };
  }, []);
  if (!sources) return <p className="text-xs">Source status unknown — legacy explanation.</p>;
  if (!sources.length) return <p className="text-xs">No uploaded sources. Review the general-model fallback disclosure.</p>;
  return <div className="space-y-2 rounded border p-2">
    <p className="font-medium">Uploaded sources</p>
    {sources.map((s, i) => {
      const current = documents?.[s.id] === s.version;
      return <div key={`${s.id}-${i}`} className="text-xs">
        <p>[{i + 1}] {s.title} · v{s.version} · {s.section} · {s.release} · {s.applicability}</p>
        {!documents ? <p>Source status unverified — library unavailable or access denied.</p>
          : !current ? <p role="status" className="text-amber-700">Stale source — this document was replaced or removed. Historical citation only; content link disabled.</p>
          : <><Link href="/knowledge" className="underline">Open shared library</Link>{" · "}
            <button className="underline" onClick={async () => {
              setError("");
              try {
                const response = await apiFetch(`/api/clean-core/knowledge/${s.id}`);
                if (!response.ok) throw new Error();
                const doc = await response.json();
                if (doc.version !== s.version || doc.status !== "ready") throw new Error();
                setExcerpts(prev => ({ ...prev, [s.id]: doc.passages.filter((p: any) => p.section === s.section) }));
              } catch { setError("This source is no longer accessible. Refresh before using it."); setExcerpts({}); setDocuments(null); }
            }}>Inspect source excerpt</button>
            {excerpts[s.id]?.map((p, n) => <blockquote key={n} className="my-2 whitespace-pre-wrap border-l-2 pl-2">{p.text}</blockquote>)}
          </>}
      </div>;
    })}
    {error && <p role="alert">{error}</p>}
  </div>;
}
