const __formaInt = (value: number): number => {
  if (!Number.isSafeInteger(value)) throw new RangeError("Int outside the safe integer range");
  return value === 0 ? 0 : value;
};

export const reversed = (xs: ReadonlyArray<number>): ReadonlyArray<number> => [...xs].reverse();

export const root = (x: number): number => Math.sqrt(x);

export const appended = (xs: ReadonlyArray<number>, x: number): ReadonlyArray<number> => [...xs, x];

export const concatenated = (
  xs: ReadonlyArray<number>,
  ys: ReadonlyArray<number>,
): ReadonlyArray<number> =>
  [...xs, ...ys];

export const collected = (
  init: ReadonlyArray<number>,
  xs: ReadonlyArray<number>,
): ReadonlyArray<number> =>
  xs.reduce<ReadonlyArray<number>>((acc, item) => [...acc, item], init);

export const quotient = (x: number, y: number): number => __formaInt(Math.trunc(x / y));
