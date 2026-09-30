import { useEffect, useMemo, useState } from "react";
import { Link, useSearchParams } from "react-router";
import { DocumentTitle } from "../components/DocumentTitle.js";
import { ServerStatus } from "../components/ServerStatus.js";
import { useStatsPopulationContext } from "../stats/stats-population.js";
import {
  getStatisticCategory,
  ORDERED_STATISTICS,
  STATISTIC_CATEGORIES,
  type StatisticCategoryId
} from "../stats/statistics-catalog.js";

const MAX_SEARCH_LENGTH = 80;

function normalizeSearch(value: string): string {
  return Array.from(value.trim()).slice(0, MAX_SEARCH_LENGTH).join("");
}

function isCategory(value: string): value is StatisticCategoryId {
  return STATISTIC_CATEGORIES.some((category) => category.id === value);
}

export function StatsHub() {
  const { population } = useStatsPopulationContext();
  const [searchParams, setSearchParams] = useSearchParams();
  const serializedSearchParams = searchParams.toString();
  const categoryValues = searchParams.getAll("category");
  const queryValues = searchParams.getAll("q");
  const category: StatisticCategoryId | undefined = categoryValues.length === 1 && isCategory(categoryValues[0] ?? "")
    ? categoryValues[0] as StatisticCategoryId
    : undefined;
  const query = queryValues.length === 1 ? normalizeSearch(queryValues[0] ?? "") : "";
  const [announcement, setAnnouncement] = useState("");
  const [searchInput, setSearchInput] = useState(query);

  useEffect(() => {
    const canonical = new URLSearchParams(serializedSearchParams);
    canonical.delete("category");
    canonical.delete("q");
    canonical.delete("population");
    if (category) canonical.set("category", category);
    if (query) canonical.set("q", query);
    canonical.set("population", population);
    if (canonical.toString() !== serializedSearchParams) {
      setSearchParams(canonical, { replace: true });
    }
  }, [category, population, query, serializedSearchParams, setSearchParams]);

  useEffect(() => {
    if (normalizeSearch(searchInput) !== query) setSearchInput(query);
  }, [query, searchInput]);

  const visibleStatistics = useMemo(() => {
    const searchNeedle = query.toLocaleLowerCase();
    return ORDERED_STATISTICS.filter((statistic) => {
      if (category && statistic.category !== category) return false;
      if (!searchNeedle) return true;
      const categoryLabel = getStatisticCategory(statistic.category).label;
      return [statistic.title, statistic.shortDescription, categoryLabel, ...statistic.keywords]
        .some((value) => value.toLocaleLowerCase().includes(searchNeedle));
    });
  }, [category, query]);

  const summary = query
    ? `${visibleStatistics.length} ${visibleStatistics.length === 1 ? "result" : "results"} for ‘${query}’`
    : `${visibleStatistics.length} ${visibleStatistics.length === 1 ? "statistic" : "statistics"}`;

  useEffect(() => {
    const timeout = window.setTimeout(() => setAnnouncement(summary), 250);
    return () => window.clearTimeout(timeout);
  }, [summary]);

  const updateFilters = (nextCategory: StatisticCategoryId | undefined, nextQuery: string) => {
    const updated = new URLSearchParams(serializedSearchParams);
    updated.delete("category");
    updated.delete("q");
    updated.delete("population");
    if (nextCategory) updated.set("category", nextCategory);
    const normalizedQuery = normalizeSearch(nextQuery);
    if (normalizedQuery) updated.set("q", normalizedQuery);
    updated.set("population", population);
    setSearchParams(updated, { replace: true });
  };

  const visibleCategories = STATISTIC_CATEGORIES.filter((candidate) =>
    ORDERED_STATISTICS.some((statistic) => statistic.category === candidate.id)
  );

  return <main>
    <DocumentTitle>Stats | DaBoysZeroth</DocumentTitle>
    <header className="hero stats-hub-hero">
      <div>
        <p className="eyebrow">SERVER STATISTICS</p>
        <h1>Stats</h1>
        <p className="lede">Browse the records, milestones, and mishaps that tell our server&apos;s story.</p>
      </div>
      <ServerStatus />
    </header>

    <section className="panel stats-hub-controls" aria-label="Find statistics">
      <div className="stats-search-row">
        <label htmlFor="statsSearch">Search statistics</label>
        <div className="stats-search-field">
          <input
            id="statsSearch"
            type="search"
            maxLength={MAX_SEARCH_LENGTH * 2}
            value={searchInput}
            onChange={(event) => {
              const nextInput = Array.from(event.currentTarget.value).slice(0, MAX_SEARCH_LENGTH).join("");
              setSearchInput(nextInput);
              updateFilters(category, nextInput);
            }}
          />
          <button type="button" onClick={() => { setSearchInput(""); updateFilters(category, ""); }} disabled={!query}
            aria-label="Clear statistics search">Clear</button>
        </div>
      </div>
      <div className="stats-category-controls" aria-label="Statistic categories">
        <button type="button" aria-pressed={!category} onClick={() => updateFilters(undefined, query)}>All</button>
        {visibleCategories.map((candidate) => <button key={candidate.id} type="button"
          aria-pressed={category === candidate.id}
          onClick={() => updateFilters(candidate.id, query)}>{candidate.label}</button>)}
      </div>
    </section>

    <p className="stats-results-summary">{summary}</p>
    <p className="visually-hidden" aria-live="polite" aria-atomic="true">{announcement}</p>

    {visibleStatistics.length === 0
      ? <section className="panel stats-no-results" aria-labelledby="statsNoResultsHeading">
          <h2 id="statsNoResultsHeading">No statistics found</h2>
          <p>Try a different search or browse every category.</p>
          <div className="stats-no-results-actions">
            <button type="button" onClick={() => { setSearchInput(""); updateFilters(category, ""); }} disabled={!query}>Clear search</button>
            <button type="button" onClick={() => updateFilters(undefined, query)} disabled={!category}>Show all categories</button>
          </div>
        </section>
      : <div className="statistics-directory">
          {visibleCategories.map((candidate) => {
            const entries = visibleStatistics.filter((statistic) => statistic.category === candidate.id);
            if (entries.length === 0) return null;
            return <section key={candidate.id} className="statistics-category" aria-labelledby={`category-${candidate.id}`}>
              <h2 id={`category-${candidate.id}`}>{candidate.label}</h2>
              <div className="statistics-grid">
                {entries.map((statistic) => <Link key={statistic.slug} className="statistic-tile"
                  to={`/stats/${statistic.slug}?population=${population}`}>
                  <span className="statistic-tile-icon" aria-hidden="true">{statistic.icon}</span>
                  <span className="statistic-tile-copy">
                    <span className="statistic-tile-category">{candidate.label}</span>
                    <span className="statistic-tile-title">{statistic.title}</span>
                    <span className="statistic-tile-description">{statistic.shortDescription}</span>
                  </span>
                </Link>)}
              </div>
            </section>;
          })}
        </div>}
  </main>;
}
