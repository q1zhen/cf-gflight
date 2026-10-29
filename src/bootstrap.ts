// The upstream HTML parser uses node:vm for Google's bootstrap callback.
// Workers cannot evaluate JavaScript; extract only its JSON data instead.
export function runInNewContext(
  script: string,
  context: { AF_initDataCallback: (value: { data: unknown[] }) => void },
) {
  const start = /^\s*AF_initDataCallback\(\{key:\s*['"]ds:1['"],[\s\S]*?\bdata:\s*/.exec(script);
  const end = /,\s*sideChannel:\s*\{\}\s*\}\s*\);?\s*$/.exec(script);
  if (!start || !end) throw new Error("Unsupported Google bootstrap format");
  const data: unknown = JSON.parse(script.slice(start[0].length, end.index));
  if (!Array.isArray(data)) throw new Error("Expected a Google flight data array");
  context.AF_initDataCallback({ data });
}
