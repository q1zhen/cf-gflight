import { decodeQuery, type EncodedQuery, type FlightSegment } from "google-flights-scraper";

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

function encodeSelection(segments: FlightSegment[]): number[] | null {
  if (segments.length === 0) return null;
  const selected: number[] = [];
  for (const segment of segments) {
    const origin = segment.fromAirport.code;
    const destination = segment.toAirport.code;
    const date = segment.departure.date;
    const carrier = segment.operatingCarrier;
    const number = segment.flightNumber.startsWith(carrier) ? segment.flightNumber.slice(carrier.length) : "";
    if (!/^[A-Z]{3}$/.test(origin) || !/^[A-Z]{3}$/.test(destination) ||
        !/^[A-Z0-9]{2}$/.test(carrier) || !/^\d{1,4}[A-Z]?$/.test(number) ||
        ![date.year, date.month, date.day].every(Number.isInteger)) return null;
    const departure = [date.year, date.month, date.day]
      .map((part, i) => String(part).padStart(i === 0 ? 4 : 2, "0")).join("-");
    if (!/^\d{4}-\d{2}-\d{2}$/.test(departure) ||
        Number.isNaN(Date.parse(departure)) ||
        new Date(departure).toISOString().slice(0, 10) !== departure) return null;
    selected.push(...field(4, [
      ...field(1, origin), ...field(2, departure), ...field(3, destination),
      ...field(5, carrier), ...field(6, number),
    ]));
  }
  return selected;
}

// Pin one direction while preserving any earlier selection, travelers and filters.
export function selectFlight(query: EncodedQuery, segments: FlightSegment[], direction = 0): EncodedQuery | null {
  const selection = encodeSelection(segments);
  if (!selection) return null;
  const bytes = [...Uint8Array.from(atob(query.tfs.replace(/-/g, "+").replace(/_/g, "/")), (char) => char.charCodeAt(0))];
  let offset = 0, index = 0;
  const read = () => {
    let value = 0, shift = 0, byte;
    do {
      if (offset >= bytes.length || shift > 28) throw new Error("Unexpected upstream query encoding");
      byte = bytes[offset++]; value |= (byte & 127) << shift; shift += 7;
    } while (byte & 128);
    return value;
  };
  while (offset < bytes.length) {
    const start = offset;
    const tag = read();
    if ((tag & 7) === 0) { read(); continue; }
    if ((tag & 7) !== 2) throw new Error("Unexpected upstream query encoding");
    const length = read();
    const end = offset + length;
    if (length < 0 || end > bytes.length) throw new Error("Unexpected upstream query encoding");
    if (tag === 26 && index++ === direction) {
      const selected = [...bytes.slice(0, start),
        ...field(3, [...bytes.slice(offset, end), ...selection]), ...bytes.slice(end)];
      // Keep the upstream query format. Adding page flags to this compact format
      // makes Google reject round-trip return searches with an ErrorResponse.
      const tfs = btoa(String.fromCharCode(...selected)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
      const params = new URLSearchParams(query.params);
      params.set("tfs", tfs);
      return { ...query, tfs, params, url: `https://www.google.com/travel/flights/search?${params}` };
    }
    offset = end;
  }
  throw new Error("Missing query direction");
}

export function googleFlightsUrl(query: EncodedQuery, segments: FlightSegment[], direction = 0): string | null {
  const selected = selectFlight(query, segments, direction);
  if (!selected) return null;
  const url = new URL(selected.url);
  url.pathname = "/travel/flights/booking";
  // Preserve the existing one-way booking link format.
  if (decodeQuery(query.tfs).trip === "one-way") {
    const bytes = [...Uint8Array.from(atob(selected.tfs.replace(/-/g, "+").replace(/_/g, "/")), (char) => char.charCodeAt(0))];
    url.searchParams.set("tfs", btoa(String.fromCharCode(8, 28, 16, 2, ...bytes, 112, 1))
      .replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, ""));
  }
  return url.toString();
}
