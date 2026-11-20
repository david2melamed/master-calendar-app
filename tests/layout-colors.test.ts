import { describe, expect, it } from "vitest";
import { paletteColorFor } from "@/lib/events/colors";
import { layoutDay } from "@/lib/events/layout";

const H = 3600_000;
const ev = (id: string, s: number, e: number) => ({ id, start: s * H, end: e * H });

describe("overlap layout", () => {
  it("a lone event takes the full width", () => {
    const l = layoutDay([ev("a", 9, 10)]);
    expect(l.get("a")).toMatchObject({ left: 0, width: 1 });
  });

  it("two overlapping events sit side by side", () => {
    const l = layoutDay([ev("a", 9, 11), ev("b", 10, 12)]);
    expect(l.get("a")).toMatchObject({ left: 0, width: 0.5 });
    expect(l.get("b")).toMatchObject({ left: 0.5, width: 0.5 });
  });

  it("back-to-back events don't count as overlapping", () => {
    const l = layoutDay([ev("a", 9, 10), ev("b", 10, 11)]);
    expect(l.get("a")!.width).toBe(1);
    expect(l.get("b")!.width).toBe(1);
  });

  it("reuses a freed column and expands into free space", () => {
    // a: 9-12 (col 0), b: 9-10 (col 1), c: 10-11 (col 1 again), d: 11-12 (col 1)
    const l = layoutDay([ev("a", 9, 12), ev("b", 9, 10), ev("c", 10, 11), ev("d", 11, 12)]);
    expect(l.get("a")!.cols).toBe(2);
    expect(l.get("c")).toMatchObject({ col: 1, left: 0.5 });
  });

  it("three-way overlap gives thirds; an event later in the cluster expands right", () => {
    const l = layoutDay([ev("a", 9, 12), ev("b", 9, 10), ev("c", 9, 10), ev("d", 10.5, 11.5)]);
    expect(l.get("a")).toMatchObject({ left: 0, width: 1 / 3 });
    expect(l.get("b")).toMatchObject({ left: 1 / 3, width: 1 / 3 });
    // d starts after b and c end → sits in column 1 and stretches over column 2
    expect(l.get("d")).toMatchObject({ col: 1, width: 2 / 3 });
  });

  it("separate clusters are independent", () => {
    const l = layoutDay([ev("a", 9, 10), ev("b", 9, 10), ev("c", 14, 15)]);
    expect(l.get("c")!.width).toBe(1);
  });
});

describe("palette mapping", () => {
  it("maps Google colors to the nearest refined color", () => {
    expect(paletteColorFor("#d50000")).toBe("#d0475f"); // tomato → rose
    expect(paletteColorFor("#33b679")).toBe("#3a9a5b"); // sage → green
    expect(paletteColorFor("#039be5")).toBe("#2b8fd6"); // peacock → sky
    expect(paletteColorFor("#616161")).toBe("#64748b"); // graphite → slate
    expect(paletteColorFor(null)).toBe("#3b6fe0");
  });
});
