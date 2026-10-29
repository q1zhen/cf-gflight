import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { decodeQuery, flightsSearchResultSchema } from "google-flights-scraper";
import { searchFlights } from "../src/search";
import { html, leg, row, segment } from "./fixtures";

const fetchMock = vi.fn<typeof fetch>();
beforeEach(() => { fetchMock.mockReset(); vi.stubGlobal("fetch", fetchMock); });
afterEach(() => vi.unstubAllGlobals());

describe("upstream integration", () => {
  it("uses one HTML request and returns the new schema with a detail link", async () => {
    fetchMock.mockResolvedValue(new Response(`<script>const routes = ["/recaptcha/challenge"];</script>${html()}`));
    const result = await searchFlights({ flights: [leg], currency: "EUR", region: "US", maxStops: 0 });
    expect(flightsSearchResultSchema.safeParse(result).success).toBe(true);
    expect(result.flights[0]).toMatchObject({ price: 129, stopCount: 0, segments: [{ flightNumber: "AA1" }] });
    expect(result.flights[0].googleFlightsUrl).toContain("/travel/flights/booking?");
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const url = new URL(String(fetchMock.mock.calls[0][0]));
    expect(url.pathname).toBe("/travel/flights/search");
    expect(url.searchParams.get("curr")).toBe("EUR");
    expect(url.searchParams.get("gl")).toBe("US");
    expect(decodeQuery(url.searchParams.get("tfs")!).flights[0]).toMatchObject({ ...leg, maxStops: 0 });
  });

  it("applies inclusive departure and final-arrival windows without extra requests", async () => {
    fetchMock.mockResolvedValue(new Response(html([
      row([segment("1", "JFK", "LAX", 7)]),
      row([segment("2", "JFK", "LAX", 9)]),
      row([segment("3", "JFK", "LAX", 12)]),
    ])));
    const result = await searchFlights({ flights: [leg], filters: {
      departureTime: { earliest: "09:00", latest: "12:00" }, arrivalTime: { latest: "11:00" },
    } });
    expect(result.flights.map((f) => f.segments[0].flightNumber)).toEqual(["AA2"]);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("filters each layover and connection airport", async () => {
    const options = [
      row([segment("1", "JFK", "ORD"), segment("2", "ORD", "LAX", 12)], [[60, "ORD", "ORD"]]),
      row([segment("3", "JFK", "DEN"), segment("4", "DEN", "LAX", 13)], [[120, "DEN", "DEN"]]),
      row([segment("5", "JFK", "ORD"), segment("6", "ORD", "LAX", 15)], [[240, "ORD", "ORD"]]),
    ];
    fetchMock.mockImplementation(async () => new Response(html(options)));
    const allowed = await searchFlights({ flights: [leg], filters: {
      layover: { minMinutes: 30, maxMinutes: 90 }, connectionAirports: { allow: ["ORD"] },
    } });
    expect(allowed.flights.map((f) => f.segments[0].flightNumber)).toEqual(["AA1"]);
    const blocked = await searchFlights({ flights: [leg], filters: { connectionAirports: { block: ["ORD"] } } });
    expect(blocked.flights.map((f) => f.segments[0].flightNumber)).toEqual(["AA3"]);
  });

  it("returns empty results and metadata when filters exclude every flight", async () => {
    fetchMock.mockResolvedValue(new Response(html()));
    const result = await searchFlights({ flights: [leg], filters: { departureTime: { earliest: "18:00" } } });
    expect(result.flights).toEqual([]);
    expect(result.metadata.airlines).toEqual([{ code: "AA", name: "American" }]);
  });

  it("still rejects actual CAPTCHA pages", async () => {
    fetchMock.mockResolvedValue(new Response("<html>Our systems have detected unusual traffic</html>"));
    await expect(searchFlights({ flights: [leg] })).rejects.toMatchObject({ name: "CaptchaError" });
  });

  it("does not retry rate-limited searches", async () => {
    fetchMock.mockResolvedValue(new Response("rate limited", { status: 429 }));
    await expect(searchFlights({ flights: [leg] })).rejects.toMatchObject({ name: "RateLimitError", status: 429 });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});
