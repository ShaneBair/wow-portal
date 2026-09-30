import { Router, type RequestHandler } from "express";
import {
  createAccountVisibilityMiddleware,
  type AccountVisibilityLocals
} from "../middleware/account-visibility.js";
import type { AccountVisibilityScope } from "../services/account-visibility.js";
import { StatsDatabaseConfigurationError } from "../services/stats-database.js";
import { statsReadLimiter } from "../services/stats-http.js";
import {
  getVendorTrashMagnate,
  type VendorTrashMagnateResponse
} from "../services/vendor-trash-magnate.js";

const INVALID_POPULATION_MESSAGE = "Vendor Trash Magnate does not accept a population filter.";
const UNAVAILABLE_MESSAGE = "Vendor Trash Magnate statistics are temporarily unavailable.";

type LoadLeaderboard = (
  visibility: AccountVisibilityScope
) => Promise<VendorTrashMagnateResponse>;

export function createStatsVendorTrashMagnateRouter(
  loadLeaderboard: LoadLeaderboard = getVendorTrashMagnate,
  limiter: RequestHandler = statsReadLimiter,
  visibility: RequestHandler = createAccountVisibilityMiddleware({
    unavailableMessage: UNAVAILABLE_MESSAGE,
    logLabel: "Vendor Trash Magnate statistics"
  })
): Router {
  const router = Router();
  router.get(
    "/api/stats/vendor-trash-magnate",
    (_request, response, next) => {
      response.set("Cache-Control", "no-store");
      response.vary("Cookie");
      next();
    },
    limiter,
    visibility,
    async (request, response) => {
      if (request.query.population !== undefined) {
        return response.status(400).json({ error: INVALID_POPULATION_MESSAGE });
      }
      try {
        const locals = response.locals as AccountVisibilityLocals;
        return response.json(await loadLeaderboard(locals.accountVisibilityScope));
      } catch (error) {
        if (error instanceof StatsDatabaseConfigurationError) {
          console.error("Vendor Trash Magnate statistics configuration is invalid.");
        } else {
          const kind = error instanceof Error ? error.name : "UnknownError";
          console.error(`Vendor Trash Magnate statistics request failed (${kind}).`);
        }
        return response.status(503).json({ error: UNAVAILABLE_MESSAGE });
      }
    }
  );
  return router;
}

export default createStatsVendorTrashMagnateRouter();
