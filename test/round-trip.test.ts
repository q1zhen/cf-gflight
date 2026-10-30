import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import initialPayload from "./fixtures/round-trip-initial.json";
import returnPayload from "./fixtures/round-trip-return.json";
import { decodeQuery, flightsSearchResultSchema } from "google-flights-scraper";
import { searchFlights } from "../src/search";
import { html, leg, returnLeg, row, segment } from "./fixtures";

const fetchMock = vi.fn<typeof fetch>();
beforeEach(() => { fetchMock.mockReset(); vi.stubGlobal("fetch", fetchMock); });
afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); });
const query = { flights: [leg, returnLeg], trip: "round-trip" as const };
const inbound = (number = "2", hour = 9, price = 250) => row([segment(number, "LAX", "JFK", hour, [2027, 1, 27])], [], price);

describe("round-trip expansion", () => {
  it("parses captured Google round-trip responses and preserves return booking data", async () => {
    const captured = (data: unknown) => `<script>AF_initDataCallback({key: 'ds:1',data:${JSON.stringify(data)},sideChannel:{}});</script>`;
    fetchMock.mockResolvedValueOnce(new Response(captured(initialPayload)))
      .mockResolvedValueOnce(new Response(captured(returnPayload)));
    const result = await searchFlights({ ...query, currency: "USD" });
    expect(flightsSearchResultSchema.safeParse(result).success).toBe(true);
    expect(result.flights).toHaveLength(2);
    expect(result.flights.map((f) => f.segments.map((s) => s.flightNumber)))
      .toEqual([["B6123", "B6824"], ["B6123", "B6224"]]);
    expect(result.flights[0]).toMatchObject({ price: 357, totalDurationMinutes: 706,
      bookingToken: "fixture-booking-B6824JetBlue", stopCount: 0,
      carbon: { emission: 844000, typicalOnRoute: 677000 },
    });
    expect(result.metadata.locations.length).toBeGreaterThan(0);
    expect(result.flights[0].baggageLinks).toHaveLength(1);
    expect(result.flights[0].googleFlightsUrl).toContain("/travel/flights/booking?");
  });

  it("combines connected directions using the total fare, without counting the stay as a layover", async () => {
    const outbound = row([segment("1", "JFK", "ORD"), segment("2", "ORD", "LAX", 12)], [[60, "ORD", "Chicago"]], 200);
    const returning = row([segment("3", "LAX", "DFW", 9, [2027, 1, 27]), segment("4", "DFW", "JFK", 14, [2027, 1, 27])], [[180, "DFW", "Dallas"]], 350);
    fetchMock.mockResolvedValueOnce(new Response(html([outbound])))
      .mockResolvedValueOnce(new Response(html([returning])));
    const result = await searchFlights({ ...query, currency: "EUR", language: "de", region: "DE",
      passengers: { adults: 2, children: 1 }, seat: "business", maxStops: 1 });
    expect(flightsSearchResultSchema.safeParse(result).success).toBe(true);
    expect(result.flights[0]).toMatchObject({ price: 350, totalDurationMinutes: 480, stopCount: 2,
      segments: [{ flightNumber: "AA1" }, { flightNumber: "AA2" }, { flightNumber: "AA3" }, { flightNumber: "AA4" }],
      outbound: [{ flightNumber: "AA1" }, { flightNumber: "AA2" }],
      return: [{ flightNumber: "AA3" }, { flightNumber: "AA4" }],
      layovers: [{ durationMinutes: 60 }, { durationMinutes: 180 }],
      carbon: { emission: 200, typicalOnRoute: 400 },
    });
    const url = new URL(String(fetchMock.mock.calls[1][0]));
    expect(url.pathname).toBe("/travel/flights/search");
    expect(decodeQuery(url.searchParams.get("tfs")!)).toMatchObject({ ...query,
      flights: [{ ...leg, maxStops: 1 }, { ...returnLeg, maxStops: 1 }],
      seat: "business", passengers: { adults: 2, children: 1 },
    });
    expect(url.searchParams.get("curr")).toBe("EUR");
    expect(url.searchParams.get("hl")).toBe("de");
    expect(url.searchParams.get("gl")).toBe("DE");
    const selected = atob(url.searchParams.get("tfs")!.replace(/-/g, "+").replace(/_/g, "/"));
    expect(selected.charCodeAt(0)).toBe(26); // Google's compact search format, no page wrapper.
  });

  it("includes recommended-only results and filters each direction independently", async () => {
    fetchMock.mockResolvedValueOnce(new Response(html([], [
      row([segment("1", "JFK", "LAX", 7)]), row([segment("2", "JFK", "LAX", 9)]),
    ]))).mockResolvedValueOnce(new Response(html([], [inbound("3", 7), inbound("4", 9)])));
    const result = await searchFlights({ ...query, filters: { departureTime: { earliest: "09:00", latest: "12:00" }, arrivalTime: { latest: "11:00" } } });
    expect(result.flights).toHaveLength(1);
    expect(result.flights[0].segments.map((s) => s.flightNumber)).toEqual(["AA2", "AA4"]);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("enforces return layover and connection filters after selecting the outbound", async () => {
    fetchMock.mockResolvedValueOnce(new Response(html()))
      .mockResolvedValueOnce(new Response(html([
        row([segment("2", "LAX", "ORD", 9, [2027, 1, 27]), segment("3", "ORD", "JFK", 12, [2027, 1, 27])], [[60, "ORD", "Chicago"]]),
        row([segment("4", "LAX", "DEN", 9, [2027, 1, 27]), segment("5", "DEN", "JFK", 12, [2027, 1, 27])], [[60, "DEN", "Denver"]]),
        row([segment("6", "LAX", "ORD", 9, [2027, 1, 27]), segment("7", "ORD", "JFK", 15, [2027, 1, 27])], [[240, "ORD", "Chicago"]]),
      ])));
    const result = await searchFlights({ ...query, filters: { layover: { maxMinutes: 90 }, connectionAirports: { allow: ["ORD"] } } });
    expect(result.flights).toHaveLength(1);
    expect(result.flights[0].segments.map((s) => s.flightNumber)).toEqual(["AA1", "AA2", "AA3"]);
  });

  it.each(["outbound", "return"])("returns empty results when there are no %s matches", async (direction) => {
    fetchMock.mockResolvedValueOnce(new Response(html(direction === "outbound" ? [] : [row()])))
      .mockResolvedValueOnce(new Response(html([])));
    const result = await searchFlights(query);
    expect(result.flights).toEqual([]);
    expect(result.metadata.airlines).toEqual([{ code: "AA", name: "American" }]);
    expect(fetchMock).toHaveBeenCalledTimes(direction === "outbound" ? 1 : 2);
  });

  it("expands at most 20 outbounds with four concurrent lookups and stable result order", async () => {
    let active = 0, peak = 0, count = 0;
    fetchMock.mockResolvedValueOnce(new Response(html(Array.from({ length: 25 }, (_, i) => row([segment(String(100 + i))])))))
      .mockImplementation(async () => {
        const index = count++;
        active++; peak = Math.max(peak, active);
        await new Promise((resolve) => setTimeout(resolve, index % 2 ? 1 : 10));
        active--;
        return new Response(html([inbound(String(200 + index)), inbound(String(300 + index))]));
      });
    const result = await searchFlights(query);
    expect(fetchMock).toHaveBeenCalledTimes(21);
    expect(peak).toBe(4);
    expect(result.flights).toHaveLength(40);
    expect(result.flights.map((f) => f.segments[0].flightNumber)).toEqual(Array.from({ length: 20 }, (_, i) => [`AA${100 + i}`, `AA${100 + i}`]).flat());
  });

  it("fails instead of returning incomplete trips when an outbound cannot be selected", async () => {
    fetchMock.mockResolvedValueOnce(new Response(html([row([segment("")])])));
    await expect(searchFlights(query)).rejects.toMatchObject({ name: "ParseFlightsError" });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("cancels concurrent lookups on failure without starting queued work", async () => {
    const signals: AbortSignal[] = [];
    fetchMock.mockResolvedValueOnce(new Response(html(Array.from({ length: 6 }, (_, i) => row([segment(String(i + 1))])))))
      .mockImplementation((_url, init) => {
        signals.push(init!.signal!);
        if (signals.length === 2) return Promise.resolve(new Response("limited", { status: 429 }));
        return new Promise(() => {});
      });
    await expect(searchFlights(query)).rejects.toMatchObject({ name: "RateLimitError" });
    expect(fetchMock).toHaveBeenCalledTimes(5);
    expect(signals.every((signal) => signal.aborted)).toBe(true);
  });

  it("shares the 20-second deadline between the outbound and all returns", async () => {
    vi.useFakeTimers();
    fetchMock.mockImplementationOnce(async () => {
      await new Promise((resolve) => setTimeout(resolve, 15_000));
      return new Response(html());
    }).mockImplementation(() => new Promise(() => {}));
    const result = searchFlights(query);
    const assertion = expect(result).rejects.toMatchObject({ name: "TimeoutError" });
    await vi.advanceTimersByTimeAsync(15_000);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    await vi.advanceTimersByTimeAsync(5_000);
    await assertion;
    expect(fetchMock.mock.calls[1][1]!.signal!.aborted).toBe(true);
  });

  it("rejects Google error payloads rather than reporting an empty search", async () => {
    fetchMock.mockResolvedValueOnce(new Response(html()))
      .mockResolvedValueOnce(new Response(`<script>AF_initDataCallback({key: 'ds:1', data:[13,null,[]],errorHasStatus: true,});</script>`));
    await expect(searchFlights(query)).rejects.toMatchObject({ name: "FetchFlightsError" });
  });
});
