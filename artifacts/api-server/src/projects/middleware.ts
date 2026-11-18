import type { RequestHandler } from "express";
import { withProjectDatabase } from "@workspace/db";
import { authorizedProject } from "./service";
import { AiError } from "../assessment-ai";

/** Every product API is explicitly scoped; the server never trusts a cookie's last project. */
export const requireProject: RequestHandler = async (req, res, next) => {
  if (!/^\/(?:clean-core|shared-assessments|report-templates)(?:\/|$)/.test(req.path)) { next(); return; }
  if (!req.identity || req.identity.user.mustChangePassword) { res.status(401).json({ message: "Sign in and change your temporary password first." }); return; }
  const id = req.headers["x-cc-project-id"];
  if (typeof id !== "string" || !/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/.test(id)) {
    res.status(400).json({ message: "Select a client and project before using assessment tools." }); return;
  }
  try {
    const scope = await authorizedProject(String(req.identity.user.id), id);
    res.setHeader("X-CC-Project-ID", scope.projectId);
    withProjectDatabase(scope, next);
  } catch (error) {
    res.status(error instanceof AiError ? error.status : 503).json({
      message: error instanceof AiError ? error.message : "Project access could not be verified. No project data was accessed.",
    });
  }
};
