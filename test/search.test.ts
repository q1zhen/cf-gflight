import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createQuery, fetchFlightsHtml, HttpError, Passengers, TimeoutError } from "fast-flights-ts";
import { searchFlights } from "../src/search";

vi.mock("fast-flights-ts", async (importOriginal) => ({
  ...await importOriginal<typeof import("fast-flights-ts")>(),
  fetchFlightsHtml: vi.fn(),
}));

const legs = [
  { date: "2027-01-20", from_airport: "JFK", to_airport: "LAX" },
];
const query = createQuery({
  flights: legs, trip: "one-way", seat: "business", currency: "EUR", language: "de",
  passengers: new Passengers({ adults: 2, children: 1 }), max_stops: 0,
});

function page(numbers: string[], price = 250) {
  const carrier = "AA";
  const rows = numbers.map((number) => {
    const segment: unknown[] = [];
    segment[3] = "JFK";
    segment[6] = "LAX";
    segment[20] = segment[21] = [2027, 1, 20];
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

describe("one-way search", () => {
  it("returns flight details with one Google request and no retries", async () => {
    vi.mocked(fetchFlightsHtml).mockResolvedValue(page(["1000"]));
    const result = await searchFlights(query);
    expect(result.flights).toHaveLength(1);
    const flight = result.flights[0];
    expect(flight.price).toBe(250);
    expect(flight).not.toHaveProperty("outbound");
    expect(flight).not.toHaveProperty("return");
    const url = new URL(flight.google_flights_url!);
    expect(url.pathname).toBe("/travel/flights/booking");
    expect(url.searchParams.get("curr")).toBe("EUR");
    expect(url.searchParams.get("hl")).toBe("de");
    expect(decoded(url.searchParams.get("tfs")!)).toContain("1000");
    expect(fetchFlightsHtml).toHaveBeenCalledExactlyOnceWith(query, {
      timeout: 20_000, maxRetries: 0, signal: expect.any(AbortSignal),
    });
  });

  it("returns an empty result when Google has no options", async () => {
    vi.mocked(fetchFlightsHtml).mockResolvedValue(page([]));
    expect((await searchFlights(query)).flights).toEqual([]);
    expect(fetchFlightsHtml).toHaveBeenCalledTimes(1);
  });

  it("propagates upstream failures without retrying", async () => {
    vi.mocked(fetchFlightsHtml).mockRejectedValue(new HttpError(429, 0));
    await expect(searchFlights(query)).rejects.toBeInstanceOf(HttpError);
    expect(fetchFlightsHtml).toHaveBeenCalledTimes(1);
  });

  it("enforces the deadline and cancels the request", async () => {
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
