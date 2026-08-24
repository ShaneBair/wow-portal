import { DocumentTitle } from "../components/DocumentTitle.js";

export function StatsPage() {
  return (
    <main>
      <DocumentTitle>Stats | DaBoysZeroth</DocumentTitle>
      <header className="hero">
        <div>
          <p className="eyebrow">SERVER STATISTICS</p>
          <h1>Stats</h1>
          <p className="lede">Server activity and trends will have a dedicated home here.</p>
        </div>
      </header>

      <section className="panel route-placeholder stats-empty-state" aria-label="Statistics availability">
        <p>Statistics are coming next.</p>
      </section>
    </main>
  );
}
