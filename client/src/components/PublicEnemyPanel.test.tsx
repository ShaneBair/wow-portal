import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createMemoryRouter, RouterProvider } from "react-router";
import { parsePublicEnemyResponse } from "../api/public-enemy.js";
import { StatsPage } from "../pages/StatsPage.js";
import { PublicEnemyPanel } from "./PublicEnemyPanel.js";

function response(population: "players" | "all", overrides: Record<string, unknown> = {}) {
  return {
    generatedAt: "2026-09-29T18:00:00.000Z",
    population,
    coverage: { firstRecordedAt: "2026-09-01T12:00:00.000Z" },
    entries: [
      { creatureEntry: 448, creatureName: "Hogger", kills: 14, directKills: 10, petKills: 4 },
      { creatureEntry: 6, creatureName: "Kobold Vermin", kills: 8, directKills: 3, petKills: 5 }
    ],
    ...overrides
  };
}

function renderPanel(fetchPublicEnemy: typeof fetch) {
  vi.stubGlobal("fetch", vi.fn<typeof fetch>((input, init) => {
    const path = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
    if (path === "/api/status") {
      return Promise.resolve(new Response(JSON.stringify({ online: true }), { status: 200 }));
    }
    return fetchPublicEnemy(input, init);
  }));
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: Infinity } } });
  const router = createMemoryRouter(
    [{ path: "/stats", element: <StatsPage><PublicEnemyPanel /></StatsPage> }],
    { initialEntries: ["/stats?population=players"] }
  );
  return render(<QueryClientProvider client={client}><RouterProvider router={router} /></QueryClientProvider>);
}

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("Public Enemy panel", () => {
  it("shows coverage, direct and pet totals, and accessible sorting", async () => {
    renderPanel(vi.fn<typeof fetch>(() => Promise.resolve(new Response(JSON.stringify(response("players")), {
      status: 200, headers: { "Content-Type": "application/json" }
    }))));
    expect(await screen.findByRole("heading", { name: "Public Enemy #1" })).toBeTruthy();
    expect(await screen.findByText("Hogger")).toBeTruthy();
    expect(screen.getByText(/Recorded killing blows since/u)).toBeTruthy();
    const table = screen.getByRole("table");
    expect(within(table).getAllByRole("cell").map((cell) => cell.textContent)).toEqual([
      "Hogger", "14", "10", "4", "Kobold Vermin", "8", "3", "5"
    ]);
    await userEvent.setup().click(screen.getByRole("button", { name: /Sort by Pet kills/u }));
    expect(within(table).getAllByRole("row")[1]?.textContent).toContain("Kobold Vermin");
    expect(screen.getByRole("columnheader", { name: /Pet kills/u }).getAttribute("aria-sort")).toBe("descending");
  });

  it("renders loading, empty, unavailable, and retry states", async () => {
    const pending = renderPanel(vi.fn<typeof fetch>(() => new Promise(() => undefined)));
    expect(screen.getByText("Loading Public Enemy statistics...")).toBeTruthy();
    pending.unmount();

    const empty = renderPanel(vi.fn<typeof fetch>(() => Promise.resolve(new Response(JSON.stringify(response("players", {
      coverage: { firstRecordedAt: null }, entries: []
    })), { status: 200 }))));
    expect(await screen.findByText(/No recorded creature killing blows/u)).toBeTruthy();
    empty.unmount();

    const fetchMock = vi.fn<typeof fetch>()
      .mockResolvedValueOnce(new Response("{}", { status: 503 }))
      .mockResolvedValueOnce(new Response(JSON.stringify(response("players")), { status: 200 }));
    renderPanel(fetchMock);
    expect(await screen.findByText("Public Enemy statistics are temporarily unavailable.")).toBeTruthy();
    await userEvent.setup().click(screen.getByRole("button", { name: "Retry" }));
    expect(await screen.findByText("Hogger")).toBeTruthy();
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("rejects malformed public responses", () => {
    expect(() => parsePublicEnemyResponse(response("players", {
      entries: [{ creatureEntry: 448, creatureName: "Hogger", kills: 14, directKills: 10, petKills: 3 }]
    }), "players")).toThrow(/temporarily unavailable/u);
    expect(() => parsePublicEnemyResponse(response("players", {
      coverage: { firstRecordedAt: null }
    }), "players")).toThrow(/temporarily unavailable/u);
    expect(() => parsePublicEnemyResponse(response("players"), "all")).toThrow(/temporarily unavailable/u);
  });
});
