import { describe, expect, it } from "vitest";
import { createQuery, parseFlightsPayload } from "google-flights-scraper";
import { googleFlightsUrl, selectFlight } from "../src/selection";
import { leg, returnLeg, payload, row, segment } from "./fixtures";

const query = createQuery({ flights: [leg], currency: "USD", language: "en-US" });
const parsed = (segments: unknown[][]) => parseFlightsPayload(payload([row(segments)])).flights[0].segments;

const text = (bytes: Uint8Array) => new TextDecoder().decode(bytes);
const tokenBytes = (url: URL) => Uint8Array.from(
  atob(url.searchParams.get("tfs")!.replace(/-/g, "+").replace(/_/g, "/")), (char) => char.charCodeAt(0),
);

// Independent wire-format reader for asserting the generated Google selection.
function fields(bytes: Uint8Array) {
  let offset = 0;
  const result = new Map<number, (number | Uint8Array)[]>();
  const read = () => {
    let value = 0, shift = 0, byte;
    do { byte = bytes[offset++]; value |= (byte & 127) << shift; shift += 7; } while (byte & 128);
    return value;
  };
  while (offset < bytes.length) {
    const tag = read();
    let value: number | Uint8Array;
    if ((tag & 7) === 0) value = read();
    else if ((tag & 7) === 2) {
      const length = read();
      value = bytes.slice(offset, offset + length);
      offset += length;
    } else throw new Error("Unexpected protobuf wire type");
    result.set(tag >> 3, [...result.get(tag >> 3) ?? [], value]);
  }
  return result;
}

describe("Google Flights detail links", () => {
  it("preserves the previously verified one-way booking URL", () => {
    expect(googleFlightsUrl(query, parsed([segment()]))).toBe(
      "https://www.google.com/travel/flights/booking?tfs=CBwQAho5EgoyMDI3LTAxLTIwagUSA0pGS3IFEgNMQVgiHQoDSkZLEgoyMDI3LTAxLTIwGgNMQVgqAkFBMgExQgEBSAGYAQJwAQ&hl=en-US&curr=USD",
    );
  });

  it("pins every connection and next-day departure", () => {
    const segments = parsed([segment("1234", "JFK", "ORD"), segment("5678", "ORD", "LAX", 9, [2027, 1, 21])]);
    const url = new URL(googleFlightsUrl(query, segments)!);
    const selected = fields(fields(tokenBytes(url)).get(3)![0] as Uint8Array).get(4)!;
    expect(selected).toHaveLength(2);
    expect(selected.map((s) => text(fields(s as Uint8Array).get(6)![0] as Uint8Array))).toEqual(["1234", "5678"]);
    expect(text(fields(selected[1] as Uint8Array).get(2)![0] as Uint8Array)).toBe("2027-01-21");
  });

  it("preserves travelers, cabin, locale, region and upstream query filters", () => {
    const encoded = createQuery({ flights: [{ ...leg, airlines: ["AA"] }], seat: "business", maxStops: 1,
      passengers: { adults: 2, children: 1 }, currency: "EUR", language: "de", region: "DE" });
    const original = encoded.tfs;
    const url = new URL(googleFlightsUrl(encoded, parsed([segment()]))!);
    expect(url.searchParams.get("curr")).toBe("EUR");
    expect(url.searchParams.get("hl")).toBe("de");
    expect(url.searchParams.get("gl")).toBe("DE");
    const info = fields(tokenBytes(url));
    expect([...info.get(8)![0] as Uint8Array]).toEqual([1, 1, 2]);
    expect(info.get(9)).toEqual([3]);
    const flight = fields(info.get(3)![0] as Uint8Array);
    expect(flight.get(5)).toEqual([1]);
    expect(text(flight.get(6)![0] as Uint8Array)).toBe("AA");
    expect(encoded.tfs).toBe(original);
  });

  it("returns null when flight identifiers are missing or invalid", () => {
    expect(googleFlightsUrl(query, [])).toBeNull();
    expect(googleFlightsUrl(query, parsed([segment("")]))).toBeNull();
    expect(googleFlightsUrl(query, parsed([segment("1", "JFK", "LAX", 9, [2027, 2, 30])]))).toBeNull();
  });

  it("selects outbound and return connections in separate legs without mutating the query", () => {
    const encoded = createQuery({ flights: [leg, { ...returnLeg, maxStops: 1, airlines: ["AA"] }],
      trip: "round-trip", seat: "business", passengers: { adults: 2 }, currency: "EUR", region: "DE" });
    const outbound = selectFlight(encoded, parsed([segment("10")]))!;
    const original = outbound.tfs;
    const url = new URL(googleFlightsUrl(outbound, parsed([
      segment("20", "LAX", "ORD", 9, [2027, 1, 27]),
      segment("21", "ORD", "JFK", 9, [2027, 1, 28]),
    ]), 1)!);
    expect(new URL(outbound.url).pathname).toBe("/travel/flights/search");
    const info = fields(tokenBytes(url));
    const legs = info.get(3)!.map((leg) => fields(leg as Uint8Array));
    expect(legs.map((leg) => leg.get(4)!.length)).toEqual([1, 2]);
    expect(legs.map((leg) => leg.get(4)!.map((s) => text(fields(s as Uint8Array).get(6)![0] as Uint8Array))))
      .toEqual([["10"], ["20", "21"]]);
    expect(legs[1].get(5)).toEqual([1]);
    expect(text(legs[1].get(6)![0] as Uint8Array)).toBe("AA");
    expect(info.has(1)).toBe(false);
    expect(info.has(2)).toBe(false);
    expect(info.has(14)).toBe(false);
    expect(info.get(19)).toEqual([1]);
    expect(info.get(9)).toEqual([3]);
    expect([...info.get(8)![0] as Uint8Array]).toEqual([1, 1]);
    expect(url.searchParams.get("curr")).toBe("EUR");
    expect(url.searchParams.get("gl")).toBe("DE");
    expect(outbound.tfs).toBe(original);
    expect(fields(tokenBytes(new URL(encoded.url))).get(3)!.map((leg) => fields(leg as Uint8Array).has(4)))
      .toEqual([false, false]);
    expect(() => selectFlight(encoded, parsed([segment()]), 2)).toThrow("Missing query direction");
  });
});
