export const spec = `cf-gflight — Google Flights API

POST /flights
Content-Type: application/json

Browser access
  CORS is enabled for all origins. Send JSON using fetch() with method POST.
  OPTIONS preflights allow Content-Type and are cached for 24 hours.
  No cookies or credentials are required; do not use credentials: "include".

JSON parameters
  flights             Required array: 1 leg for one-way, 2 for round-trip.
    date              Required date in YYYY-MM-DD format.
    from_airport      Required 3-letter airport code, e.g. JFK.
    to_airport        Required 3-letter airport code, e.g. LAX.
    max_stops         Optional per-leg override: integer 0–3, or null.
    airlines          Optional array of 2-character airline codes, e.g. ["AA"].
                      Maximum 50 codes; omit or use null for any airline.
  trip                one-way (default) | round-trip
  seat                economy (default) | premium-economy | business | first
  passengers          Optional object, with integer counts from 0–9:
    adults            Default: 1
    children          Default: 0
    infants_in_seat    Default: 0
    infants_on_lap     Default: 0
  currency            3-letter currency code. Default: USD.
  language            Google Flights language code. Default: en-US.
  max_stops           Integer 0–3; 0 means nonstop. Default: unrestricted.
                      Omit or use null for unrestricted stops.

Rules
  Dates must be chronological; departure and arrival airports must differ.
  Round trips require reversed airports on the return leg.
  Use 1–9 passengers total, with an adult for each infant on lap.
  Airport and currency codes are normalized to uppercase.
  Multi-city and open-jaw trips are unsupported (422).

Example JSON body
{
  "flights": [
    { "date": "2027-01-20", "from_airport": "JFK", "to_airport": "LAX" }
  ],
  "max_stops": 0
}

Success response (200, application/json)
  {
    flights: Array<{
      type: string,             // Raw upstream identifier, e.g. "AA".
      price: number,            // Price in the requested currency (default USD).
      google_flights_url: string | null, // Link to this result on Google Flights.
      airlines: string[],       // Airline names, e.g. ["American"].
      flights: Array<{          // Flight segments within this result.
        from_airport: { code: string, name: string },
        to_airport: { code: string, name: string },
        departure: { date: [year, month, day], time: [hour, minute] },
        arrival: { date: [year, month, day], time: [hour, minute] },
        duration: number,       // Minutes, per segment; excludes layovers.
        plane_type: string     // Aircraft name, e.g. "Boeing 777".
      }>,
      carbon: {
        emission: number,      // Grams of emissions for this result.
        typical_on_route: number // Typical route emissions in grams.
      }
    }>,
    metadata: {
      airlines: Array<{ code: string, name: string }>,
      alliances: Array<{ code: string, name: string }>
    }
  }

  Notation above describes types; actual responses are JSON.
  Date/time entries are numbers: date [2027, 1, 20], time [9, 10].
  Times use a 24-hour clock; no timezone or UTC offset is included.
  Top-level flights are search results; nested flights are their segments.
  Round-trip results can contain outbound segments only, not a full itinerary.
  google_flights_url opens booking details for one-way results. For round trips,
  it selects this outbound flight and opens return-flight selection, preserving
  the return date, travelers, cabin, language, and currency. It is null if Google
  omits the flight identifiers needed for an exact link. Prices may change.
  Missing upstream values may appear as 0, empty strings, or empty arrays.
  No results: { "flights": [], "metadata": { "airlines": [], "alliances": [] } }
  Metadata may still be populated when flights is empty.

Error response (application/json)
  { "error": "..." }
  Validation errors also include an issues array. Each issue has:
    code: string, path: Array<string | number>, message: string
  Additional issue fields depend on the validation rule.
  Example: { "error": "Invalid search parameters", "issues": [
    { "code": "custom", "path": ["passengers"], "message": "Use 1–9 passengers in total." }
  ] }
  Status: 400 invalid input; 404 unknown route; 405 wrong method;
          415 wrong content type; 422 unsupported trip;
          502 upstream failure; 504 upstream timeout (20 seconds).

GET /health returns { "ok": true }.
No authentication required. Flight availability depends on Google.
`;
