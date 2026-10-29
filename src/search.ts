import { fetchFlightsHtml, ParseError, TimeoutError, type Query } from "fast-flights-ts";
import { parseResults, selection, type SearchFlight } from "./results";
import { selectFlight } from "./selection";

function roundTrip(outbound: SearchFlight, inbound: SearchFlight) {
  return {
    ...outbound,
    // Return options are priced for the entire selected trip, not just the return.
    price: inbound.price,
    airlines: [...new Set([...outbound.airlines, ...inbound.airlines])],
    flights: [...outbound.flights, ...inbound.flights],
    outbound: outbound.flights,
    return: inbound.flights,
    carbon: {
      emission: outbound.carbon.emission + inbound.carbon.emission,
      typical_on_route: outbound.carbon.typical_on_route + inbound.carbon.typical_on_route,
    },
    google_flights_url: inbound.google_flights_url,
  };
}

export async function searchFlights(query: Query) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(new TimeoutError(20_000)), 20_000);
  const fetchOptions = { timeout: 20_000, maxRetries: 0, signal: controller.signal };
  try {
    const initial = parseResults(await fetchFlightsHtml(query, fetchOptions), query);
    if (query.trip !== 1) return initial;

    // Keep Google's result order. The limit applies to outbounds, not combinations.
    const outbounds = initial.flights.slice(0, 20);
    const expanded = new Array<ReturnType<typeof roundTrip>[]>(outbounds.length);
    const airlines = new Map(initial.metadata.airlines.map((airline) => [airline.code, airline]));
    const alliances = new Map(initial.metadata.alliances.map((alliance) => [alliance.code, alliance]));
    let next = 0;
    await Promise.all(Array.from({ length: Math.min(4, outbounds.length) }, async () => {
      while (next < outbounds.length) {
        controller.signal.throwIfAborted();
        const index = next++;
        const outbound = outbounds[index];
        const selected = outbound[selection];
        if (!selected) throw new ParseError("Missing outbound identifiers for round-trip search");
        const returnQuery = selectFlight(query, selected, 0);
        const returns = parseResults(await fetchFlightsHtml(returnQuery, fetchOptions), returnQuery, 1);
        expanded[index] = returns.flights.map((inbound) => roundTrip(outbound, inbound));
        for (const airline of returns.metadata.airlines) airlines.set(airline.code, airline);
        for (const alliance of returns.metadata.alliances) alliances.set(alliance.code, alliance);
      }
    }));
    return {
      flights: expanded.flat(),
      metadata: { airlines: [...airlines.values()], alliances: [...alliances.values()] },
    };
  } finally {
    clearTimeout(timer);
    // Cancel remaining in-flight lookups if any one lookup failed.
    controller.abort();
  }
}
