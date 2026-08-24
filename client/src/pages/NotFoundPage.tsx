import { Link } from "react-router";
import { DocumentTitle } from "../components/DocumentTitle.js";

export function NotFoundPage() {
  return (
    <main>
      <DocumentTitle>Page Not Found | DaBoysZeroth</DocumentTitle>
      <header className="hero">
        <div>
          <p className="eyebrow">404</p>
          <h1>Page not found</h1>
          <p className="lede">That portal page does not exist.</p>
        </div>
      </header>

      <section className="panel route-placeholder">
        <p><Link to="/">Return home</Link></p>
      </section>
    </main>
  );
}
