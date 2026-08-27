import { QueryClient, QueryClientProvider, useQuery } from "@tanstack/react-query";
import { act, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ReactNode } from "react";
import {
  createMemoryRouter,
  RouterProvider
} from "react-router";
import { describe, expect, it } from "vitest";
import { StatsPage } from "../pages/StatsPage.js";
import {
  statsPopulationQueryKey,
  useStatsPopulationContext,
  type StatsPopulation
} from "./stats-population.js";

interface Deferred<T> {
  promise: Promise<T>;
  resolve: (value: T) => void;
}

type TestRouter = ReturnType<typeof createMemoryRouter>;
type PanelLoader = (population: StatsPopulation, signal: AbortSignal) => Promise<string>;

function createDeferred<T>(): Deferred<T> {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((resolvePromise) => {
    resolve = resolvePromise;
  });
  return { promise, resolve };
}

function renderStats(path: string, children: ReactNode = <></>) {
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
    [{ path: "/stats", element: <StatsPage>{children}</StatsPage> }],
    { initialEntries: [path] }
  );

  const result = render(
    <QueryClientProvider client={queryClient}>
      <RouterProvider router={router} />
    </QueryClientProvider>
  );

  return { ...result, queryClient, router };
}

function getLocationParams(router: TestRouter): URLSearchParams {
  return new URLSearchParams(router.state.location.search);
}

function expectSelectedPopulation(population: StatsPopulation) {
  const players = screen.getByRole<HTMLInputElement>("radio", { name: "Players only" });
  const all = screen.getByRole<HTMLInputElement>("radio", { name: "Players + bots" });
  expect(players.checked).toBe(population === "players");
  expect(all.checked).toBe(population === "all");
}

function PopulationConsumer() {
  const { population } = useStatsPopulationContext();
  return <output aria-label="Effective population">{population}</output>;
}

function QueryPanel({ name, load }: { name: string; load: PanelLoader }) {
  const { population } = useStatsPopulationContext();
  const query = useQuery({
    queryKey: statsPopulationQueryKey(name, population),
    queryFn: ({ signal }) => load(population, signal),
    retry: false
  });

  return (
    <section aria-label={name}>
      <span>{`Selected ${population}`}</span>
      {query.isPending && <span>{`Loading ${population}`}</span>}
      {query.isError && <span>{`Error ${population}`}</span>}
      {query.data && <span>{query.data}</span>}
    </section>
  );
}

describe("Stats population URL contract", () => {
  it.each([
    { path: "/stats", expected: "players" as const },
    { path: "/stats?population=players", expected: "players" as const },
    { path: "/stats?population=all", expected: "all" as const },
    { path: "/stats?population=invalid", expected: "players" as const },
    { path: "/stats?population=players&population=all", expected: "players" as const }
  ])("initializes $path as $expected", async ({ path, expected }) => {
    const { router } = renderStats(path, <PopulationConsumer />);

    expectSelectedPopulation(expected);
    expect(screen.getByLabelText("Effective population").textContent).toBe(expected);
    await waitFor(() => {
      expect(getLocationParams(router).getAll("population")).toEqual([expected]);
    });
  });

  it("normalizes repeated or invalid input with replacement and preserves unrelated values", async () => {
    const { router } = renderStats(
      "/stats?tag=first&population=invalid&tag=second&population=all&view=grid"
    );

    await waitFor(() => {
      expect(getLocationParams(router).getAll("population")).toEqual(["players"]);
    });
    const params = getLocationParams(router);
    expect(params.getAll("tag")).toEqual(["first", "second"]);
    expect(params.get("view")).toBe("grid");
    expect(router.state.historyAction).toBe("REPLACE");
  });

  it("pushes user changes, preserves focus and unrelated parameters, and follows history", async () => {
    const user = userEvent.setup();
    const { router } = renderStats("/stats?population=players&view=grid");
    const allOption = screen.getByRole<HTMLInputElement>("radio", { name: "Players + bots" });

    await user.click(allOption);
    await waitFor(() => expect(getLocationParams(router).get("population")).toBe("all"));
    expect(getLocationParams(router).get("view")).toBe("grid");
    expect(router.state.historyAction).toBe("PUSH");
    expectSelectedPopulation("all");
    expect(document.activeElement).toBe(allOption);

    await act(async () => {
      await router.navigate(-1);
    });
    expectSelectedPopulation("players");
    expect(getLocationParams(router).get("view")).toBe("grid");

    await act(async () => {
      await router.navigate(1);
    });
    expectSelectedPopulation("all");
    expect(getLocationParams(router).get("view")).toBe("grid");
  });

  it("uses native radio keyboard interaction", async () => {
    const user = userEvent.setup();
    const { router } = renderStats("/stats?population=players");
    const playersOption = screen.getByRole<HTMLInputElement>("radio", { name: "Players only" });

    playersOption.focus();
    await user.keyboard("{ArrowRight}");

    expectSelectedPopulation("all");
    await waitFor(() => expect(getLocationParams(router).get("population")).toBe("all"));
    expect(document.activeElement).toBe(
      screen.getByRole<HTMLInputElement>("radio", { name: "Players + bots" })
    );
  });

  it("has an accessible group label and helper description", () => {
    renderStats("/stats?population=players");

    const group = screen.getByRole("group", { name: "Show" });
    const playersOption = screen.getByRole("radio", { name: "Players only" });
    const allOption = screen.getByRole("radio", { name: "Players + bots" });
    expect(group.contains(playersOption)).toBe(true);
    expect(group.contains(allOption)).toBe(true);
    expect(group.getAttribute("aria-describedby")).toBe("statsPopulationHelp");
    expect(screen.getByText("Players + bots includes Playerbot-controlled activity.")).toBeTruthy();
  });
});

