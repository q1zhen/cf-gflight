# cf-gflight

A small Cloudflare Worker API using [google-flights-scraper](https://github.com/0xForelsket/google-flights-scraper), pinned to `0.2.0`. One-way searches use one Google HTML request, native `fetch`, no retries, no result cache, and a 20-second timeout.

## Search

Visit the [API root](https://cf-gflight.qizhen-yang.workers.dev/) for the complete parameter and response spec. Send `POST /flights` with the upstream library's camelCase structured query:

```sh
curl https://cf-gflight.qizhen-yang.workers.dev/flights \
  -H 'Content-Type: application/json' \
  -d '{
    "flights": [
      { "date": "2027-01-20", "fromAirport": "JFK", "toAirport": "LAX" }
    ],
    "trip": "one-way",
    "seat": "economy",
    "passengers": { "adults": 1 },
    "currency": "USD",
    "language": "en-US",
    "region": "US",
    "maxStops": 0,
    "filters": {
      "departureTime": { "earliest": "08:00", "latest": "18:00" }
    }
  }'
```

Only `flights` is required. Defaults are one-way, economy and one adult. Omit `maxStops` for unrestricted stops. Currency, language and region use Google's settings when omitted or empty. Airport, currency, region, airline and connection codes normalize to uppercase. Unknown JSON fields are rejected so old or misspelled filters cannot silently be ignored.

Supported query fields match upstream `StructuredQueryInput`:

- `flights`: exactly one leg with `date`, `fromAirport`, `toAirport`, optional `maxStops` and `airlines` (airline or alliance codes).
- `seat`: `economy`, `premium-economy`, `business`, or `first`.
- `passengers`: `adults`, `children`, `infantsInSeat`, `infantsOnLap`; 1–9 total, with one adult per lap infant.
- `currency`, `language`, `region`, and top-level `maxStops`.
- `filters.departureTime` and `filters.arrivalTime`: optional `earliest`/`latest` in `HH:MM`, inclusive local times at the first departure/final arrival airport. Overnight ranges are rejected.
- `filters.layover`: `minMinutes`/`maxMinutes`, non-negative integers applied to each layover.
- `filters.connectionAirports`: `allow`/`block` arrays of airport codes; every connection must be allowed and none blocked. Nonstop flights pass these and layover filters.

Time, layover and connection filters run after parsing Google's results. They do not retrieve additional matches. Metadata remains unfiltered. Round-trip searches remain temporarily disabled; multi-city is unsupported. Valid requests for either return **422** before contacting Google.

## Response

The response follows upstream `FlightsSearchResult`: `{ "flights": [...], "metadata": { ... } }`.

Each result includes `price`, `airlines`, `segments`, `totalDurationMinutes`, `stopCount`, `layovers`, `carbon`, `farePolicy`, `bookingToken`, `carrierLinks`, and `baggageLinks`. Segment dates/times are objects: `{ "date": { "year": 2027, "month": 1, "day": 20 }, "time": { "hour": 9, "minute": 0 } }`. Metadata includes airlines, alliances, baggage links, locations and nullable flexible-date insights.

The API adds `googleFlightsUrl` to each result, selecting that itinerary on Google's booking page while preserving travelers, cabin and locale settings. It is `null` if required identifiers are missing. Carrier links can be support/baggage resources rather than booking links. Fare-policy hints are best-effort, and fares may change.

No matches is a successful response with `flights: []`. Errors are JSON with `error`: **400** invalid input (also `issues`), **404** unknown route, **405** wrong method, **415** non-JSON content, **422** unsupported trip, **502** upstream failure including rate limiting, **504** timeout. `GET /health` returns `{ "ok": true }` without calling Google.

### Migration from fast-flights-ts

This is a breaking interface change:

| Previous field | New field |
| --- | --- |
| `from_airport`, `to_airport` | `fromAirport`, `toAirport` |
| `max_stops` | `maxStops` (omit instead of `null`) |
| `infants_in_seat`, `infants_on_lap` | `infantsInSeat`, `infantsOnLap` |
| Nested result `flights` | `segments` |
| `google_flights_url` | `googleFlightsUrl` |
| Date/time arrays | Date/time objects |

Set `currency: "USD"` and `language: "en-US"` explicitly to retain the previous locale defaults. All other response names and fields now follow the new upstream library; the root spec documents them in full.

## Browser access

CORS allows all origins, including localhost, with JSON POST preflights handled automatically. Error responses also have CORS headers. No cookies or authentication are required; do not use `credentials: "include"`.

```js
const response = await fetch("https://cf-gflight.qizhen-yang.workers.dev/flights", {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({
    flights: [{ date: "2027-01-20", fromAirport: "JFK", toAirport: "LAX" }],
    currency: "USD",
    filters: { departureTime: { earliest: "08:00", latest: "18:00" } },
  }),
});
const data = await response.json();
if (!response.ok) throw new Error(data.error);
console.log(data.flights);
```

## Run and deploy

Use Node.js 22 or newer:

```sh
npm ci --ignore-scripts
npm run dev
npm run typecheck
npm test
npm run build         # bundle only
git push origin main  # Cloudflare CI builds and deploys automatically
```

Wrangler aliases the upstream HTML parser's `node:vm` helper to a small JSON-only bootstrap reader. It never evaluates downloaded JavaScript. The unused `undici` proxy helper is stubbed; proxies are not exposed by this API. A fetch adapter passes only the flight-data script to the parser when present, avoiding upstream 0.2.0’s false CAPTCHA detection on shared page scripts. Actual CAPTCHA/error pages retain upstream error handling. All filtering and flight-result parsing use the upstream package. The HTML transport is fixed because Google's RPC endpoint previously failed from Workers.

Google may rate-limit or block requests, and changes to its internal payload can break the scraper.
