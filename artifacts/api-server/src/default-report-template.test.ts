import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import PizZip from "pizzip";
import { pool, systemPool, withProjectDatabase, type ProjectDatabaseScope } from "@workspace/db";
import { createSession } from "./auth/service";
import { createClient, createProject, authorizedProject, updateProjectMember } from "./projects/service";
import { provisionNextProject } from "./projects/provisioner";
import { storePrivate } from "./collaboration/files";
import { contentSchema } from "./collaboration/contract";
import { sample } from "./reports/engine.mjs";
import { example, BUILTIN_TEMPLATE_ID, BUILTIN_TEMPLATE_NAME } from "./reports/contract.mjs";

test("YASH defaults span isolated projects; explicit overrides win and sealed reports never change", {
  skip: process.env.CC_TEST_PROJECTS !== "true", timeout: 120_000,
}, async () => {
  const keys = ["CC_KNOWLEDGE_STORAGE", "CC_STORAGE_LOCAL_DIR", "PRIVATE_OBJECT_DIR"] as const;
  const env = Object.fromEntries(keys.map(k => [k, process.env[k]]));
  const local = await mkdtemp(join(tmpdir(), "cc-default-report-"));
  process.env.CC_KNOWLEDGE_STORAGE = "local";
  process.env.CC_STORAGE_LOCAL_DIR = local;
  process.env.PRIVATE_OBJECT_DIR = "/synthetic-default-report/private";
  const ids = [randomUUID(), randomUUID()];
  const projects: string[] = [], clients: string[] = [], scopes: ProjectDatabaseScope[] = [];
  const { default: app } = await import("./app");
  const server = app.listen(0, "127.0.0.1");
  await new Promise<void>(resolve => server.once("listening", resolve));
  const base = `http://127.0.0.1:${(server.address() as any).port}`;
  try {
    const sessions: Array<{ token: string; csrf: string }> = [];
    for (const [i,role] of ["Admin", "Reviewer"].entries()) {
      await systemPool.query(`INSERT INTO public.cc_accounts(id,username,password_hash,role,must_change_password)
        VALUES($1,$2,'synthetic-not-login-capable',$3,false)`, [ids[i], `default-report-${randomUUID()}`, role]);
      sessions.push(await createSession(systemPool, ids[i]));
    }
    const request = (project: string, path: string, method = "GET", body?: unknown, who = 0) => fetch(`${base}/api${path}`, {
      method, headers: { Origin: base, Cookie: `cc_session=${sessions[who].token}`, "X-CSRF-Token": sessions[who].csrf,
        "X-CC-Project-ID": project, "Content-Type": "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const json = async (r: Response) => { const value = await r.json() as any; assert.equal(r.status, 200, JSON.stringify(value)); return value; };
    for (let i = 0; i < 2; i++) {
      const client = await createClient(ids[0], `Default report fixture ${randomUUID()}`); clients.push(client.id);
      const project = await createProject(ids[0], { clientId: client.id, name: "Default report fixture" }); projects.push(project.id);
      assert.equal(await provisionNextProject(), "ready");
      scopes.push(await authorizedProject(ids[0], project.id));
      const listing = await json(await request(project.id, "/report-templates"));
      assert.equal(listing.activeId, BUILTIN_TEMPLATE_ID);
      assert.equal(listing.templates.length, 0);
    }
    await updateProjectMember(ids[0], projects[0], ids[1], true);
    assert.equal((await request(projects[1], "/report-templates", "GET", undefined, 1)).status, 404);
    const blank = await request(projects[0], "/report-templates/sample?layout=yash");
    assert.equal(blank.status, 200);
    assert.match(new PizZip(Buffer.from(await blank.arrayBuffer())).file("word/document.xml")!.asText(), /\{entity_id\}/);
    assert.equal((await request(projects[0], "/report-templates/preview", "POST", { templateId: BUILTIN_TEMPLATE_ID })).status, 200);
    assert.equal((await request(projects[0], "/report-templates/preview", "POST", { templateId: BUILTIN_TEMPLATE_ID, expectedVersion: 99 })).status, 409);
    const batch = await request(projects[0], "/report-templates/render", "POST", { templateId: BUILTIN_TEMPLATE_ID,
      entities: ["object", "interface"].map(kind => ({ ...example, entity_id: `SYNTHETIC_${kind}`, entity_kind: kind })) });
    assert.equal(batch.status, 200);
    const batchZip = new PizZip(Buffer.from(await batch.arrayBuffer()));
    assert.equal(Object.keys(batchZip.files).filter(n => n.endsWith(".docx")).length, 2);

    const content = contentSchema.parse({ classification: "C", classificationExplanation: "Synthetic reviewed rationale",
      disposition: "refactor", narrative: "Synthetic assessment narrative", complexitySize: "M",
      recommendation: "Validate extension contract", recommendationRationale: "", prerequisites: "", cautions: "",
      alternatives: "", validationQuestions: "", mitigation: "Validate evidence", mitigationValidation: "Run checks" });
    const published = await json(await request(projects[0], "/shared-assessments", "POST", {
      importKey: randomUUID(), name: "Synthetic default report", system: "TST", targetRelease: "S4HANA_2025",
      entities: ["object", "interface"].map(kind => ({ key: `SYNTHETIC_${kind}`, name: `SYNTHETIC_${kind}`, kind,
        content, evidence: { snapshot: kind === "object" ? { objectType: "PROG" } : { interfaceType: "IDoc" } } })),
    }));
    const assessment = published.assessment.id;
    await json(await request(projects[0], `/shared-assessments/${assessment}/members`, "PUT", { userId: ids[1], access: "review" }));
    const detail = await json(await request(projects[0], `/shared-assessments/${assessment}`));
    for (const e of detail.entities) {
      const assigned = await json(await request(projects[0], `/shared-assessments/entities/${e.id}/reviewer`, "PUT", { expectedVersion: e.version, reviewerId: ids[1] }));
      const submitted = await json(await request(projects[0], `/shared-assessments/entities/${e.id}/actions`, "POST",
        { expectedVersion: assigned.entity.version, action: "submit", comment: "", requestId: randomUUID() }));
      const approved = await json(await request(projects[0], `/shared-assessments/entities/${e.id}/actions`, "POST",
        { expectedVersion: submitted.entity.version, action: "approve", comment: "Synthetic review", requestId: randomUUID() }, 1));
      assert.equal(approved.entity.state, "Approved");
    }
    const approvals = (await json(await request(projects[0], "/shared-assessments/approvals/list"))).approvals;
    assert.equal(approvals.length, 2);
    for (const a of approvals) { assert.equal(a.template_name, BUILTIN_TEMPLATE_NAME); assert.equal(a.template_version, 1); }
    const download = () => request(projects[0], "/shared-assessments/approvals/download", "POST", { ids: [approvals[0].id] });
    const first = await download(); assert.equal(first.status, 200);
    const sealed = Buffer.from(await first.arrayBuffer());
    assert.match(new PizZip(sealed).file("word/document.xml")!.asText(), /Synthetic assessment narrative/);

    let personalId = "", companyId = "";
    await withProjectDatabase(scopes[0], async () => {
      const custom = new PizZip(sample());
      custom.file("word/document.xml", custom.file("word/document.xml")!.asText().replace("Clean Core — sample report template", "SYNTHETIC PRIVATE LAYOUT"));
      const path = await storePrivate("report-templates", custom.generate({ type: "nodebuffer" }));
      personalId = randomUUID();
      await pool.query(`INSERT INTO cc_report_templates(id,owner_id,name,status,object_path,previewed,active)
        VALUES($1,$2,'Synthetic personal','ready',$3,true,true)`, [personalId, ids[0], path]);
    });
    assert.equal((await json(await request(projects[0], "/report-templates"))).activeId, personalId);
    await withProjectDatabase(scopes[0], async () => {
      const path = await storePrivate("company-templates", sample());
      companyId = randomUUID();
      await pool.query("INSERT INTO cc_company_templates(id,name,version,previewed,active,created_by) VALUES($1,'Synthetic company',1,true,true,$2)", [companyId, ids[0]]);
      await pool.query("INSERT INTO cc_company_template_versions(template_id,version,object_path,name) VALUES($1,1,$2,'Synthetic company')", [companyId, path]);
    });
    assert.equal((await json(await request(projects[0], "/report-templates"))).activeId, companyId);
    assert.equal((await json(await request(projects[1], "/report-templates"))).activeId, BUILTIN_TEMPLATE_ID);
    const selected = await request(projects[0], "/report-templates/render", "POST", { templateId: personalId, entities: [example] });
    assert.equal(selected.status, 200);
    assert.match(new PizZip(Buffer.from(await selected.arrayBuffer())).file("word/document.xml")!.asText(), /SYNTHETIC PRIVATE LAYOUT/);
    assert.equal((await request(projects[1], "/report-templates/render", "POST", { templateId: personalId, entities: [example] })).status, 404);
    const current = (await json(await request(projects[0], `/shared-assessments/${assessment}`))).entities.find((e: any) => e.kind === "interface");
    const edited = await json(await request(projects[0], `/shared-assessments/entities/${current.id}`, "PUT",
      { expectedVersion: current.version, content: { ...content, narrative: "Synthetic later custom-layout revision" } }));
    const submitted = await json(await request(projects[0], `/shared-assessments/entities/${current.id}/actions`, "POST",
      { expectedVersion: edited.entity.version, action: "submit", comment: "", requestId: randomUUID() }));
    await json(await request(projects[0], `/shared-assessments/entities/${current.id}/actions`, "POST",
      { expectedVersion: submitted.entity.version, action: "approve", comment: "Synthetic custom-layout review", requestId: randomUUID() }, 1));
    const latest = (await json(await request(projects[0], "/shared-assessments/approvals/list"))).approvals;
    assert.equal(latest.find((a: any) => a.entity_id === current.id).template_name, "Synthetic company");
    const stillSealed = await download(); assert.equal(stillSealed.status, 200);
    assert.deepEqual(Buffer.from(await stillSealed.arrayBuffer()), sealed);
  } finally {
    await new Promise<void>(resolve => server.close(() => resolve()));
    for (const id of projects) {
      const schema = `ccp_${id.replaceAll("-", "")}`; assert.match(schema, /^ccp_[a-f0-9]{32}$/);
      await systemPool.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
      await systemPool.query("DELETE FROM public.cc_project_audit WHERE project_id=$1", [id]);
      await systemPool.query("DELETE FROM public.cc_project_members WHERE project_id=$1", [id]);
      await systemPool.query("DELETE FROM public.cc_projects WHERE id=$1", [id]);
    }
    await systemPool.query("DELETE FROM public.cc_project_audit WHERE actor_id=ANY($1)", [ids]);
    await systemPool.query("DELETE FROM public.cc_clients WHERE id=ANY($1::uuid[])", [clients]);
    await systemPool.query("DELETE FROM public.cc_accounts WHERE id=ANY($1)", [ids]);
    for (const key of keys) { if (env[key] === undefined) delete process.env[key]; else process.env[key] = env[key]; }
    await rm(local, { recursive: true, force: true });
    await pool.end();
  }
});
