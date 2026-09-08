import { describe, expect, it } from "vitest";
import { costOf, resolveRate } from "../src/rates/index.js";

describe("rates", () => {
  it("prices published models exactly and marks fallbacks assumed", () => {
    expect(resolveRate("claude-opus-5").mark).toBe("estimated");
    expect(resolveRate("claude-opus-5-20260301").key).toBe("claude-opus-5");
    expect(resolveRate("us.anthropic.claude-opus-5-20260301-v1:0").key).toBe("claude-opus-5");
    expect(resolveRate("claude-fable-5").rate.cache_read).toBe(1);
    expect(resolveRate("claude-fable-5-1").rate.cache_read).toBe(0.25);
    expect(resolveRate("opus").mark).toBe("assumed");
    expect(resolveRate("claude-zeta-9").mark).toBe("assumed");
  });
  it("resolves every id form Claude Code has used to a published rate: dated, bracketed, provider-prefixed, vertex, and the older name order", () => {
    for (const [id, key] of [
      ["claude-haiku-4-5-20251001", "claude-haiku-4-5"],
      ["claude-fable-5-1[1m]", "claude-fable-5-1"],
      ["anthropic.claude-sonnet-4-20250514-v1:0", "claude-sonnet-4"],
      ["claude-sonnet-4@20250514", "claude-sonnet-4"],
      ["claude-3-5-haiku-20241022", "claude-haiku-3-5"],
      ["claude-3-7-sonnet-20250219", "claude-sonnet-3-7"],
      ["claude-3-5-sonnet-20241022", "claude-sonnet-3-5"],
      ["claude-3-opus-20240229", "claude-opus-3"],
      ["claude-3-haiku-20240307", "claude-haiku-3"],
    ] as const) {
      const r = resolveRate(id);
      expect(r.key, id).toBe(key);
      expect(r.mark, id).toBe("estimated");
      expect(r.rate.provenance, id).toBe("published");
    }
    // an unknown Claude id still prices, by family, and says so
    expect(resolveRate("claude-sonnet-9").mark).toBe("assumed");
  });
  it("prices 1h cache writes at 2x and 5m at 1.25x", () => {
    const r = resolveRate("claude-opus-5").rate;
    expect(costOf({ input: 1e6, output: 0, cache_read: 0, cache_write_5m: 0, cache_write_1h: 0 }, r)).toBe(5);
    expect(costOf({ input: 0, output: 0, cache_read: 0, cache_write_5m: 1e6, cache_write_1h: 0 }, r)).toBe(6.25);
    expect(costOf({ input: 0, output: 0, cache_read: 0, cache_write_5m: 0, cache_write_1h: 1e6 }, r)).toBe(10);
    expect(costOf({ input: 0, output: 1e6, cache_read: 0, cache_write_5m: 0, cache_write_1h: 0 }, r)).toBe(25);
  });
});
