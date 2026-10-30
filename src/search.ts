import {
  createQuery, fetchFlights, ParseFlightsError, TimeoutError,
  type CarrierLink, type EncodedQuery, type FlightResult, type FlightsSearchResult, type StructuredQueryInput,
} from "google-flights-scraper";
import { googleFlightsUrl, selectFlight } from "./selection";
import { flightDataFetch } from "./transport";

const MAX_OUTBOUNDS = 20;
const RETURN_CONCURRENCY = 4;
const SEARCH_TIMEOUT_MS = 20_000;

function unique<T>(values: T[], key: (value: T) => string): T[] {
  return [...new Map(values.map((value) => [key(value), value])).values()];
}

const linkKey = (link: CarrierLink) => `${link.code}:${link.type}:${link.url}`;

function roundTrip(outbound: FlightResult, inbound: FlightResult, selected: EncodedQuery) {
  return {
    ...inbound,
    // The return-selection price is already the total fare for both directions.
    price: inbound.price,
    airlines: [...new Set([...outbound.airlines, ...inbound.airlines])],
    segments: [...outbound.segments, ...inbound.segments],
    outbound: outbound.segments,
    return: inbound.segments,
    totalDurationMinutes: outbound.totalDurationMinutes + inbound.totalDurationMinutes,
    stopCount: outbound.stopCount + inbound.stopCount,
    layovers: [...outbound.layovers, ...inbound.layovers],
    carbon: {
      emission: outbound.carbon.emission + inbound.carbon.emission,
      typicalOnRoute: outbound.carbon.typicalOnRoute + inbound.carbon.typicalOnRoute,
    },
    farePolicy: {
      refundabilityCode: outbound.farePolicy.refundabilityCode === inbound.farePolicy.refundabilityCode
        ? inbound.farePolicy.refundabilityCode : null,
      checkedBaggageIncluded: [outbound.farePolicy.checkedBaggageIncluded, inbound.farePolicy.checkedBaggageIncluded].includes(false)
        ? false : outbound.farePolicy.checkedBaggageIncluded === true && inbound.farePolicy.checkedBaggageIncluded === true ? true : null,
    },
    carrierLinks: unique([...outbound.carrierLinks, ...inbound.carrierLinks], linkKey),
    baggageLinks: unique([...outbound.baggageLinks, ...inbound.baggageLinks], linkKey),
    googleFlightsUrl: googleFlightsUrl(selected, inbound.segments, 1),
  };
}

function mergeMetadata(results: FlightsSearchResult[]): FlightsSearchResult["metadata"] {
  const metadata = results.map((result) => result.metadata);
  return {
    airlines: unique(metadata.flatMap((m) => m.airlines), (a) => a.code),
    alliances: unique(metadata.flatMap((m) => m.alliances), (a) => a.code),
    baggageLinks: unique(metadata.flatMap((m) => m.baggageLinks), linkKey),
    locations: unique(metadata.flatMap((m) => m.locations), (l) => `${l.kind}:${l.code}`),
    flexibleDateInsight: metadata[0].flexibleDateInsight,
  };
}

export async function searchFlights(query: StructuredQueryInput) {
  const encoded = createQuery(query);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(new TimeoutError("Flight search timed out")), SEARCH_TIMEOUT_MS);
  const fetchData = flightDataFetch(query.trip === "round-trip");
  const lookup = (selected?: EncodedQuery) => fetchFlights(query, {
    // Keep the structured query so upstream post-search filters apply to each
    // direction. EncodedQuery alone loses those filters in upstream 0.2.0.
    fetch: (input, init) => fetchData(selected?.url ?? input, init),
    transport: "html", timeoutMs: 0, signal: controller.signal, retry: { attempts: 0 }, cache: false,
  });
  try {
    const initial = await lookup();
    if (query.trip !== "round-trip") return {
      ...initial,
      flights: initial.flights.map((flight) => ({
        ...flight, googleFlightsUrl: googleFlightsUrl(encoded, flight.segments),
      })),
    };

    const outbounds = initial.flights.slice(0, MAX_OUTBOUNDS);
    const expanded = new Array<ReturnType<typeof roundTrip>[]>(outbounds.length);
    const returns = new Array<FlightsSearchResult>(outbounds.length);
    let next = 0;
    await Promise.all(Array.from({ length: Math.min(RETURN_CONCURRENCY, outbounds.length) }, async () => {
      while (next < outbounds.length) {
        controller.signal.throwIfAborted();
        const index = next++;
        const outbound = outbounds[index];
        const selected = selectFlight(encoded, outbound.segments);
        if (!selected) throw new ParseFlightsError("Missing outbound identifiers for round-trip search");
        const inbound = await lookup(selected);
        returns[index] = inbound;
        expanded[index] = inbound.flights.map((flight) => roundTrip(outbound, flight, selected));
      }
    }));
    return { flights: expanded.flat(), metadata: mergeMetadata([initial, ...returns]) };
  } finally {
    clearTimeout(timer);
    // Stop other lookups immediately when any direction fails or times out.
    controller.abort();
  }
}
