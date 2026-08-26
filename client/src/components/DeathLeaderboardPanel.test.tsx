import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { createMemoryRouter, RouterProvider } from "react-router";
import { afterEach, describe, expect, it, vi } from "vitest";
import { StatsPage } from "../pages/StatsPage.js";

interface Deferred<T> {
  promise: Promise<T>;
  resolve: (value: T) => void;
}

type FetchMock = ReturnType<typeof vi.fn<typeof fetch>>;

const entries = [
  {
    characterName: "Zara",
    race: "Human",
    class: "Mage",
    level: 80,
    accountLogin: "ZED",
    isBot: false,
    deaths: 20
  },
  {
    characterName: "Alpha",
    race: "Dwarf",
    class: "Paladin",
    level: 42,
    accountLogin: "SHANE",
    isBot: true,
    deaths: 14
  },
  {
    characterName: "Beta",
    race: "Dwarf",
    class: "Warrior",
    level: 30,
    accountLogin: "BETA",
    isBot: false,
    deaths: 14
  }
];

function createDeferred<T>(): Deferred<T> {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((resolvePromise) => {
    resolve = resolvePromise;
  });
  return { promise, resolve };
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" }
  });
}

function leaderboard(
  population: "players" | "all" = "players",
  resultEntries: typeof entries = entries
) {
  return {
    generatedAt: "2026-08-24T16:00:00.000Z",
    population,
    coverage: {
      comprehensiveSince: "2026-08-25T14:30:00.000Z"
    },
    count: resultEntries.length,
    entries: resultEntries
  };
}

function renderPanel(path = "/stats?population=players") {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: {
        gcTime: Infinity,
        refetchOnWindowFocus: false,
        retry: false
      }
    }
  });
  const router = createMemoryRouter(
    [{ path: "/stats", element: <StatsPage /> }],
    { initialEntries: [path] }
  );
  const result = render(
    <QueryClientProvider client={queryClient}>
      <RouterProvider router={router} />
    </QueryClientProvider>
  );
  return { ...result, queryClient, router };
}

function installFetch(implementation: typeof fetch): FetchMock {
  const mock = vi.fn<typeof fetch>(implementation);
  vi.stubGlobal("fetch", mock);
  return mock;
}

function requestUrl(input: RequestInfo | URL): string {
  if (typeof input === "string") {
    return input;
  }
  return input instanceof URL ? input.toString() : input.url;
}

