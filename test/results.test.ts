import { describe, expect, it } from "vitest";
import { createQuery, Passengers } from "fast-flights-ts";
import { parseResults } from "../src/results";

const outbound = { date: "2027-01-20", from_airport: "JFK", to_airport: "LAX" };
const inbound = { date: "2027-01-27", from_airport: "LAX", to_airport: "JFK" };
const query = createQuery({ flights: [outbound], currency: "USD", language: "en-US" });

function segment(number = "1", from = "JFK", to = "LAX", date = [2027, 1, 20]) {
  const value: unknown[] = [];
  value[3] = from;
  value[6] = to;
  value[20] = date;
  value[22] = ["AA", number];
  return value;
}

const row = (segments: unknown[], price = 129) => [["AA", ["American"], segments], [[null, price]]];
function html(best: unknown[], other: unknown[] = []) {
  const payload = [null, null, [best], [other], null, null, null, [null, [[], [["AA", "American"]]]]];
  return `<script class="ds:1">AF_initDataCallback({data:${JSON.stringify(payload)},sideChannel:{}});</script>`;
}

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
  it("matches a one-way URL verified on Google's booking page", () => {
    const { flights, metadata } = parseResults(html([row([segment()])]), query);
    expect(flights[0].google_flights_url).toBe(
      "https://www.google.com/travel/flights/booking?tfs=CBwQAho5EgoyMDI3LTAxLTIwagUSA0pGS3IFEgNMQVgiHQoDSkZLEgoyMDI3LTAxLTIwGgNMQVgqAkFBMgExQgEBSAGYAQJwAQ&hl=en-US&curr=USD",
    );
    expect(flights[0].price).toBe(129);
    expect(metadata.airlines).toEqual([{ code: "AA", name: "American" }]);
  });

  it("pins every connection, including a next-day departure", () => {
    const connections = [segment("1234", "JFK", "ORD"), segment("5678", "ORD", "DEN"), segment("9012", "DEN", "LAX", [2027, 1, 21])];
    const url = new URL(parseResults(html([row(connections)]), query).flights[0].google_flights_url!);
    const info = fields(tokenBytes(url));
    const selected = fields(info.get(3)![0] as Uint8Array).get(4)!;
    expect(selected).toHaveLength(3);
    expect(selected.map((leg) => text(fields(leg as Uint8Array).get(6)![0] as Uint8Array))).toEqual(["1234", "5678", "9012"]);
    expect(text(fields(selected[2] as Uint8Array).get(2)![0] as Uint8Array)).toBe("2027-01-21");
  });

  it("keeps the round-trip return date, travelers, cabin, locale and filters", () => {
    const roundTrip = createQuery({
      flights: [outbound, inbound], trip: "round-trip", seat: "business", max_stops: 1,
      passengers: new Passengers({ adults: 2, children: 1 }), currency: "EUR", language: "de",
    });
    const original = roundTrip.toStr();
    const url = new URL(parseResults(html([row([segment()])]), roundTrip).flights[0].google_flights_url!);
    expect(url.pathname).toBe("/travel/flights/search");
    expect(url.searchParams.get("curr")).toBe("EUR");
    expect(url.searchParams.get("hl")).toBe("de");
    const info = fields(tokenBytes(url));
    expect([...info.get(8)![0] as Uint8Array]).toEqual([1, 1, 2]);
    expect(info.get(9)).toEqual([3]);
    expect(info.get(19)).toEqual([1]);
    const legs = info.get(3)!;
    expect(legs).toHaveLength(2);
    expect(fields(legs[0] as Uint8Array).get(4)).toHaveLength(1);
    expect(fields(legs[0] as Uint8Array).get(5)).toEqual([1]);
    expect(fields(legs[1] as Uint8Array).get(4)).toBeUndefined();
    expect(text(fields(legs[1] as Uint8Array).get(2)![0] as Uint8Array)).toBe(inbound.date);
    expect(roundTrip.toStr()).toBe(original);
  });

  it("keeps links aligned across skipped rows and both result groups", () => {
    const results = parseResults(html([null, row([segment("1")])], [row([segment("2")], 150)]), query);
    expect(results.flights).toHaveLength(2);
    expect(results.flights.map((f) => f.price)).toEqual([129, 150]);
    expect(results.flights[0].google_flights_url).not.toBe(results.flights[1].google_flights_url);
  });

  it.each([[], [segment("")], [segment("1", "JFK", "LAX", [2027, 2, 30])], [null]].map((segments) => ({ segments })))(
    "returns null for missing or invalid flight identifiers: %j", ({ segments }) => {
      const results = parseResults(html([row(segments)]), query);
      expect(results.flights[0].google_flights_url).toBeNull();
      expect(results.flights[0].price).toBe(129);
    },
  );
});
