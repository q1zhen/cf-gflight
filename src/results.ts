import { parse, parsePayload, type Query } from "fast-flights-ts";
import { encodeSelection, googleFlightsUrl, selectFlight } from "./selection";

// Internal flight identifiers are excluded automatically from JSON responses.
export const selection = Symbol("selection");

export function parseResults(html: string, query: Query, direction = 0) {
  // Keep the library's parsing/validation and metadata behavior.
  const { metadata } = parse(html);
  const script = html.match(/<script\b[^>]*\bclass="ds:1"[^>]*>([\s\S]*?)<\/script>/)?.[1];
  if (!script) throw new Error("Missing flight data script");
  const payload: unknown[] = JSON.parse(script.slice(script.indexOf("data:") + 5, script.lastIndexOf(",")));
  const rows: unknown[] = [payload[2], payload[3]].flatMap((group) =>
    Array.isArray(group) && Array.isArray(group[0]) ? group[0] : []);
  const flights = rows.flatMap((row) => {
    // Parse each row independently so skipped malformed rows cannot shift links.
    const flight = parsePayload([null, null, [[row]]])[0];
    if (!flight) return [];
    const segments = Array.isArray(row) && Array.isArray(row[0]) ? row[0][2] : null;
    const encoded = encodeSelection(segments);
    return [{
      ...flight,
      google_flights_url: encoded ? googleFlightsUrl(selectFlight(query, encoded, direction), query.trip === 2 || direction === 1) : null,
      [selection]: encoded,
    }];
  });
  return { flights, metadata };
}

export type SearchFlight = ReturnType<typeof parseResults>["flights"][number];
