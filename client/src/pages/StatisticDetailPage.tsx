import { Component, Suspense, useEffect, useRef, type ErrorInfo, type ReactNode } from "react";
import { Link, useNavigate, useParams } from "react-router";
import { DocumentTitle } from "../components/DocumentTitle.js";
import { ServerStatus } from "../components/ServerStatus.js";
import { StatsPopulationFilter } from "../components/StatsPopulationFilter.js";
import { useStatsPopulationContext } from "../stats/stats-population.js";
import {
  getStatistic,
  getStatisticCategory,
  ORDERED_STATISTICS,
  STATISTIC_CATEGORIES,
  type StatisticCategoryId
} from "../stats/statistics-catalog.js";

class StatisticChunkBoundary extends Component<{ children: ReactNode; browseHref: string }, { failed: boolean }> {
  state = { failed: false };

  static getDerivedStateFromError() {
    return { failed: true };
  }

  componentDidCatch(_error: Error, _info: ErrorInfo) {
    // The user-facing state intentionally avoids exposing chunk or host details.
  }

  render() {
    if (this.state.failed) {
      return <section className="panel stats-chunk-error" role="status">
        <h2>Statistic unavailable</h2>
        <p>This statistic could not be loaded. Try loading it again.</p>
        <div className="stats-no-results-actions">
          <button type="button" onClick={() => window.location.reload()}>Retry</button>
          <Link to={this.props.browseHref}>Browse all stats</Link>
        </div>
      </section>;
    }
    return this.props.children;
  }
}

export function StatisticDetailPage() {
  const { statSlug } = useParams();
  const navigate = useNavigate();
  const { population } = useStatsPopulationContext();
  const statistic = getStatistic(statSlug);
  const headingRef = useRef<HTMLHeadingElement>(null);

  useEffect(() => {
    headingRef.current?.focus({ preventScroll: false });
  }, [statSlug]);

  const hrefFor = (slug: string) => `/stats/${slug}?population=${population}`;
  const browseHref = `/stats?population=${population}`;

  if (!statistic) {
    return <main>
      <DocumentTitle>Statistic not found | DaBoysZeroth</DocumentTitle>
      <header className="hero stats-detail-hero">
        <div>
          <p className="eyebrow">SERVER STATISTICS</p>
          <h1 ref={headingRef} tabIndex={-1}>Statistic not found</h1>
          <p className="lede">That statistics page does not exist.</p>
        </div>
        <ServerStatus />
      </header>
      <section className="panel stats-not-found">
        <p>Check the address or return to the statistics directory.</p>
        <Link to={browseHref}>Browse all stats</Link>
      </section>
    </main>;
  }

  const category = getStatisticCategory(statistic.category);
  const categoryStatistics = ORDERED_STATISTICS.filter((candidate) => candidate.category === statistic.category);
  const selectedIndex = ORDERED_STATISTICS.findIndex((candidate) => candidate.slug === statistic.slug);
  const previous = ORDERED_STATISTICS[selectedIndex - 1];
  const next = ORDERED_STATISTICS[selectedIndex + 1];
  const Panel = statistic.component;

  const navigateToCategory = (categoryId: StatisticCategoryId) => {
    const first = ORDERED_STATISTICS.find((candidate) => candidate.category === categoryId);
    if (first) navigate(hrefFor(first.slug));
  };

  return <main>
    <DocumentTitle>{`${statistic.title} | Stats | DaBoysZeroth`}</DocumentTitle>
    <nav className="stats-breadcrumbs" aria-label="Breadcrumb">
      <ol>
        <li><Link to={browseHref}>Stats</Link></li>
        <li><Link to={`/stats?category=${category.id}&population=${population}`}>{category.label}</Link></li>
        <li aria-current="page">{statistic.title}</li>
      </ol>
    </nav>
    <header className="hero stats-detail-hero">
      <div>
        <p className="eyebrow">{category.label}</p>
        <h1 ref={headingRef} tabIndex={-1}>{statistic.title}</h1>
        <p className="lede">{statistic.shortDescription}</p>
      </div>
      <ServerStatus />
    </header>

    <div className="stats-detail-toolbar">
      {statistic.populationMode === "event" && <StatsPopulationFilter />}
      {statistic.populationMode === "all-characters" && <section className="panel stats-fixed-population" aria-label="Statistics population">
        <strong>All current characters</strong>
        <span>Cumulative character counters cannot be split historically.</span>
      </section>}
      {statistic.populationMode === "human-vs-bot" && <section className="panel stats-fixed-population" aria-label="Statistics population">
        <strong>Human killers • Bot victims</strong>
        <span>This statistic always uses its fixed matchup.</span>
      </section>}
    </div>

    <div className="statistics-mobile-switcher panel" aria-label="Statistics navigation controls">
      <label htmlFor="statisticsCategorySelect">Category</label>
      <select id="statisticsCategorySelect" value={statistic.category}
        onChange={(event) => navigateToCategory(event.currentTarget.value as StatisticCategoryId)}>
        {STATISTIC_CATEGORIES.map((candidate) => <option key={candidate.id} value={candidate.id}>{candidate.label}</option>)}
      </select>
      <label htmlFor="statisticsSelect">Statistic</label>
      <select id="statisticsSelect" value={statistic.slug}
        onChange={(event) => navigate(hrefFor(event.currentTarget.value))}>
        {categoryStatistics.map((candidate) => <option key={candidate.slug} value={candidate.slug}>{candidate.title}</option>)}
      </select>
    </div>

    <div className="stats-detail-layout">
      <nav className="statistics-rail" aria-label="Statistics">
        {STATISTIC_CATEGORIES.map((candidate) => {
          const entries = ORDERED_STATISTICS.filter((entry) => entry.category === candidate.id);
          if (entries.length === 0) return null;
          return <section key={candidate.id} className="statistics-rail-group">
            <h2>{candidate.label}</h2>
            <ul>{entries.map((entry) => <li key={entry.slug}>
              <Link to={hrefFor(entry.slug)} aria-current={entry.slug === statistic.slug ? "page" : undefined}>
                {entry.title}
              </Link>
            </li>)}</ul>
          </section>;
        })}
      </nav>

      <div className="statistic-panel-region">
        <StatisticChunkBoundary key={statistic.slug} browseHref={browseHref}>
          <Suspense fallback={<section className="panel" role="status"><p>Loading statistic...</p></section>}>
            <Panel showHeading={false} />
          </Suspense>
        </StatisticChunkBoundary>
      </div>
    </div>

    <nav className="stats-detail-footer-nav" aria-label="Adjacent statistics">
      <div>{previous && <Link to={hrefFor(previous.slug)}>← Previous: {previous.title}</Link>}</div>
      <Link to={browseHref}>Browse all stats</Link>
      <div>{next && <Link to={hrefFor(next.slug)}>Next: {next.title} →</Link>}</div>
    </nav>
  </main>;
}
