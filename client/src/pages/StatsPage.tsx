import { DocumentTitle } from "../components/DocumentTitle.js";

export function StatsPage() {
  return (
    <main>
      <DocumentTitle>Stats | DaBoysZeroth</DocumentTitle>
      <header className="hero">
        <div>
          <p className="eyebrow">SERVER STATISTICS</p>
          <h1>Stats</h1>
          <p className="lede">Statistics features will be added after the React foundation.</p>
        </div>
      </header>

      <section className="panel route-placeholder" aria-label="Statistics availability">
        <p>Statistics are not available yet.</p>
      </section>
    </main>
  );
}
