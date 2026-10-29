import { fetchFlightsHtml, TimeoutError, type Query } from "fast-flights-ts";
import { parseResults } from "./results";

export async function searchFlights(query: Query) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(new TimeoutError(20_000)), 20_000);
  try {
    const html = await fetchFlightsHtml(query, {
      timeout: 20_000, maxRetries: 0, signal: controller.signal,
    });
    return parseResults(html, query);
  } finally {
    clearTimeout(timer);
    controller.abort();
  }
}
