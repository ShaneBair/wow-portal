import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createMemoryRouter, RouterProvider } from "react-router";
import { parseBotWranglerResponse } from "../api/bot-wrangler.js";
import { StatsPage } from "../pages/StatsPage.js";
import { BotWranglerPanel } from "./BotWranglerPanel.js";

const entry = {
  characterName: "Thalgrim", race: "Dwarf", class: "Paladin", level: 80,
  accountLogin: "SHANE", botKills: 12, uniqueBotVictims: 4,
  lastBotKillAt: "2026-09-28T18:30:00.000Z"
};

function response(overrides: Record<string, unknown> = {}) {
  return {
    generatedAt: "2026-09-29T18:00:00.000Z",
    population: "human-vs-bot",
    coverage: { firstRecordedAt: "2026-09-01T12:00:00.000Z" },
    count: 1,
    entries: [entry],
    ...overrides
  };
}

function renderPanel(fetchBotWrangler: typeof fetch) {
  vi.stubGlobal("fetch", vi.fn<typeof fetch>((input, init) => {
    const path = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
    if (path === "/api/status") {
      return Promise.resolve(new Response(JSON.stringify({ online: true }), { status: 200 }));
    }
    return fetchBotWrangler(input, init);
  }));
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: Infinity } } });
  const router = createMemoryRouter(
    [{ path: "/stats", element: <StatsPage><BotWranglerPanel /></StatsPage> }],
    { initialEntries: ["/stats?population=players"] }
  );
  return render(<QueryClientProvider client={client}><RouterProvider router={router} /></QueryClientProvider>);
}

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("Bot Wrangler panel", () => {
  it("shows fixed semantics, safe killer fields, counts, latest kill, and sorting", async () => {
    const fetchMock = vi.fn<typeof fetch>(() => Promise.resolve(new Response(JSON.stringify(response()), {
      status: 200, headers: { "Content-Type": "application/json" }
    })));
    renderPanel(fetchMock);
    expect(await screen.findByRole("heading", { name: "Bot Wrangler" })).toBeTruthy();
    expect(await screen.findByText("Thalgrim")).toBeTruthy();
    expect(screen.getByText("Human killers • Bot victims.")).toBeTruthy();
    expect(screen.getByText(/authoritative session flag/u)).toBeTruthy();
    expect(screen.getByText(/Players\/All selector does not change this board/u)).toBeTruthy();
    expect(within(screen.getByRole("table")).getAllByRole("cell").map((cell) => cell.textContent)).toEqual([
      "Thalgrim", "Dwarf", "Paladin", "80", "SHANE", "12", "4", "Sep 28, 2026, 2:30 PM"
    ]);
    await userEvent.setup().click(screen.getByRole("button", { name: /Sort by Bot kills/u }));
    expect(screen.getByRole("columnheader", { name: /Bot kills/u }).getAttribute("aria-sort")).toBe("descending");
    expect(JSON.stringify(response())).not.toMatch(/victimGuid|victimAccount|victimName/u);

    await userEvent.setup().click(screen.getByRole("radio", { name: "Players + bots" }));
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0]?.[0]).toBe("/api/stats/bot-wrangler");
  });

  it("renders loading, empty, unavailable, and retry states", async () => {
    const pending = renderPanel(vi.fn<typeof fetch>(() => new Promise(() => undefined)));
    expect(screen.getByText("Loading Bot Wrangler statistics...")).toBeTruthy();
    pending.unmount();

    const empty = renderPanel(vi.fn<typeof fetch>(() => Promise.resolve(new Response(JSON.stringify(response({
      coverage: { firstRecordedAt: null }, count: 0, entries: []
    })), { status: 200 }))));
    expect(await screen.findByText(/No recorded human-versus-bot PvP kills/u)).toBeTruthy();
    empty.unmount();

    const fetchMock = vi.fn<typeof fetch>()
      .mockResolvedValueOnce(new Response("{}", { status: 503 }))
      .mockResolvedValueOnce(new Response(JSON.stringify(response()), { status: 200 }));
    renderPanel(fetchMock);
    expect(await screen.findByText("Bot Wrangler statistics are temporarily unavailable.")).toBeTruthy();
    await userEvent.setup().click(screen.getByRole("button", { name: "Retry" }));
    expect(await screen.findByText("Thalgrim")).toBeTruthy();
  });

  it("rejects malformed public responses and victim-shaped additions do not enter the model", () => {
    expect(() => parseBotWranglerResponse(response({
      entries: [{ ...entry, botKills: 2, uniqueBotVictims: 3 }]
    }))).toThrow(/temporarily unavailable/u);
    expect(() => parseBotWranglerResponse(response({
      population: "players"
    }))).toThrow(/temporarily unavailable/u);
    expect(() => parseBotWranglerResponse(response({
      coverage: { firstRecordedAt: null }
    }))).toThrow(/temporarily unavailable/u);
    const parsed = parseBotWranglerResponse(response({
      entries: [{ ...entry, victimGuid: 44, victimAccountId: 55 }]
    }));
    expect(parsed.entries[0]).toEqual(entry);
  });
});
