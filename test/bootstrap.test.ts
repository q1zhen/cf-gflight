import { describe, expect, it, vi } from "vitest";
import { runInNewContext } from "../src/bootstrap";
import { html, payload, row } from "./fixtures";

describe("Worker bootstrap adapter", () => {
  it("reads JSON from the upstream callback format", () => {
    const callback = vi.fn();
    const script = html().replace(/^<script[^>]*>/, "").replace(/<\/script>$/, "");
    runInNewContext(script, { AF_initDataCallback: callback });
    expect(callback).toHaveBeenCalledWith({ data: JSON.parse(JSON.stringify(payload([row()]))) });
  });

  it.each([
    "AF_initDataCallback({key: 'ds:1',data:globalThis.hacked=true,sideChannel:{}});",
    "AF_initDataCallback({key: 'ds:1',data:[(()=>42)()],sideChannel:{}});",
    "AF_initDataCallback({key: 'ds:1',data:[],sideChannel:{}}); throw new Error('execute');",
    "AF_initDataCallback({key: 'ds:1',data:{},sideChannel:{}});",
  ])("rejects executable or non-array payloads", (script) => {
    const callback = vi.fn();
    expect(() => runInNewContext(script, { AF_initDataCallback: callback })).toThrow();
    expect(callback).not.toHaveBeenCalled();
  });
});
