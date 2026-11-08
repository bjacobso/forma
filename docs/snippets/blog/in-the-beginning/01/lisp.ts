// #region data
// A Lisp program is made of three things: numbers, symbols, and
// lists of programs. That is the whole syntax, and also the whole
// data model.
export type Sym = { readonly sym: string };
export type Sexp = number | Sym | ReadonlyArray<Sexp>;

export const sym = (name: string): Sym => ({ sym: name });
export const isSym = (x: Sexp): x is Sym =>
  typeof x === "object" && "sym" in x;
// #endregion data

// #region read
// The reader turns text into data. Pad the parentheses with spaces,
// split on whitespace, then build nested arrays.
export const read = (source: string): Sexp => {
  const tokens = source
    .replaceAll("(", " ( ")
    .replaceAll(")", " ) ")
    .split(/\s+/)
    .filter(Boolean);
  let position = 0;

  const next = (): Sexp => {
    const token = tokens[position++];
    if (!token) throw new SyntaxError("unexpected end of input");
    if (token === ")") throw new SyntaxError("unexpected )");
    if (token === "(") {
      const list: Sexp[] = [];
      while (tokens[position] !== ")") list.push(next());
      position++; // the closing ")"
      return list;
    }
    const isNumber = /^-?\d+(\.\d+)?$/.test(token);
    return isNumber ? Number(token) : sym(token);
  };

  const program = next();
  if (position < tokens.length) {
    throw new SyntaxError(`unexpected ${tokens[position]}`);
  }
  return program;
};
// #endregion read

// #region show
// The printer turns data back into text.
export const show = (x: Sexp): string =>
  typeof x === "number" ? String(x)
  : isSym(x) ? x.sym
  : `(${x.map(show).join(" ")})`;
// #endregion show

// #region evaluate
// Primitives receive evaluated arguments. They only accept numbers.
type Primitive = (args: ReadonlyArray<Sexp>) => Sexp;

const numbers = (op: string, args: ReadonlyArray<Sexp>) =>
  args.map((arg) => {
    if (typeof arg === "number") return arg;
    throw new TypeError(`${op} expects numbers, got ${show(arg)}`);
  });

const primitives: Record<string, Primitive> = {
  "+": (args) => numbers("+", args).reduce((a, b) => a + b, 0),
  "*": (args) => numbers("*", args).reduce((a, b) => a * b, 1),
};

export const evaluate = (x: Sexp): Sexp => {
  // A number means itself.
  if (typeof x === "number") return x;
  // There are no variables yet, so a bare symbol means nothing.
  if (isSym(x)) throw new ReferenceError(`${x.sym} is not defined`);

  const [head, ...rest] = x;
  if (head === undefined) {
    throw new SyntaxError("cannot evaluate ()");
  }
  if (!isSym(head)) {
    throw new TypeError(`${show(head)} is not an operator`);
  }

  // `quote` is the one special form: it returns its argument as
  // data, without evaluating it.
  if (head.sym === "quote") return rest[0] ?? [];

  const fn = primitives[head.sym];
  if (!fn) throw new ReferenceError(`${head.sym} is not defined`);
  return fn(rest.map(evaluate));
};
// #endregion evaluate
