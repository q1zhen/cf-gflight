// Upstream 0.2.0 treats any mention of "recaptcha" as a CAPTCHA. Normal Google
// pages also contain that text in shared scripts. Give its parser only ds:1
// when present; keep error/CAPTCHA pages intact for upstream error handling.
export const fetchFlightData: typeof fetch = async (input, init) => {
  const response = await fetch(input, init);
  if (!response.ok) return response;
  const html = await response.text();
  const script = html.match(/<script\b[^>]*>\s*AF_initDataCallback\(\{key:\s*['"]ds:1['"][\s\S]*?<\/script>/)?.[0];
  return new Response(script ?? html, {
    status: response.status, statusText: response.statusText,
    headers: { "Content-Type": "text/html; charset=utf-8" },
  });
};
