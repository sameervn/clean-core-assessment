import { FileText, FlaskConical, Play } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { EvidenceQuality } from "@/components/evidence-quality";
import { WorkspaceBackupCard } from "@/components/workspace-controls";
import { AssessmentAiSettings } from "@/components/assessment-ai";

export default function EvidenceTab({ ctx, evidenceTypes }: {
  ctx: any;
  evidenceTypes: ReadonlyArray<{ id: string; label: string }>;
}) {
  return (
     <div className="space-y-6 max-w-5xl mx-auto h-full overflow-y-auto pr-4 pb-8">
        <AssessmentAiSettings />
        <Card className="shadow-sm">
           <CardHeader className="bg-muted/20 border-b">
              <CardTitle>Assessment Context</CardTitle>
              <CardDescription>Define the boundaries of this assessment run</CardDescription>
           </CardHeader>
           <CardContent className="grid grid-cols-1 sm:grid-cols-2 gap-6 pt-6">
              <div className="space-y-2">
                <Label>System ID</Label>
                <Input disabled={!ctx.perms.run} value={ctx.system} onChange={e => ctx.setSystem(e.target.value)} />
              </div>
              <div className="space-y-2">
                <Label htmlFor="assessment-target">Target Release</Label>
                <Input id="assessment-target" disabled={!ctx.perms.run} value={ctx.targetRelease} onChange={e => ctx.setTargetRelease(e.target.value)} />
                <p className="text-xs text-muted-foreground">{ctx.targetRelease.replace("S4HANA_", "S/4HANA ")}. New assessments default to S/4HANA 2025. Changing this target does not add release-specific SAP rules.</p>
              </div>
              <div className="sm:col-span-2 flex items-start gap-3">
                <Checkbox id="weighted-scoring" disabled={!ctx.perms.run} checked={ctx.weighted} onCheckedChange={v => ctx.setWeighted(v === true)} data-testid="checkbox-weighted" />
                <div className="space-y-1">
                  <Label htmlFor="weighted-scoring">Weighted scoring</Label>
                  <p className="text-xs text-muted-foreground">Weight scores by usage and complexity evidence. Changing system, release or weighting clears the current assessment; re-run the engine. The baseline is kept for comparison.</p>
                </div>
              </div>
           </CardContent>
        </Card>

        <Card className="shadow-sm">
           <CardHeader className="bg-muted/20 border-b">
              <CardTitle>Evidence Collection</CardTitle>
              <CardDescription>Provide the raw data sources required for the assessment engine</CardDescription>
           </CardHeader>
           <CardContent className="space-y-6 pt-6">
              <div className="p-5 border rounded-xl bg-muted/10 flex items-center justify-between hover-elevate transition-all">
                 <div className="flex gap-4 items-start">
                   <div className="p-3 bg-primary/10 text-primary rounded-lg">
                      <FlaskConical className="w-6 h-6" />
                   </div>
                   <div>
                     <h4 className="font-semibold">Demo Landscape</h4>
                     <p className="text-sm text-muted-foreground mt-1 max-w-lg">Load pre-configured demo evidence to instantly populate the cockpit for presentation or evaluation purposes.</p>
                   </div>
                 </div>
                  <Button onClick={ctx.requestDemo} data-testid="button-load-demo" disabled={ctx.loadDemoData.isPending || !ctx.perms.evidence || !ctx.perms.run} size="lg">
                     {ctx.loadDemoData.isPending ? "Building 4,000-object landscape…" : "Load Demo Data"}
                 </Button>
              </div>

              <div className="p-5 border rounded-xl">
                 <div className="flex items-center justify-between mb-4">
                    <div>
                      <h4 className="font-semibold text-lg">Manual Upload</h4>
                      <p className="text-sm text-muted-foreground">Import ATC results, readiness checks, or custom evidence extracts.</p>
                    </div>
                 </div>
                 <div className="flex flex-col md:flex-row items-center gap-3 bg-muted/30 p-2 rounded-lg border">
                    <Select value={ctx.evidenceType} onValueChange={ctx.setEvidenceType}>
                       <SelectTrigger className="w-full md:w-[250px] bg-background">
                          <SelectValue />
                       </SelectTrigger>
                       <SelectContent>
                          {evidenceTypes.map(t => <SelectItem key={t.id} value={t.id}>{t.label}</SelectItem>)}
                       </SelectContent>
                    </Select>
                     <Input type="file" accept=".xml,.json,.csv,.tsv,.txt" disabled={ctx.uploadEvidence.isPending || !ctx.perms.evidence} className="flex-1 bg-background cursor-pointer" onChange={e => {
                       const file = e.target.files?.[0];
                       if (file) ctx.uploadEvidence.mutate(file);
                    }} />
                 </div>
                  <div className="mt-2 flex items-center justify-between text-xs text-muted-foreground">
                    <span>XML, JSON, CSV, TSV, or TXT · up to 16 MB per file, 16 MB combined after normalization</span>
                    <span>{ctx.uploadEvidence.isPending ? "Streaming upload and normalizing…" : "Files are normalized before assessment"}</span>
                  </div>
                  {ctx.uploadEvidence.isPending && (
                    <div className="mt-3 h-1.5 overflow-hidden rounded-full bg-muted">
                      <div className="h-full w-2/3 animate-pulse rounded-full bg-primary" />
                    </div>
                  )}
                 {ctx.evidence.length > 0 && (
                     <div className="mt-4 pt-4 border-t space-y-2">
                        <Label className="text-muted-foreground text-xs uppercase tracking-wider">Loaded Evidence Sets</Label>
                        <div className="flex flex-col gap-2">
                           {ctx.evidence.map((e: any, idx: number) => (
                              <div key={idx} className="flex items-center justify-between text-sm bg-background border p-2 rounded flex-wrap gap-2">
                                 <span className="font-medium flex items-center gap-2"><FileText className="w-4 h-4 text-muted-foreground"/> {evidenceTypes.find(t=>t.id===e.type)?.label || e.type}</span>
                                 <span className="text-muted-foreground">{e.count} records</span>
                              </div>
                           ))}
                        </div>
                     </div>
                 )}
              </div>

              <div className="pt-2 flex justify-end">
                  <Button size="lg" onClick={() => ctx.runAssessment.mutate()} disabled={ctx.runAssessment.isPending || ctx.evidence.length === 0 || !ctx.perms.run} className="w-full md:w-auto shadow-sm">
                     <Play className="w-4 h-4 mr-2" /> {ctx.runAssessment.isPending ? "Classifying and building roadmap…" : "Run Assessment Engine"}
                 </Button>
              </div>
           </CardContent>
        </Card>

        {ctx.assessment && (
            <Card className="shadow-sm border-blue-200 dark:border-blue-900/50 bg-blue-50/30 dark:bg-blue-900/10">
               <CardHeader className="border-b border-blue-100 dark:border-blue-900/30 pb-4">
                  <CardTitle className="text-blue-800 dark:text-blue-300">Baseline Management</CardTitle>
                  <CardDescription className="text-blue-700/70 dark:text-blue-400/70">Pin the current assessment as a comparative baseline to track progress over time.</CardDescription>
               </CardHeader>
               <CardContent className="pt-4 flex justify-between items-center">
                  <p className="text-sm text-blue-900/80 dark:text-blue-200/80 max-w-md">Saving a baseline allows the dashboard to show progression metrics (resolved vs introduced risks).</p>
                  <Button variant="outline" className="border-blue-300 text-blue-700 hover:bg-blue-100 dark:border-blue-700 dark:text-blue-300 dark:hover:bg-blue-900" onClick={ctx.saveBaseline} disabled={!ctx.perms.baseline}>Set Current as Baseline</Button>
               </CardContent>
            </Card>
        )}
        <EvidenceQuality assessment={ctx.assessment} evidence={ctx.evidence} />
        {!ctx.readOnly && <WorkspaceBackupCard onExport={ctx.exportBackup} onRestore={ctx.handleRestoreFile} onReset={ctx.requestReset} canExport={ctx.perms.export} canRestore={ctx.perms.restore} canReset={ctx.perms.reset} />}
     </div>
  )
}
