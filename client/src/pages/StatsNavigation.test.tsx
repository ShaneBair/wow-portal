import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { createMemoryRouter, RouterProvider } from "react-router";
import { afterEach, describe, expect, it, vi } from "vitest";
import { App } from "../App.js";

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
}

function pathOf(input: RequestInfo | URL) {
  if (typeof input === "string") return input;
  if (input instanceof URL) return `${input.pathname}${input.search}`;
  const url = new URL(input.url);
  return `${url.pathname}${url.search}`;
}

function renderPath(path: string) {
  const fetchMock = vi.fn<typeof fetch>((input) => {
    const requestPath = pathOf(input);
    if (requestPath === "/api/auth/session") return Promise.resolve(jsonResponse({ authenticated: false }));
    if (requestPath === "/api/status") return Promise.resolve(jsonResponse({ online: true }));
    if (requestPath.startsWith("/api/stats/deaths?")) return Promise.resolve(jsonResponse({
      generatedAt: "2026-09-30T12:00:00.000Z",
      population: new URL(requestPath, "http://portal.test").searchParams.get("population"),
      coverage: { comprehensiveSince: "2026-08-19T00:00:00.000Z" },
      count: 0,
      entries: []
    }));
    if (requestPath.startsWith("/api/stats/bad-neighborhood?")) return Promise.resolve(jsonResponse({
      generatedAt: "2026-09-30T12:00:00.000Z",
      population: new URL(requestPath, "http://portal.test").searchParams.get("population"),
      coverage: { comprehensiveSince: "2026-08-19T00:00:00.000Z" },
      omittedUnknownZoneDeaths: 0,
      entries: []
    }));
    if (requestPath === "/api/stats/vendor-trash-magnate") return Promise.resolve(jsonResponse({
      generatedAt: "2026-09-30T12:00:00.000Z",
      population: "all-characters",
      coverage: { kind: "azerothcore-lifetime-counter" },
      count: 0,
      entries: []
    }));
    return Promise.resolve(jsonResponse({ error: "Not found." }, 404));
  });
  vi.stubGlobal("fetch", fetchMock);
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: Infinity } } });
  const router = createMemoryRouter([{ path: "*", element: <App /> }], { initialEntries: [path] });
  const view = render(<QueryClientProvider client={queryClient}><RouterProvider router={router} /></QueryClientProvider>);
  return { fetchMock, router, ...view };
}

afterEach(() => vi.unstubAllGlobals());

describe("statistics navigation and discovery", () => {
  it("combines category and literal search filters and exposes recovery actions", async () => {
    const user = userEvent.setup();
    const { fetchMock, router } = renderPath("/stats?population=all");

    await user.click(screen.getByRole("button", { name: "Deaths & Danger" }));
    await user.type(screen.getByRole("searchbox", { name: "Search statistics" }), "raid boss");
    expect(screen.getByRole("link", { name: /The Real Raid Boss/u })).toBeTruthy();
    expect(screen.queryByRole("link", { name: /Most Deaths/u })).toBeNull();
    expect(router.state.location.search).toContain("category=deaths");
    expect(router.state.location.search).toContain("q=raid+boss");

    await user.clear(screen.getByRole("searchbox", { name: "Search statistics" }));
    fireEvent.change(screen.getByRole("searchbox", { name: "Search statistics" }), { target: { value: "[" } });
    expect(screen.getByRole("heading", { name: "No statistics found" })).toBeTruthy();
    await user.click(screen.getByRole("button", { name: "Clear search" }));
    expect(screen.getByRole("link", { name: /Most Deaths/u })).toBeTruthy();
    await user.type(screen.getByRole("searchbox", { name: "Search statistics" }), "vendor");
    await user.click(screen.getByRole("button", { name: "Show all categories" }));
    expect(screen.getByRole("link", { name: /Vendor Trash Magnate/u })).toBeTruthy();
    expect(fetchMock.mock.calls.filter(([input]) => pathOf(input).startsWith("/api/stats/"))).toHaveLength(0);
  });

  it("navigates with the mobile switcher, preserves population, and focuses the next heading", async () => {
    const user = userEvent.setup();
    const { router } = renderPath("/stats/most-deaths?population=all");
    await screen.findByText("No recorded deaths for this population yet.");

    await user.selectOptions(screen.getByLabelText("Statistic"), "bad-neighborhood");
    const heading = await screen.findByRole("heading", { level: 1, name: "Bad Neighborhood" });
    await screen.findByText("No recorded deaths with known locations for this population yet.");
    expect(router.state.location.pathname).toBe("/stats/bad-neighborhood");
    expect(router.state.location.search).toBe("?population=all");
    await waitFor(() => expect(document.activeElement).toBe(heading));

    await act(async () => router.navigate(-1));
    expect(await screen.findByRole("heading", { level: 1, name: "Most Deaths" })).toBeTruthy();
    expect(router.state.location.search).toBe("?population=all");
  });

  it("renders one event panel with accessible navigation and moves focus on direct load", async () => {
    const { fetchMock } = renderPath("/stats/most-deaths?population=all");

    const heading = await screen.findByRole("heading", { level: 1, name: "Most Deaths" });
    await screen.findByText("No recorded deaths for this population yet.");
    expect(screen.getAllByRole("heading", { level: 1 })).toHaveLength(1);
    expect(screen.queryByRole("heading", { level: 2, name: "Most Deaths" })).toBeNull();
    expect(screen.getByRole("navigation", { name: "Breadcrumb" })).toBeTruthy();
    expect(screen.getByRole("navigation", { name: "Statistics" })).toBeTruthy();
    expect(screen.getByRole("link", { name: /Most Deaths/u, current: "page" })).toBeTruthy();
    expect(screen.getByRole<HTMLInputElement>("radio", { name: "Players + bots" }).checked).toBe(true);
    await waitFor(() => expect(document.activeElement).toBe(heading));
    expect(fetchMock.mock.calls.filter(([input]) => pathOf(input).startsWith("/api/stats/"))).toHaveLength(1);
  });

  it("explains fixed populations and handles unknown slugs without leaderboard requests", async () => {
    const fixed = renderPath("/stats/vendor-trash-magnate?population=all");
    expect(await screen.findByRole("heading", { level: 1, name: "Vendor Trash Magnate" })).toBeTruthy();
    await screen.findByText("No current characters have recorded vendor earnings yet.");
    expect(screen.getAllByText("All current characters").length).toBeGreaterThan(0);
    expect(screen.queryByRole("radio", { name: "Players + bots" })).toBeNull();
    expect(fixed.fetchMock.mock.calls.filter(([input]) => pathOf(input).startsWith("/api/stats/"))).toHaveLength(1);
    fixed.unmount();
    fixed.router.dispose();

    const unknown = renderPath("/stats/not-real?population=players");
    expect(screen.getByRole("heading", { level: 1, name: "Statistic not found" })).toBeTruthy();
    expect(screen.getByRole("link", { name: "Browse all stats" })).toBeTruthy();
    expect(unknown.fetchMock.mock.calls.filter(([input]) => pathOf(input).startsWith("/api/stats/"))).toHaveLength(0);
  });
});