describe("Stats population query contract", () => {
  it("creates distinct population-specific query keys", () => {
    expect(statsPopulationQueryKey("deaths", "players")).toEqual(["stats", "deaths", "players"]);
    expect(statsPopulationQueryKey("deaths", "all")).toEqual(["stats", "deaths", "all"]);
  });

  it("passes the effective value to consumers and does not retain previous results during a change", async () => {
    const allResult = createDeferred<string>();
    const calls: Array<{ population: StatsPopulation; signal: AbortSignal }> = [];
    const load: PanelLoader = (population, signal) => {
      calls.push({ population, signal });
      return population === "players"
        ? Promise.resolve("Players result")
        : allResult.promise;
    };
    const user = userEvent.setup();
    const { queryClient } = renderStats(
      "/stats?population=players",
      <QueryPanel name="deaths" load={load} />
    );

    expect(await screen.findByText("Players result")).toBeTruthy();
    await user.click(screen.getByRole("radio", { name: "Players + bots" }));

    expect(await screen.findByText("Loading all")).toBeTruthy();
    expect(screen.queryByText("Players result")).toBeNull();
    expect(calls.map((call) => call.population)).toEqual(["players", "all"]);
    expect(calls.every((call) => call.signal instanceof AbortSignal)).toBe(true);
    expect(queryClient.getQueryCache().getAll().map((query) => query.queryKey).filter(
      (key) => key[0] === "stats"
    )).toEqual([
      ["stats", "deaths", "players"],
      ["stats", "deaths", "all"]
    ]);

    allResult.resolve("All activity result");
    expect(await screen.findByText("All activity result")).toBeTruthy();
  });

  it("aborts an obsolete population request when the selection changes", async () => {
    let playersSignal: AbortSignal | undefined;
    const load: PanelLoader = (population, signal) => {
      if (population === "players") {
        playersSignal = signal;
        return new Promise<string>(() => undefined);
      }

      return Promise.resolve("All result");
    };
    const user = userEvent.setup();
    renderStats("/stats?population=players", <QueryPanel name="deaths" load={load} />);
    await waitFor(() => expect(playersSignal).toBeDefined());

    await user.click(screen.getByRole("radio", { name: "Players + bots" }));

    expect(await screen.findByText("All result")).toBeTruthy();
    expect(playersSignal?.aborted).toBe(true);
  });

  it("keeps panels independent when one population request fails", async () => {
    const failingLoad: PanelLoader = async () => {
      throw new Error("Unavailable");
    };
    const successfulLoad: PanelLoader = async (population) => `${population} summary`;
    renderStats(
      "/stats?population=all",
      <>
        <QueryPanel name="failing panel" load={failingLoad} />
        <QueryPanel name="working panel" load={successfulLoad} />
      </>
    );

    expect(await screen.findByText("Error all")).toBeTruthy();
    expect(await screen.findByText("all summary")).toBeTruthy();
    expectSelectedPopulation("all");
  });
});