function characterOrder(): string[] {
  const table = screen.getByRole("table");
  return within(table).getAllByRole("row").slice(1).map((row) =>
    within(row).getAllByRole("cell")[0]?.textContent ?? ""
  );
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("death leaderboard states and requests", () => {
  it("shows the loading state", () => {
    const deferred = createDeferred<Response>();
    installFetch(() => deferred.promise);
    renderPanel();

    expect(screen.getByText("Loading death statistics...")).toBeTruthy();
    expect(screen.queryByText(/Known creature and PvP deaths before/u)).toBeNull();
  });

  it("shows the empty state", async () => {
    installFetch(() => Promise.resolve(jsonResponse(leaderboard("players", []))));
    renderPanel();

    expect(await screen.findByText("No recorded deaths for this population yet.")).toBeTruthy();
    expect(screen.queryByRole("table")).toBeNull();
  });

  it("shows unavailable for HTTP and runtime-validation failures", async () => {
    installFetch(() => Promise.resolve(jsonResponse({
      ...leaderboard(),
      count: 99,
      internalDatabase: "acore_characters"
    })));
    renderPanel();

    expect(await screen.findByText("Death statistics are temporarily unavailable.")).toBeTruthy();
    expect(screen.queryByRole("table")).toBeNull();
  });

  it("shows unavailable when coverage is missing or malformed", async () => {
    installFetch(() => Promise.resolve(jsonResponse({
      ...leaderboard(),
      coverage: { comprehensiveSince: "not-a-timestamp" }
    })));
    renderPanel();

    expect(await screen.findByText("Death statistics are temporarily unavailable.")).toBeTruthy();
    expect(document.querySelector("time")).toBeNull();
  });

  it("shows unavailable when the API returns 503", async () => {
    installFetch(() => Promise.resolve(jsonResponse({
      error: "Death statistics are temporarily unavailable."
    }, 503)));
    renderPanel();

    expect(await screen.findByText("Death statistics are temporarily unavailable.")).toBeTruthy();
    expect(screen.getByRole("radio", { name: "Players only" })).toBeTruthy();
  });

  it("uses the normalized population in the URL and population-specific query key", async () => {
    const fetchMock = installFetch((input) => {
      const url = requestUrl(input);
      const population = url.includes("population=all") ? "all" : "players";
      return Promise.resolve(jsonResponse(leaderboard(population, [])));
    });
    const { queryClient } = renderPanel("/stats?population=all");

    await screen.findByText("No recorded deaths for this population yet.");
    expect(requestUrl(fetchMock.mock.calls[0]?.[0] as RequestInfo)).toBe(
      "/api/stats/deaths?population=all"
    );
    expect(queryClient.getQueryCache().getAll().map((query) => query.queryKey)).toEqual([
      ["stats", "deaths", "all"]
    ]);
  });

  it("does not show previous-population rows while a new population loads", async () => {
    const allDeferred = createDeferred<Response>();
    const fetchMock = installFetch((input) => {
      const url = requestUrl(input);
      return url.includes("population=all")
        ? allDeferred.promise
        : Promise.resolve(jsonResponse(leaderboard("players", [entries[0]!])));
    });
    const user = userEvent.setup();
    const { queryClient } = renderPanel();

    expect(await screen.findByRole("cell", { name: "Zara" })).toBeTruthy();
    await user.click(screen.getByRole("radio", { name: "Players + bots" }));

    expect(await screen.findByText("Loading death statistics...")).toBeTruthy();
    expect(screen.queryByText("Zara")).toBeNull();
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(queryClient.getQueryCache().getAll().map((query) => query.queryKey)).toEqual([
      ["stats", "deaths", "players"],
      ["stats", "deaths", "all"]
    ]);

    allDeferred.resolve(jsonResponse(leaderboard("all", [entries[1]!])));
    expect(await screen.findByRole("cell", { name: "Alpha" })).toBeTruthy();
  });

  it("passes an abort signal into fetch for obsolete requests", async () => {
    let playersSignal: AbortSignal | null | undefined;
    installFetch((input, init) => {
      const url = requestUrl(input);
      if (url.includes("population=players")) {
        playersSignal = init?.signal;
        return new Promise<Response>(() => undefined);
      }
      return Promise.resolve(jsonResponse(leaderboard("all", [])));
    });
    const user = userEvent.setup();
    renderPanel();
    await waitFor(() => expect(playersSignal).toBeInstanceOf(AbortSignal));

    await user.click(screen.getByRole("radio", { name: "Players + bots" }));

    await screen.findByText("No recorded deaths for this population yet.");
    expect(playersSignal?.aborted).toBe(true);
  });
});

describe("death leaderboard table", () => {
  it("preserves server order and renders all public columns and control labels", async () => {
    installFetch(() => Promise.resolve(jsonResponse(leaderboard())));
    renderPanel();

    await screen.findByRole("table");
    const coverageTime = document.querySelector("time");
    expect(coverageTime?.getAttribute("datetime")).toBe("2026-08-25T14:30:00.000Z");
    expect(document.querySelector(".deaths-scope")?.textContent).toContain(
      "all recorded deaths since then, including environmental deaths."
    );
    expect(characterOrder()).toEqual(["Zara", "Alpha", "Beta"]);
    expect(screen.getAllByText("Player")).toHaveLength(2);
    expect(screen.getByText("Bot")).toBeTruthy();
    expect(screen.getByText("Showing up to 25 highest recorded death totals. Column sorting reorders these results.")).toBeTruthy();
    expect(screen.getAllByRole("columnheader").map((header) => header.textContent)).toEqual([
      "Character↕", "Race↕", "Class↕", "Level↕", "Account↕", "Type↕", "Deaths↕"
    ]);
  });

  it("sorts locally through accessible header buttons and exposes aria-sort", async () => {
    installFetch(() => Promise.resolve(jsonResponse(leaderboard())));
    const user = userEvent.setup();
    renderPanel();
    await screen.findByRole("table");

    const characterButton = screen.getByRole("button", {
      name: "Sort by Character, currently unsorted"
    });
    expect(characterButton.closest("th")?.hasAttribute("aria-sort")).toBe(false);

    await user.click(characterButton);
    expect(characterOrder()).toEqual(["Alpha", "Beta", "Zara"]);
    expect(screen.getByRole("button", {
      name: "Sort by Character, currently ascending"
    }).closest("th")?.getAttribute("aria-sort")).toBe("ascending");

    await user.click(screen.getByRole("button", {
      name: "Sort by Character, currently ascending"
    }));
    expect(characterOrder()).toEqual(["Zara", "Beta", "Alpha"]);
    expect(screen.getByRole("button", {
      name: "Sort by Character, currently descending"
    }).closest("th")?.getAttribute("aria-sort")).toBe("descending");
  });

  it("uses deterministic visible-value tie breakers", async () => {
    installFetch(() => Promise.resolve(jsonResponse(leaderboard())));
    const user = userEvent.setup();
    renderPanel();
    await screen.findByRole("table");

    await user.click(screen.getByRole("button", { name: "Sort by Race, currently unsorted" }));
    expect(characterOrder()).toEqual(["Alpha", "Beta", "Zara"]);
  });

  it("includes responsive cell labels and renders API strings as text", async () => {
    const malicious = "<img src=x onerror=alert(1)>";
    installFetch(() => Promise.resolve(jsonResponse(leaderboard("players", [{
      ...entries[0]!,
      characterName: malicious,
      accountLogin: "<script>alert(1)</script>"
    }]))));
    renderPanel();

    const characterCell = await screen.findByRole("cell", { name: malicious });
    expect(characterCell.getAttribute("data-label")).toBe("Character");
    const row = characterCell.closest("tr");
    expect(row).not.toBeNull();
    expect(within(row as HTMLTableRowElement).getAllByRole("cell").map((cell) =>
      cell.getAttribute("data-label")
    )).toEqual(["Character", "Race", "Class", "Level", "Account", "Type", "Deaths"]);
    expect(document.querySelector("img")).toBeNull();
    expect(document.querySelector("script")).toBeNull();
  });
});
