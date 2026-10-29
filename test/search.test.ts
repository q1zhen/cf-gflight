import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createQuery, fetchFlightsHtml, HttpError, Passengers, TimeoutError } from "fast-flights-ts";
import { searchFlights } from "../src/search";

vi.mock("fast-flights-ts", async (importOriginal) => ({
  ...await importOriginal<typeof import("fast-flights-ts")>(),
  fetchFlightsHtml: vi.fn(),
}));

const legs = [
  { date: "2027-01-20", from_airport: "JFK", to_airport: "LAX" },
  { date: "2027-01-27", from_airport: "LAX", to_airport: "JFK" },
];
const query = createQuery({
  flights: legs, trip: "round-trip", seat: "business", currency: "EUR", language: "de",
  passengers: new Passengers({ adults: 2, children: 1 }), max_stops: 0,
});

function page(numbers: string[], inbound = false, price = 250) {
  const carrier = inbound ? "UA" : "AA";
  const rows = numbers.map((number) => {
    const segment: unknown[] = [];
    segment[3] = inbound ? "LAX" : "JFK";
    segment[6] = inbound ? "JFK" : "LAX";
    segment[20] = segment[21] = [2027, 1, inbound ? 27 : 20];
    segment[22] = [carrier, number];
    const flight: unknown[] = [carrier, [carrier], [segment]];
    flight[22] = [null, null, null, null, null, null, null, 100, 200];
    return [flight, [[null, price]]];
  });
  const payload = [null, null, [rows], null, null, null, null, [null, [[], [[carrier, carrier]]]]];
  return `<script class="ds:1">AF_initDataCallback({data:${JSON.stringify(payload)},sideChannel:{}});</script>`;
}

const decoded = (token: string) => atob(token.replace(/-/g, "+").replace(/_/g, "/"));
beforeEach(() => vi.resetAllMocks());
afterEach(() => vi.useRealTimers());

describe("round-trip expansion", () => {
  it("pairs returns with their selected outbound and uses the complete fare", async () => {
    vi.mocked(fetchFlightsHtml).mockImplementation(async (selected) => {
      if (typeof selected === "string") throw new Error("Expected structured query");
      if (selected === query) return page(["1000", "1001"], false, 199);
      const bytes = decoded(selected.toStr());
      expect(selected.params().tfs).toBe(selected.toStr());
      expect(selected.flightData).toEqual(query.flightData);
      expect(selected.passengers).toEqual([1, 1, 2]);
      expect(selected.seat).toBe(3);
      return bytes.includes("1000") ? page(["2000", "2001"], true, 350) : page(["2002"], true, 410);
    });
    const data = await searchFlights(query);
    expect(data.flights).toHaveLength(3);
    expect(data.flights.map((flight) => flight.price)).toEqual([350, 350, 410]);
    const serialized = JSON.parse(JSON.stringify(data));
    expect(serialized.flights[0]).toMatchObject({
      outbound: [{ from_airport: { code: "JFK" }, to_airport: { code: "LAX" } }],
      return: [{ from_airport: { code: "LAX" }, to_airport: { code: "JFK" } }],
      airlines: ["AA", "UA"], carbon: { emission: 200, typical_on_route: 400 },
    });
    expect(serialized.flights[0].flights).toEqual([...serialized.flights[0].outbound, ...serialized.flights[0].return]);
    expect(serialized.flights[0]).not.toHaveProperty("selection");
    for (const [index, flight] of data.flights.entries()) {
      const url = new URL(flight.google_flights_url!);
      expect(url.pathname).toBe("/travel/flights/booking");
      expect(url.searchParams.get("curr")).toBe("EUR");
      expect(url.searchParams.get("hl")).toBe("de");
      const bytes = decoded(url.searchParams.get("tfs")!);
      expect(bytes).toContain(index < 2 ? "1000" : "1001");
      expect(bytes).toContain(String(2000 + index));
      expect(bytes).toContain("2027-01-20");
      expect(bytes).toContain("2027-01-27");
    }
    expect(data.metadata.airlines.map((airline) => airline.code)).toEqual(["AA", "UA"]);
    expect(fetchFlightsHtml).toHaveBeenCalledTimes(3);
  });

  it("expands only the first 20 outbounds with at most four parallel lookups", async () => {
    let active = 0, peak = 0;
    const seen: string[] = [];
    vi.mocked(fetchFlightsHtml).mockImplementation(async (selected) => {
      if (selected === query) return page(Array.from({ length: 25 }, (_, i) => String(1000 + i)));
      if (typeof selected === "string") throw new Error("Expected structured query");
      seen.push(decoded(selected.toStr()));
      peak = Math.max(peak, ++active);
      await new Promise((resolve) => setTimeout(resolve, 1));
      active--;
      return page(["2000", "2001"], true);
    });
    const result = await searchFlights(query);
    expect(fetchFlightsHtml).toHaveBeenCalledTimes(21);
    expect(result.flights).toHaveLength(40);
    expect(peak).toBe(4);
    expect(seen).toHaveLength(20);
    seen.forEach((bytes, index) => expect(bytes).toContain(String(1000 + index)));
    expect(seen.some((bytes) => bytes.includes("1020"))).toBe(false);
  });

  it("keeps one-way results unchanged and makes only one request", async () => {
    vi.mocked(fetchFlightsHtml).mockResolvedValue(page(["1000"]));
    const result = await searchFlights(createQuery({ flights: [legs[0]] }));
    expect(result.flights).toHaveLength(1);
    expect(result.flights[0]).not.toHaveProperty("outbound");
    expect(result.flights[0]).not.toHaveProperty("return");
    expect(fetchFlightsHtml).toHaveBeenCalledTimes(1);
  });

  it("returns no combinations when the selected outbound has no returns", async () => {
    vi.mocked(fetchFlightsHtml).mockResolvedValueOnce(page(["1000"])).mockResolvedValueOnce(page([], true));
    expect((await searchFlights(query)).flights).toEqual([]);
    expect(fetchFlightsHtml).toHaveBeenCalledTimes(2);
  });

  it("fails rather than returning partial results when a lookup fails", async () => {
    vi.mocked(fetchFlightsHtml).mockResolvedValueOnce(page(["1000", "1001"]))
      .mockResolvedValueOnce(page(["2000"], true)).mockRejectedValueOnce(new HttpError(503, 0));
    await expect(searchFlights(query)).rejects.toBeInstanceOf(HttpError);
    expect(vi.mocked(fetchFlightsHtml).mock.calls[2][1]?.signal?.aborted).toBe(true);
  });

  it("does not expand an outbound missing its flight number", async () => {
    vi.mocked(fetchFlightsHtml).mockResolvedValue(page([""]));
    await expect(searchFlights(query)).rejects.toThrow("Missing outbound identifiers");
    expect(fetchFlightsHtml).toHaveBeenCalledTimes(1);
  });

  it("enforces the overall deadline and cancels outstanding requests", async () => {
    vi.useFakeTimers();
    vi.mocked(fetchFlightsHtml).mockImplementation((_query, options) => new Promise((_resolve, reject) => {
      options!.signal!.addEventListener("abort", () => reject(options!.signal!.reason));
    }));
    const assertion = expect(searchFlights(query)).rejects.toBeInstanceOf(TimeoutError);
    await vi.advanceTimersByTimeAsync(20_000);
    await assertion;
    expect(vi.getTimerCount()).toBe(0);
  });
});
