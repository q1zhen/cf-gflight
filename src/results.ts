import { parse, parsePayload, type Query } from "fast-flights-ts";

function varint(value: number): number[] {
  const bytes: number[] = [];
  while (value > 127) {
    bytes.push((value & 127) | 128);
    value >>>= 7;
  }
  return [...bytes, value];
}

function field(number: number, value: string | number[]): number[] {
  const bytes = typeof value === "string" ? [...new TextEncoder().encode(value)] : value;
  return [...varint(number * 8 + 2), ...varint(bytes.length), ...bytes];
}

function detailUrl(query: Query, segments: unknown): string | null {
  if (!Array.isArray(segments) || segments.length === 0) return null;
  const selected: number[] = [];
  for (const segment of segments) {
    if (!Array.isArray(segment)) return null;
    const [origin, destination, date, carrier] = [segment[3], segment[6], segment[20], segment[22]];
    if (typeof origin !== "string" || !/^[A-Z]{3}$/.test(origin) ||
        typeof destination !== "string" || !/^[A-Z]{3}$/.test(destination) ||
        !Array.isArray(date) || date.length !== 3 || !date.every(Number.isInteger) ||
        !Array.isArray(carrier) || typeof carrier[0] !== "string" ||
        !/^[A-Z0-9]{2}$/.test(carrier[0]) || typeof carrier[1] !== "string" ||
        !/^\d{1,4}[A-Z]?$/.test(carrier[1])) return null;
    const departure = date.map((part, i) => String(part).padStart(i === 0 ? 4 : 2, "0")).join("-");
    if (!/^\d{4}-\d{2}-\d{2}$/.test(departure) ||
        Number.isNaN(Date.parse(departure)) ||
        new Date(departure).toISOString().slice(0, 10) !== departure) return null;

    // Google tfs: field 4 pins a physical flight by route, date and flight number.
    selected.push(...field(4, [
      ...field(1, origin), ...field(2, departure), ...field(3, destination),
      ...field(5, carrier[0]), ...field(6, carrier[1]),
    ]));
  }

  // fast-flights-ts 4.1.0 serializes the outbound as the first field-3 message.
  // Extend it, preserving all original filters, return dates, cabin and travelers.
  const bytes = [...query.toBytes()];
  if (bytes[0] !== 26) return null;
  let offset = 1;
  let length = 0;
  let shift = 0;
  let byte: number;
  do {
    byte = bytes[offset++];
    length |= (byte & 127) << shift;
    shift += 7;
  } while (byte & 128);
  const token = [
    8, 28, 16, 2, // Google's itinerary-view header.
    ...field(3, [...bytes.slice(offset, offset + length), ...selected]),
    ...bytes.slice(offset + length), 112, 1,
  ];
  const tfs = btoa(String.fromCharCode(...token)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
  const path = query.trip === 2 ? "booking" : "search";
  const url = new URL(`https://www.google.com/travel/flights/${path}`);
  url.search = new URLSearchParams({ tfs, hl: query.language, curr: query.currency }).toString();
  return url.toString();
}

export function parseResults(html: string, query: Query) {
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
    return [{ ...flight, google_flights_url: detailUrl(query, segments) }];
  });
  return { flights, metadata };
}
