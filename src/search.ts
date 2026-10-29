import { createQuery, fetchFlights, type StructuredQueryInput } from "google-flights-scraper";
import { googleFlightsUrl } from "./selection";
import { fetchFlightData } from "./transport";

export async function searchFlights(query: StructuredQueryInput) {
  const result = await fetchFlights(query, {
    fetch: fetchFlightData, transport: "html", timeoutMs: 20_000, retry: { attempts: 0 }, cache: false,
  });
  const encoded = createQuery(query);
  return {
    ...result,
    flights: result.flights.map((flight) => ({
      ...flight,
      googleFlightsUrl: googleFlightsUrl(encoded, flight.segments),
    })),
  };
}
