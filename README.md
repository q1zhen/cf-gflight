# cf-gflight

A small Cloudflare Worker API around [fast-flights-ts](https://github.com/decocms/fast-flights-ts). Uses the library's HTML fetcher and parser with native `fetch`. No database, API keys, or framework required.

Google's RPC endpoint returns an error payload from Cloudflare Workers, so this API fetches the Google Flights HTML page instead. The request and response formats are unchanged.

## Run

Use Node.js 22 or newer.

```sh
npm ci --ignore-scripts
npm run dev
```

`--ignore-scripts` skips building the library's optional native `node-libcurl` addon. Wrangler aliases that addon to a small stub because Workers cannot load it; the HTML fetcher falls back to native `fetch`.

`npm audit` currently reports vulnerabilities in that unused addon's build dependencies. Those dependencies are excluded from the Worker bundle.

## Search

Visit `/` in a browser for parameters, an example JSON request, and success/error response schemas with field types and units.

`POST /flights` accepts JSON matching the library's query options, with passengers supplied as a plain object:

```sh
curl http://localhost:8787/flights \
  -H 'Content-Type: application/json' \
  -d '{
    "flights": [
      { "date": "2027-01-20", "from_airport": "JFK", "to_airport": "LAX" }
    ],
    "trip": "one-way",
    "seat": "economy",
    "passengers": { "adults": 1 },
    "currency": "USD",
    "max_stops": 0
  }'
```

Only `flights` is required. Defaults: one-way, economy, one adult, USD, `en-US`, and any number of stops. Airport and currency codes are normalized to uppercase.

Supported options:

- `trip`: `one-way` (1 leg) or `round-trip` (2 reversed legs). Multi-city/open-jaw searches return 422 because Google's HTML endpoint does not provide their results.
- `seat`: `economy`, `premium-economy`, `business`, or `first`.
- `passengers`: `adults`, `children`, `infants_in_seat`, `infants_on_lap`; 1–9 total, with an adult for each lap infant. Unspecified adults default to 1; other counts default to 0.
- `currency` and `language`: Google Flights currency and language codes.
- `max_stops`: 0–3, or `null` for unrestricted. Each leg can override it and optionally specify `airlines`, such as `["AA", "DL"]`.

Dates must be valid `YYYY-MM-DD` dates in chronological order. For a round trip, add a return leg with reversed airports and set `"trip": "round-trip"`.

The response is `{ "flights": [...], "metadata": { ... } }`, preserving the library's flight records and airline/alliance metadata. An empty result is a successful response with `flights: []`.

Each result includes `google_flights_url`: an itinerary-specific Google Flights link. One-way links open booking details; round-trip links select the outbound flight and open return-flight selection. Links preserve the query's travelers, cabin, dates, language, and currency. The field is `null` if Google omits required flight identifiers. Google may reprice flights when the link opens.

`GET /health` returns `{ "ok": true }` without contacting Google.

Errors are JSON with an `error` field: 400 for invalid input (validation errors also include `issues`), 404 for unknown routes, 405 for unsupported search methods, 415 for non-JSON content, 422 for unsupported multi-city searches, 502 for upstream failures, and 504 for the 20-second upstream timeout. Searches do not retry.

This public API supports browsers and server-side clients. CORS allows all origins, including localhost, with JSON POST preflights handled automatically. Error responses also include CORS headers. No cookies or authentication are required; do not set `credentials: "include"`.

```js
const response = await fetch("https://cf-gflight.qizhen-yang.workers.dev/flights", {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({
    flights: [{ date: "2027-01-20", from_airport: "JFK", to_airport: "LAX" }],
  }),
});
const data = await response.json();
if (!response.ok) throw new Error(data.error);
console.log(data.flights);
```

Google may rate-limit or block scraping, and changes to its internal API can break searches.

## Check and deploy

```sh
npm run typecheck
npm test
npm run build        # bundle only; does not deploy
git push origin main # Cloudflare CI builds and deploys automatically
```

Deploy changes by committing and pushing to `main`; Cloudflare CI handles deployment. The Worker uses [Cloudflare's Node.js compatibility mode](https://developers.cloudflare.com/workers/runtime-apis/nodejs/) for library compatibility.
