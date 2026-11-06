import { expect, test } from "vitest";
import { decodePreludeDemo, defaultPreludeDemo, encodePreludeDemo } from "./preludeShare";

test("a link preserves both files and a Unicode title without a server", () => {
  const demo = { ...defaultPreludeDemo, title: "My DSL λ 🐦" };
  const url = new URL(`https://forma-lang.com/playground/custom${encodePreludeDemo(demo)}`);
  expect(decodePreludeDemo(url.hash)).toEqual(demo);
});

test("invalid or incompatible links fall back safely", () => {
  for (const hash of ["", "#demo=broken", "#other=1"]) expect(decodePreludeDemo(hash)).toBeNull();
});
