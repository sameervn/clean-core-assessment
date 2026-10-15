import { Router, type IRouter } from "express";
import healthRouter from "./health";
import cleanCoreRouter from "./clean-core";

const router: IRouter = Router();

router.use(healthRouter);
router.use(cleanCoreRouter);

export default router;
