import { ParseFlightsError } from "google-flights-scraper";
import { readFlightData } from "./bootstrap";

// Upstream 0.2.0 treats any mention of "recaptcha" as a CAPTCHA. Normal Google
// pages also contain that text in shared scripts. Give its parser only ds:1
// when present; keep error/CAPTCHA pages intact for upstream error handling.
export function flightDataFetch(includeSecondarySection = false): typeof fetch {
  return async (input, init) => {
    const response = await fetch(input, init);
    if (!response.ok) return response;
    const html = await response.text();
    let script = html.match(/<script\b[^>]*>\s*AF_initDataCallback\(\{key:\s*['"]ds:1['"][\s\S]*?<\/script>/)?.[0];
    if (script && /\berrorHasStatus\s*:\s*true\b/.test(script)) {
      throw new ParseFlightsError("Google returned a flight search error.");
    }
    if (script && includeSecondarySection) {
      const data = readFlightData(script.replace(/^<script\b[^>]*>/, "").replace(/<\/script>$/, ""));
      const rows = (section: unknown): unknown[] =>
        Array.isArray(section) && Array.isArray(section[0]) ? section[0] : [];
      // The HTML parser reads only section 3. Round trips also need Google's
      // recommended choices in section 2, including pages with only that section.
      data[3] = [[...rows(data[2]), ...rows(data[3])]];
      data[2] = null;
      script = `<script>AF_initDataCallback({key: 'ds:1',data:${JSON.stringify(data)},sideChannel:{}});</script>`;
    }
    return new Response(script ?? html, {
      status: response.status, statusText: response.statusText,
      headers: { "Content-Type": "text/html; charset=utf-8" },
    });
  };
}
