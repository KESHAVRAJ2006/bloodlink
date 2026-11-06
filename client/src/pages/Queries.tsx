import { useEffect, useState } from "react";
import { api } from "../lib/api";
import type { DemoQuery, DemoQueryResult } from "../lib/types";

/**
 * The viva page: the MongoDB query on the left, its live result on the right.
 * The query text is sent by the server so what is shown is exactly what runs.
 */
export function Queries() {
  const [queries, setQueries] = useState<DemoQuery[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [result, setResult] = useState<DemoQueryResult | null>(null);
  const [running, setRunning] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api
      .demoQueries()
      .then((data) => {
        setQueries(data.queries);
        if (data.queries.length > 0) setSelectedId(data.queries[0].id);
      })
      .catch((problem) =>
        setError(problem instanceof Error ? problem.message : "Could not load the query list.")
      );
  }, []);

  const selected = queries.find((query) => query.id === selectedId) ?? null;

  async function run() {
    if (!selected) return;
    setRunning(true);
    setError(null);
    setResult(null);
    try {
      setResult(await api.runDemoQuery(selected.id));
    } catch (problem) {
      setError(problem instanceof Error ? problem.message : "The query failed.");
    } finally {
      setRunning(false);
    }
  }

  return (
    <div className="space-y-6">
      <header>
        <h1 className="text-2xl">Queries</h1>
        <p className="muted mt-1">
          {queries.length > 0 ? `${queries.length} of the queries` : "The queries"} behind this
          project, each one runnable against the live database. Only these fixed queries can be
          executed, nothing from this page is passed to MongoDB.
        </p>
      </header>

      {error ? <p className="text-sm text-blood-700">{error}</p> : null}

      <div className="grid gap-6 lg:grid-cols-4">
        <nav className="space-y-1 lg:col-span-1">
          {queries.map((query) => (
            <button
              key={query.id}
              type="button"
              onClick={() => {
                setSelectedId(query.id);
                setResult(null);
              }}
              className={`w-full rounded-lg px-3 py-2 text-left text-sm transition ${
                query.id === selectedId
                  ? "bg-blood-50 font-medium text-blood-700"
                  : "text-ink-700 hover:bg-ink-500/5"
              }`}
            >
              {query.title}
              <span className="block text-xs text-ink-500">{query.feature}</span>
            </button>
          ))}
        </nav>

        <div className="space-y-4 lg:col-span-3">
          {selected ? (
            <>
              <section className="card">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <h2 className="section-title">{selected.title}</h2>
                    <p className="muted mt-1 max-w-2xl">{selected.explanation}</p>
                  </div>
                  <button type="button" className="btn-primary" onClick={() => void run()} disabled={running}>
                    {running ? "Running" : "Run query"}
                  </button>
                </div>

                <pre className="mt-4 overflow-x-auto rounded-lg bg-ink-900 p-4 text-xs leading-relaxed text-blood-100">
                  <code>{selected.code}</code>
                </pre>
              </section>

              <section className="card">
                <div className="flex items-baseline justify-between">
                  <h3 className="section-title">Result</h3>
                  {result ? <span className="muted">{result.tookMs} ms</span> : null}
                </div>

                {result ? (
                  <pre className="mt-3 max-h-96 overflow-auto rounded-lg bg-ink-500/5 p-4 text-xs leading-relaxed">
                    <code>{JSON.stringify(result.result, null, 2)}</code>
                  </pre>
                ) : (
                  <p className="muted mt-3">Press Run query to execute it against the database.</p>
                )}
              </section>
            </>
          ) : (
            <p className="muted">Pick a query from the list.</p>
          )}
        </div>
      </div>
    </div>
  );
}
