export const spec = `cf-gflight — Google Flights API
Upstream: google-flights-scraper 0.2.0
https://github.com/0xForelsket/google-flights-scraper

POST /flights
Content-Type: application/json

JSON parameters (camelCase; unknown fields are rejected)
  flights             Required array containing exactly 1 leg:
    date              Required YYYY-MM-DD date.
    fromAirport       Required 3-letter airport or city/metro code, e.g. JFK.
    toAirport         Required 3-letter airport or city/metro code, e.g. LAX.
    maxStops          Optional non-negative integer; overrides top-level maxStops.
    airlines          Optional array of airline or alliance codes, e.g.
                      ["AA"] or ["STAR_ALLIANCE"]. Maximum 50 entries.
  trip                one-way (default; only supported trip type).
  seat                economy (default) | premium-economy | business | first
  passengers          Optional object of integer counts from 0–9:
    adults            Default: 1
    children          Default: 0
    infantsInSeat     Default: 0
    infantsOnLap      Default: 0
  currency            Optional 3-letter code, e.g. USD.
  language            Optional locale, e.g. en-US.
  region              Optional 2-letter country code, e.g. US.
                      These three default to Google's settings when omitted/empty.
  maxStops            Optional non-negative integer; 0 means nonstop.
                      Omit for unrestricted stops. null is not accepted.
  filters             Optional object:
    departureTime     { earliest?: "HH:MM", latest?: "HH:MM" }
    arrivalTime       { earliest?: "HH:MM", latest?: "HH:MM" }
    layover           { minMinutes?: number, maxMinutes?: number }
    connectionAirports { allow?: string[], block?: string[] }

Rules and filter behavior
  Use 1–9 passengers total, with an adult for each infant on lap.
  Departure and arrival airports must differ. Codes normalize to uppercase.
  Round-trip searches remain temporarily disabled (422); multi-city is unsupported (422).
  Time, layover and connection filters run on the returned results; they do not
  fetch additional matches. Times are inclusive local airport times in 24-hour
  HH:MM format: first departure and final arrival. earliest must be <= latest;
  overnight windows such as 22:00–06:00 are not supported.
  Layover limits are non-negative integer minutes and apply to EVERY layover.
  All connections must be in allow (when nonempty), and none may be in block.
  Connection lists accept up to 50 codes. Nonstop flights pass layover/connection filters.
  Each search makes one Google HTML request, with no retries or result cache.
  Searches time out after 20 seconds.

Example JSON body
{
  "flights": [
    { "date": "2027-01-20", "fromAirport": "JFK", "toAirport": "LAX" }
  ],
  "currency": "USD",
  "language": "en-US",
  "region": "US",
  "maxStops": 0,
  "filters": { "departureTime": { "earliest": "08:00", "latest": "18:00" } }
}

Success response (200, application/json)
  {
    flights: Array<{
      type: string,                 // Raw upstream identifier.
      price: number,                // Itinerary price in requested currency.
      airlines: string[],           // Airline names.
      segments: Array<{
        fromAirport: Airport,
        toAirport: Airport,
        departure: Timestamp,
        arrival: Timestamp,
        durationMinutes: number,
        planeType: string,
        operatingCarrier: string,   // IATA code, e.g. "AA".
        flightNumber: string,       // Carrier + number, e.g. "AA1".
        legroom: string
      }>,
      totalDurationMinutes: number,
      stopCount: number,
      layovers: Array<{
        durationMinutes: number,
        airportCode: string,
        airportName: string,
        cityName: string,
        changeOfAirport: boolean
      }>,
      carbon: { emission: number, typicalOnRoute: number }, // Grams of CO2.
      farePolicy: {
        refundabilityCode: number | null,
        checkedBaggageIncluded: boolean | null
      },
      bookingToken: string,         // Opaque Google token, empty if unavailable.
      carrierLinks: CarrierLink[],
      baggageLinks: CarrierLink[],
      googleFlightsUrl: string | null // API addition: exact itinerary booking link.
    }>,
    metadata: {
      airlines: Array<{ code: string, name: string }>,
      alliances: Array<{ code: string, name: string }>,
      baggageLinks: CarrierLink[],
      locations: Array<{
        code: string, kind: "airport" | "city" | "place", name: string,
        cityName: string, cityCode: string, countryCode: string, countryName: string
      }>,
      flexibleDateInsight: {
        destinationLabel: string,
        cheapestPrice: number | null,
        highestPrice: number | null,
        pricePoints: Array<{ epochMs: number, date: Date, price: number }>
      } | null
    }
  }

  Airport = { code: string, name: string }
  Date = { year: number, month: number, day: number }
  Timestamp = { date: Date, time: { hour: number, minute: number } }
  CarrierLink = { code: string, name: string, url: string, type?: "support" | "baggage" }

  This notation describes types; actual responses are JSON. ? means optional.
  Timestamp values use local airport time; no UTC offset is included.
  An empty search returns flights: []; metadata may still be populated.
  Missing upstream values may be 0, empty strings or empty arrays.
  Fare-policy fields are best-effort hints, not guaranteed fare conditions.
  Carrier links may lead to support/baggage pages, not ticket booking.
  googleFlightsUrl selects the actual itinerary and preserves travelers, cabin,
  language, currency and region. It is null when flight identifiers are missing.
  Prices and availability may change when opening the link.
  Metadata, including flexible-date insights, is not narrowed by post-search filters.

Migration from the previous API (breaking change)
  from_airport -> fromAirport; to_airport -> toAirport; max_stops -> maxStops
  infants_in_seat -> infantsInSeat; infants_on_lap -> infantsOnLap
  Response: nested flights -> segments; google_flights_url -> googleFlightsUrl
  Dates/times are objects instead of arrays. Other result fields follow upstream.
  Omit maxStops for unrestricted stops; do not send null.
  Set currency and language explicitly if you require USD and en-US.

Errors (application/json)
  { "error": "..." }
  Invalid input also includes issues: Array<{
    code: string, path: Array<string | number>, message: string
  }>. Additional issue fields depend on the validation rule.
  400 invalid input; 404 unknown route; 405 wrong method; 415 wrong content type;
  422 unsupported trip; 502 upstream failure (including Google rate limiting);
  504 search timeout.

Browser access
  CORS allows all origins, including localhost. Use a JSON POST via fetch().
  OPTIONS permits GET, HEAD, POST and Content-Type; preflight cache: 24 hours.
  No authentication or cookies. Do not use credentials: "include".

GET /health returns { "ok": true } without contacting Google.
GET / or HEAD / serves this spec. Availability depends on Google.
`;
