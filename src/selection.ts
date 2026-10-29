import type { EncodedQuery, FlightSegment } from "google-flights-scraper";

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

export function googleFlightsUrl(query: EncodedQuery, segments: FlightSegment[]): string | null {
  const selection = encodeSelection(segments);
  if (!selection) return null;
  const bytes = [...Uint8Array.from(atob(query.tfs), (char) => char.charCodeAt(0))];
  let offset = 0;
  const read = () => {
    let value = 0, shift = 0, byte;
    do { byte = bytes[offset++]; value |= (byte & 127) << shift; shift += 7; } while (byte & 128);
    return value;
  };
  // The upstream encoder puts the one-way leg in the first field-3 message.
  if (read() !== 26) throw new Error("Unexpected upstream query encoding");
  const length = read();
  const end = offset + length;
  const token = [8, 28, 16, 2,
    ...field(3, [...bytes.slice(offset, end), ...selection]), ...bytes.slice(end), 112, 1];
  const tfs = btoa(String.fromCharCode(...token)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
  const url = new URL("https://www.google.com/travel/flights/booking");
  url.search = new URLSearchParams(query.params).toString();
  url.searchParams.set("tfs", tfs);
  return url.toString();
}
