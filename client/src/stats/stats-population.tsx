import {
  createContext,
  type ReactNode,
  useCallback,
  useContext,
  useEffect,
  useMemo
} from "react";
import { useSearchParams } from "react-router";

export type StatsPopulation = "players" | "all";

const DEFAULT_POPULATION: StatsPopulation = "players";

interface StatsPopulationContextValue {
  population: StatsPopulation;
  setPopulation: (population: StatsPopulation) => void;
}

const StatsPopulationContext = createContext<StatsPopulationContextValue | undefined>(undefined);

function isStatsPopulation(value: string): value is StatsPopulation {
  return value === "players" || value === "all";
}

export function statsPopulationQueryKey<TScope extends string>(
  scope: TScope,
  population: StatsPopulation
) {
  return ["stats", scope, population] as const;
}

export function useStatsPopulation(): StatsPopulationContextValue {
  const [searchParams, setSearchParams] = useSearchParams();
  const serializedSearchParams = searchParams.toString();
  const populationValues = searchParams.getAll("population");
  const isCanonical = populationValues.length === 1 && isStatsPopulation(populationValues[0] ?? "");
  const population: StatsPopulation = isCanonical
    ? populationValues[0] as StatsPopulation
    : DEFAULT_POPULATION;

  useEffect(() => {
    if (isCanonical) {
      return;
    }

    const normalized = new URLSearchParams(serializedSearchParams);
    normalized.delete("population");
    normalized.set("population", DEFAULT_POPULATION);
    setSearchParams(normalized, { replace: true });
  }, [isCanonical, serializedSearchParams, setSearchParams]);

  const updatePopulation = useCallback((nextPopulation: StatsPopulation) => {
    const updated = new URLSearchParams(serializedSearchParams);
    updated.delete("population");
    updated.set("population", nextPopulation);
    setSearchParams(updated);
  }, [serializedSearchParams, setSearchParams]);

  return useMemo(() => ({
    population,
    setPopulation: updatePopulation
  }), [population, updatePopulation]);
}

export function StatsPopulationProvider({ children }: { children: ReactNode }) {
  const value = useStatsPopulation();

  return (
    <StatsPopulationContext.Provider value={value}>
      {children}
    </StatsPopulationContext.Provider>
  );
}

export function useStatsPopulationContext(): StatsPopulationContextValue {
  const value = useContext(StatsPopulationContext);

  if (!value) {
    throw new Error("Stats population context is unavailable.");
  }

  return value;
}
