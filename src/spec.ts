export const spec = `cf-gflight — Google Flights API

POST /flights
Content-Type: application/json

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

Response: { "flights": [...], "metadata": { ... } }
Errors:   { "error": "..." } (validation errors also include "issues")
          400 invalid input; 404 unknown route; 405 wrong method;
          415 wrong content type; 422 unsupported trip;
          502 upstream failure; 504 upstream timeout (20 seconds).

GET /health returns { "ok": true }.
No authentication required. Flight availability depends on Google.
`;
