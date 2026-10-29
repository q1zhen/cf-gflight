import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import worker from "../src/index";
import { html, leg, returnLeg } from "./fixtures";

const fetchMock = vi.fn<typeof fetch>();
beforeEach(() => { fetchMock.mockReset(); vi.stubGlobal("fetch", fetchMock); });
afterEach(() => vi.unstubAllGlobals());
const search = async (body: unknown) => {
  const response = await worker.fetch(new Request("https://example.com/flights", {
    method: "POST", headers: { "Content-Type": "application/json", Origin: "https://app.example" },
    body: JSON.stringify(body),
  }));
  expect(response.headers.get("Access-Control-Allow-Origin")).toBe("*");
  return response;
};

describe("flight API", () => {
  it("serves the updated spec and browser preflights without contacting Google", async () => {
    const root = await worker.fetch(new Request("https://example.com/"));
    const spec = await root.text();
    expect(spec).toContain("fromAirport");
    expect(spec).toContain("departureTime");
    expect(spec).toContain("googleFlightsUrl");
    const response = await worker.fetch(new Request("https://example.com/flights", {
      method: "OPTIONS", headers: { Origin: "https://app.example", "Access-Control-Request-Method": "POST" },
    }));
    expect(response.status).toBe(204);
    expect(response.headers.get("Access-Control-Allow-Origin")).toBe("*");
    expect(response.headers.get("Access-Control-Allow-Headers")).toBe("Content-Type");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("checks health and rejects unsupported routes and methods", async () => {
    expect(await (await worker.fetch(new Request("https://example.com/health"))).json()).toEqual({ ok: true });
    expect((await worker.fetch(new Request("https://example.com/missing"))).status).toBe(404);
    const response = await worker.fetch(new Request("https://example.com/flights"));
    expect(response.status).toBe(405);
    expect(response.headers.get("Allow")).toBe("POST");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("rejects non-JSON and malformed JSON", async () => {
    expect((await worker.fetch(new Request("https://example.com/flights", { method: "POST", body: "hello" }))).status).toBe(415);
    expect((await worker.fetch(new Request("https://example.com/flights", {
      method: "POST", headers: { "Content-Type": "application/json" }, body: "{",
    }))).status).toBe(400);
  });

  it.each([
    null, {}, { flights: [] },
    { flights: [{ ...leg, date: "2027-02-30" }] },
    { flights: [{ ...leg, fromAirport: "INVALID" }] },
    { flights: [{ ...leg, toAirport: "JFK" }] },
    { flights: [leg, returnLeg] },
    { flights: [leg], trip: "round-trip" },
    { flights: [leg], seat: "standing" },
    { flights: [leg], maxStops: -1 },
    { flights: [leg], maxStops: null },
    { flights: [leg], passengers: { adults: 0 } },
    { flights: [leg], passengers: { adults: 1.5 } },
    { flights: [leg], passengers: { adults: 9, children: 1 } },
    { flights: [leg], passengers: { infantsOnLap: 2 } },
    { flights: [leg], filters: { departureTime: { earliest: "25:00" } } },
    { flights: [leg], filters: { arrivalTime: { earliest: "18:00", latest: "06:00" } } },
    { flights: [leg], filters: { layover: { minMinutes: 120, maxMinutes: 60 } } },
    { flights: [leg], filters: { connectionAirports: { allow: ["INVALID"] } } },
    { flights: [{ date: leg.date, from_airport: "JFK", to_airport: "LAX" }] },
    { flights: [leg], max_stops: 0 },
    { flights: [leg], filters: { departure_time: { earliest: "08:00" } } },
    { flights: [leg], passengers: { infants_on_lap: 1 } },
  ])("rejects invalid or old-format input before fetching: %j", async (body) => {
    const response = await search(body);
    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({ error: "Invalid search parameters", issues: expect.any(Array) });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("accepts the upstream camelCase interface and returns its result fields", async () => {
    fetchMock.mockResolvedValue(new Response(html()));
    const response = await search({ flights: [{ ...leg, fromAirport: " jfk ", airlines: ["aa"] }],
      currency: "usd", region: "us", passengers: { adults: 2, infantsInSeat: 1 },
      filters: { departureTime: { earliest: "08:00" }, connectionAirports: { block: ["ord"] } },
    });
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ flights: [{ segments: [{ flightNumber: "AA1" }],
      googleFlightsUrl: expect.any(String), totalDurationMinutes: 120,
    }], metadata: { baggageLinks: [], locations: [], flexibleDateInsight: null } });
  });

  it.each(["round-trip", "multi-city"])("keeps %s disabled without contacting Google", async (trip) => {
    const response = await search({ flights: [leg, returnLeg], trip });
    expect(response.status).toBe(422);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it.each(["rate-limit", "timeout", "bad-html"])("maps %s failures to JSON with CORS", async (mode) => {
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      if (mode === "rate-limit") fetchMock.mockResolvedValue(new Response("limited", { status: 429 }));
      if (mode === "timeout") fetchMock.mockRejectedValue(new DOMException("Timed out", "TimeoutError"));
      if (mode === "bad-html") fetchMock.mockResolvedValue(new Response("<html>bad</html>"));
      const response = await search({ flights: [leg] });
      expect(response.status).toBe(mode === "timeout" ? 504 : 502);
      expect(await response.json()).toEqual({ error: mode === "timeout" ? "Flight search timed out" : "Unable to fetch flights from Google" });
    } finally { log.mockRestore(); }
  });
});
