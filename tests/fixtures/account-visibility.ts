import type { RequestHandler } from "express";
import type { AccountVisibilityLocals } from "../../src/middleware/account-visibility.js";
import type { AccountVisibilityScope } from "../../src/services/account-visibility.js";

export const fullVisibility: AccountVisibilityScope = Object.freeze({
  cacheKey: "full",
  excludedAccountIds: Object.freeze([])
});

export function standardVisibility(
  excludedAccountIds: readonly number[] = []
): AccountVisibilityScope {
  return Object.freeze({
    cacheKey: "standard",
    excludedAccountIds: Object.freeze([...excludedAccountIds])
  });
}

export function attachVisibility(scope: AccountVisibilityScope): RequestHandler {
  return (_request, response, next) => {
    (response.locals as AccountVisibilityLocals).accountVisibilityScope = scope;
    next();
  };
}
