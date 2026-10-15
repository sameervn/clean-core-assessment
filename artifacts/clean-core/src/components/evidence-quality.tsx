import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";

export function EvidenceQuality({ assessment, evidence }: { assessment: any; evidence: any[] }) {
  if (!evidence.length) return null;
  const quality = assessment?.evidenceQuality;
  return (
    <Card>
      <CardHeader>
        <CardTitle>Evidence quality & provenance</CardTitle>
        <CardDescription>
          Imported evidence supports an assessment, not SAP certification or a live system audit.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {assessment && <div className="space-y-2 text-sm">
          <p>Overall evidence confidence: <Badge variant="outline">{quality.confidence}</Badge></p>
          <p className="text-muted-foreground">{quality.authority}</p>
          <p className="text-xs text-muted-foreground">Engine: {assessment.provenance.engineVersion} · Generated: {new Date(assessment.provenance.generatedAt).toLocaleString()}</p>
          {quality.gaps?.length > 0
            ? <div className="rounded-md border border-amber-300 bg-amber-50 p-3 text-amber-950"><strong>Evidence gaps</strong><ul className="mt-2 list-disc pl-5">{quality.gaps.map((gap: string, index: number) => <li key={index}>{gap}</li>)}</ul></div>
            : <p>No evidence gaps flagged by the engine. Validate collection scope with your SAP owners.</p>}
        </div>}
        <div className="space-y-3">
          {evidence.map(set => <div key={set.type} className="rounded-md border p-3 text-sm">
            <div className="flex flex-wrap justify-between gap-2">
              <strong>{set.fileName || set.type}</strong>
              <Badge variant="secondary">{set.metadata?.demo ? "Synthetic demo" : "Uploaded evidence"}</Badge>
            </div>
            <dl className="mt-2 grid gap-2 text-xs sm:grid-cols-2">
              <div><dt className="text-muted-foreground">Source</dt><dd>{set.metadata?.source || set.type}</dd></div>
              <div><dt className="text-muted-foreground">Imported</dt><dd>{set.metadata?.importedAt ? new Date(set.metadata.importedAt).toLocaleString() : "Not supplied"}</dd></div>
              <div><dt className="text-muted-foreground">Collection period</dt><dd>{set.metadata?.collectionStart || "Not supplied"} — {set.metadata?.collectionEnd || "Not supplied"}</dd></div>
              <div><dt className="text-muted-foreground">Freshness / confidence</dt><dd>{set.metadata?.freshness || "Unknown"} / {set.metadata?.confidence || "Unknown"}</dd></div>
              <div><dt className="text-muted-foreground">Object coverage</dt><dd>{quality?.coverageByType?.[set.type] !== undefined ? `${quality.coverageByType[set.type]}%` : "Run an assessment to calculate"}</dd></div>
              <div><dt className="text-muted-foreground">Integrity</dt><dd>Server-attested; verified again when assessment runs</dd></div>
            </dl>
          </div>)}
        </div>
      </CardContent>
    </Card>
  );
}
