import { Router, type RequestHandler } from "express";
import { z } from "zod";
import {
  CreateAssessmentClientBody, CreateAssessmentClientResponse, CreateClientProjectBody, CreateClientProjectResponse,
  UpdateClientProjectBody, UpdateClientProjectResponse, ListClientProjectsResponse,
  UpdateClientProjectMemberBody, UpdateClientProjectMemberResponse, GetClientProjectMembersResponse,
  ChangeProjectProvisioningBody, ChangeProjectProvisioningResponse,
} from "@workspace/api-zod";
import { requireAdmin, requireSession } from "../auth/middleware";
import { AiError } from "../assessment-ai";
import { changeProvisioning, createClient, createProject, projectCatalog, projectMembers, updateProject, updateProjectMember } from "../projects/service";
import { requestLimit } from "../request-limits";

export const clientProjectsRouter = Router();
clientProjectsRouter.use(requireSession, requestLimit("client-project-management", 60));
const wrap = (fn: RequestHandler): RequestHandler => async (req, res, next) => {
  try { await fn(req, res, next); }
  catch (error) {
    res.status(error instanceof AiError ? error.status : error instanceof z.ZodError ? 400 : 503)
      .json({ message: error instanceof AiError ? error.message : error instanceof z.ZodError
        ? "Provide valid client/project details." : "Client/project operation unavailable. No partial project was published. Check deployment migration permissions." });
  }
};
const id = (value: unknown) => z.string().uuid().parse(value);
const cleanName = (value: string) => z.string().trim().min(1).max(120).parse(value);
clientProjectsRouter.get("/", wrap(async (req, res) => {
  res.json(ListClientProjectsResponse.parse(await projectCatalog(String(req.identity!.user.id), req.identity!.user.role === "Admin")));
}));
clientProjectsRouter.post("/clients", requireAdmin, wrap(async (req, res) => {
  const input = CreateAssessmentClientBody.strict().parse(req.body);
  res.status(201).json(CreateAssessmentClientResponse.parse(await createClient(String(req.identity!.user.id), cleanName(input.name))));
}));
clientProjectsRouter.post("/projects", requireAdmin, wrap(async (req, res) => {
  const input = CreateClientProjectBody.strict().parse(req.body);
  res.status(201).json(CreateClientProjectResponse.parse(await createProject(String(req.identity!.user.id), { ...input, name: cleanName(input.name) })));
}));
clientProjectsRouter.patch("/projects/:projectId", requireAdmin, wrap(async (req, res) => {
  const input = UpdateClientProjectBody.strict().parse(req.body);
  res.json(UpdateClientProjectResponse.parse(await updateProject(String(req.identity!.user.id), id(req.params.projectId), { ...input, name: cleanName(input.name) })));
}));
clientProjectsRouter.post("/projects/:projectId/provisioning", requireAdmin, wrap(async (req, res) => {
  const body = ChangeProjectProvisioningBody.strict().parse(req.body);
  res.json(ChangeProjectProvisioningResponse.parse(await changeProvisioning(String(req.identity!.user.id), id(req.params.projectId), body.action)));
}));
clientProjectsRouter.get("/projects/:projectId/members", requireAdmin, wrap(async (req, res) => {
  res.json(GetClientProjectMembersResponse.parse(await projectMembers(id(req.params.projectId))));
}));
clientProjectsRouter.put("/projects/:projectId/members", requireAdmin, wrap(async (req, res) => {
  const body = UpdateClientProjectMemberBody.strict().parse(req.body);
  res.json(UpdateClientProjectMemberResponse.parse(await updateProjectMember(String(req.identity!.user.id), id(req.params.projectId), body.userId, body.enabled)));
}));
