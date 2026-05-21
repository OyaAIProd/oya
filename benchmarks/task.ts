/**
 * The shared task, used identically by all three framework runners. Same mission,
 * same three operations, same payloads — so the only thing the benchmark varies is
 * *how much state flows through the model*.
 */

export const MISSION = "How's the weather in NYC? Then generate a PDF and a web page.";

export function getWeather({ city }: { city: string }) {
  // A realistic-ish forecast payload — the kind of thing a weather API returns.
  return {
    city,
    tempF: 72,
    condition: "sunny",
    humidity: 41,
    windMph: 8,
    pressureMb: 1017,
    station: "KNYC",
    updated: "2026-05-21T14:00:00Z",
    coords: { lat: 40.7128, lon: -74.006 },
    hourly: [
      { t: "14:00", tempF: 72, condition: "sunny" },
      { t: "15:00", tempF: 73, condition: "sunny" },
      { t: "16:00", tempF: 71, condition: "partly cloudy" },
      { t: "17:00", tempF: 68, condition: "partly cloudy" },
    ],
  };
}

export function generatePdf({ report }: { report?: unknown }) {
  const json = JSON.stringify(report);
  return { path: "/tmp/nyc-weather.pdf", bytes: 18_000 + json.length, pages: 1 };
}

export function generateWebpage({ report }: { report?: unknown }) {
  const r = report as ReturnType<typeof getWeather>;
  const rows = r.hourly.map((h) => `      <tr><td>${h.t}</td><td>${h.tempF}°F</td><td>${h.condition}</td></tr>`).join("\n");
  const html = `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>${r.city} Weather</title>
  <style>
    body { font-family: system-ui, sans-serif; margin: 2rem; color: #111; }
    .now { font-size: 3rem; font-weight: 700; }
    table { border-collapse: collapse; margin-top: 1rem; }
    td, th { border: 1px solid #ddd; padding: .4rem .8rem; text-align: left; }
  </style>
</head>
<body>
  <h1>${r.city}</h1>
  <div class="now">${r.tempF}°F · ${r.condition}</div>
  <p>Humidity ${r.humidity}% · Wind ${r.windMph} mph · Pressure ${r.pressureMb} mb</p>
  <p>Station ${r.station}, updated ${r.updated}.</p>
  <table>
    <thead><tr><th>Time</th><th>Temp</th><th>Condition</th></tr></thead>
    <tbody>
${rows}
    </tbody>
  </table>
</body>
</html>`;
  return { url: "/nyc-weather.html", bytes: html.length, html };
}
