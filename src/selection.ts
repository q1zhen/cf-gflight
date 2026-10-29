import { Query } from "fast-flights-ts";

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

export function encodeSelection(segments: unknown): number[] | null {
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

  return selected;
}

class SelectedQuery extends Query {
  constructor(query: Query, private readonly bytes: Uint8Array) {
    super(query.flightData, query.seat, query.trip, query.passengers, query.language, query.currency);
  }

  override toBytes() { return this.bytes; }
  override toStr() {
    const token = [8, 28, 16, 2, ...this.bytes, 112, 1];
    return btoa(String.fromCharCode(...token)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
  }
}

// Extend one direction's field-3 message while retaining prior selections and filters.
export function selectFlight(query: Query, selection: number[], direction: number): Query {
  const bytes = [...query.toBytes()];
  let offset = 0, index = 0;
  const read = () => {
    let value = 0, shift = 0, byte;
    do { byte = bytes[offset++]; value |= (byte & 127) << shift; shift += 7; } while (byte & 128);
    return value;
  };
  while (offset < bytes.length) {
    const start = offset;
    const tag = read();
    if ((tag & 7) === 0) { read(); continue; }
    if ((tag & 7) !== 2) throw new Error("Unexpected query encoding");
    const length = read();
    const end = offset + length;
    if (tag === 26 && index++ === direction) {
      return new SelectedQuery(query, new Uint8Array([
        ...bytes.slice(0, start), ...field(3, [...bytes.slice(offset, end), ...selection]), ...bytes.slice(end),
      ]));
    }
    offset = end;
  }
  throw new Error("Missing query direction");
}

export function googleFlightsUrl(query: Query, complete: boolean): string {
  const url = new URL(`https://www.google.com/travel/flights/${complete ? "booking" : "search"}`);
  url.search = new URLSearchParams({ tfs: query.toStr(), hl: query.language, curr: query.currency }).toString();
  return url.toString();
}
