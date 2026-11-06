import {
  ArcElement,
  BarElement,
  CategoryScale,
  Chart as ChartJS,
  Legend,
  LinearScale,
  Tooltip,
  type ChartOptions,
} from "chart.js";
import { useEffect, useState } from "react";
import { Bar, Pie } from "react-chartjs-2";
import { api } from "../lib/api";
import { ATLAS_CHART_URL } from "../lib/config";
import type { Stats } from "../lib/types";

// Chart.js only ships the pieces that are registered, which keeps the bundle
// smaller than pulling in the whole library.
ChartJS.register(CategoryScale, LinearScale, BarElement, ArcElement, Tooltip, Legend);

const INK = "#374151";
const MUTED = "#6b7280";
const GRID = "rgba(107, 114, 128, 0.15)";

/** One hue for the single series charts: the count is the only variable. */
const SERIES = "#a81f2c";

/**
 * Urgency is ordered, so it gets a light to dark ramp of the same hue rather
 * than three unrelated colours. The steps stay apart under colour blindness,
 * and the legend plus the table below never leave colour as the only clue.
 */
const URGENCY_RAMP: Record<string, string> = {
  critical: "#6b1620",
  urgent: "#c62f3d",
  normal: "#ea9199",
};

const barOptions: ChartOptions<"bar"> = {
  responsive: true,
  maintainAspectRatio: false,
  plugins: {
    legend: { display: false },
    tooltip: { backgroundColor: INK, padding: 10, displayColors: false },
  },
  scales: {
    x: { grid: { display: false }, ticks: { color: MUTED } },
    y: {
      beginAtZero: true,
      grid: { color: GRID },
      border: { display: false },
      ticks: { color: MUTED, precision: 0 },
    },
  },
};

const horizontalBarOptions: ChartOptions<"bar"> = {
  ...barOptions,
  indexAxis: "y",
  scales: {
    x: { beginAtZero: true, grid: { color: GRID }, ticks: { color: MUTED, precision: 0 } },
    y: { grid: { display: false }, ticks: { color: INK } },
  },
};

const pieOptions: ChartOptions<"pie"> = {
  responsive: true,
  maintainAspectRatio: false,
  plugins: {
    legend: { position: "bottom", labels: { color: INK, boxWidth: 12, padding: 16 } },
    tooltip: {
      backgroundColor: INK,
      padding: 10,
      callbacks: {
        label: (item) => ` ${item.label}: ${item.parsed} open request(s)`,
      },
    },
  },
};

export function Dashboard() {
  const [stats, setStats] = useState<Stats | null>(null);
  const [error, setError] = useState<string | null>(null);

  const chartUrl = ATLAS_CHART_URL;

  useEffect(() => {
    api
      .stats()
      .then(setStats)
      .catch((problem) =>
        setError(problem instanceof Error ? problem.message : "Could not load the statistics.")
      );
  }, []);

  if (error) return <p className="text-sm text-blood-700">{error}</p>;
  if (!stats) return <p className="muted">Loading the dashboard.</p>;

  const bloodGroups = stats.donorsPerBloodGroup;
  const cities = stats.donorsPerCity;
  const ages = stats.donorsPerAgeGroup;
  const urgencies = stats.requestsByUrgency;

  return (
    <div className="space-y-8">
      <header>
        <h1 className="text-2xl">Dashboard</h1>
        <p className="muted mt-1">
          Every number on this page comes from one $facet aggregation on the donors collection plus
          one on the requests collection, which is two round trips in total.
        </p>
      </header>

      <section className="grid gap-4 sm:grid-cols-3 lg:grid-cols-6">
        <Tile label="Donors" value={stats.totals.donors} />
        <Tile label="Available" value={stats.totals.availableDonors} />
        <Tile label="Eligible today" value={stats.totals.eligibleDonors} />
        <Tile label="Donations" value={stats.totals.recordedDonations} />
        <Tile label="Hospitals" value={stats.totals.hospitals} />
        <Tile label="Open requests" value={stats.totals.openRequests} />
      </section>

      <div className="grid gap-6 lg:grid-cols-2">
        <section className="card">
          <h2 className="section-title">Donors per blood group</h2>
          <p className="muted mt-1">$group on bloodGroup, sorted by count.</p>
          <div className="mt-4 h-72">
            <Bar
              options={barOptions}
              data={{
                labels: bloodGroups.map((row) => row.bloodGroup),
                datasets: [
                  {
                    label: "donors",
                    data: bloodGroups.map((row) => row.count),
                    backgroundColor: SERIES,
                    borderRadius: 4,
                    maxBarThickness: 38,
                  },
                ],
              }}
            />
          </div>
        </section>

        <section className="card">
          <h2 className="section-title">Open requests by urgency</h2>
          <p className="muted mt-1">$match on open, then $group on urgency.</p>
          {urgencies.length === 0 ? (
            <p className="muted mt-6">No open requests right now.</p>
          ) : (
            <div className="mt-4 h-72">
              <Pie
                options={pieOptions}
                data={{
                  labels: urgencies.map((row) => row.urgency),
                  datasets: [
                    {
                      data: urgencies.map((row) => row.count),
                      backgroundColor: urgencies.map((row) => URGENCY_RAMP[row.urgency] ?? SERIES),
                      borderColor: "#ffffff",
                      borderWidth: 2,
                    },
                  ],
                }}
              />
            </div>
          )}
        </section>

        <section className="card">
          <h2 className="section-title">Donors per city</h2>
          <p className="muted mt-1">$group on city, available donors shown in the table below.</p>
          <div className="mt-4 h-64">
            <Bar
              options={horizontalBarOptions}
              data={{
                labels: cities.map((row) => row.city),
                datasets: [
                  {
                    label: "donors",
                    data: cities.map((row) => row.count),
                    backgroundColor: SERIES,
                    borderRadius: 4,
                    maxBarThickness: 28,
                  },
                ],
              }}
            />
          </div>
        </section>

        <section className="card">
          <h2 className="section-title">Donors by age group</h2>
          <p className="muted mt-1">
            $bucket with boundaries 18, 26, 36, 46, 56, 66 - lower bound included, upper bound
            excluded.
          </p>
          <div className="mt-4 h-64">
            <Bar
              options={barOptions}
              data={{
                labels: ages.map((row) => row.group),
                datasets: [
                  {
                    label: "donors",
                    data: ages.map((row) => row.count),
                    backgroundColor: SERIES,
                    borderRadius: 4,
                    maxBarThickness: 46,
                  },
                ],
              }}
            />
          </div>
        </section>
      </div>

      <section className="card">
        <h2 className="section-title">The same figures as a table</h2>
        <p className="muted mt-1">
          Charts are easier to read at a glance, a table is easier to check against the database.
        </p>
        <div className="mt-4 grid gap-6 md:grid-cols-3">
          <SmallTable
            caption="Blood group"
            head={["Group", "Donors"]}
            rows={bloodGroups.map((row) => [row.bloodGroup, String(row.count)])}
          />
          <SmallTable
            caption="City"
            head={["City", "Donors", "Available"]}
            rows={cities.map((row) => [row.city, String(row.count), String(row.available)])}
          />
          <SmallTable
            caption="Open requests"
            head={["Urgency", "Requests", "Units"]}
            rows={urgencies.map((row) => [row.urgency, String(row.count), String(row.units)])}
          />
        </div>
      </section>

      <section className="card">
        <h2 className="section-title">MongoDB Atlas Chart</h2>
        <p className="muted mt-1">
          The chart below is built and hosted by Atlas Charts and embedded here as an iframe, so it
          reads the cluster directly without going through our API.
        </p>
        {chartUrl ? (
          <iframe
            title="Donors per blood group, from Atlas Charts"
            className="mt-4 h-80 w-full rounded-lg border border-ink-500/15"
            src={chartUrl}
          />
        ) : (
          <p className="mt-4 rounded-lg bg-blood-50 p-3 text-sm text-blood-800">
            Set VITE_ATLAS_CHART_URL to the embed link of your Atlas chart - in
            client/.env.development locally, or in the Vercel environment variables for the
            deployed site. The README has the eight steps for creating and embedding it.
          </p>
        )}
      </section>
    </div>
  );
}

function Tile({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-xl border border-ink-500/15 p-4">
      <p className="text-xs uppercase tracking-wide text-ink-500">{label}</p>
      <p className="mt-1 text-2xl font-semibold text-blood-700">{value}</p>
    </div>
  );
}

function SmallTable({
  caption,
  head,
  rows,
}: {
  caption: string;
  head: string[];
  rows: string[][];
}) {
  return (
    <div>
      <p className="label">{caption}</p>
      <table className="table-plain">
        <thead>
          <tr>
            {head.map((cell) => (
              <th key={cell}>{cell}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.join("-")}>
              {row.map((cell, index) => (
                <td key={index} className={index === 0 ? "font-medium" : ""}>
                  {cell}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
