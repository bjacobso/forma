---
title: Structure and Interpretation of Forma Programs
description: An introduction to Forma in the spirit of SICP. Functions, processes, data abstraction, symbolic data, state, streams, interpreters, macros, and typed forms, with every example run on the current engine.
---

# Structure and Interpretation of Forma Programs

This chapter introduces Forma by following the path of *Structure and
Interpretation of Computer Programs* (Abelson, Sussman, and Sussman). It starts
with expressions and names. Then it covers functions and the processes they
generate, building data abstractions, symbolic data, state, and delayed
evaluation. It ends where SICP ends: an evaluator is just another program, so
a new language can be just another library.

Like Scheme, Forma is a Lisp: programs are parenthesized expressions, functions
are values, and code can be treated as data. Unlike Scheme, Forma is typed. It
infers a type for every expression, checks it against the signatures you write,
and records in each type what an operation can fail with and which
capabilities it needs. This chapter points out where that changes the way a
classic program is written.

Every example below has been run on the current TypeScript engine. Forma is
pre-alpha; where a classic program needs a workaround today, the text says so.

## Running the examples

The easiest place to try an example is the
[full-pipeline playground](https://forma-lang.com/playground/demo/full-pipeline):
replace its source and it reads, expands, typechecks, and evaluates the new
program in your browser. From a checkout, the `forma` JSON CLI does the same:

```sh
pnpm install --frozen-lockfile
pnpm --filter @formalang/ts build && pnpm --filter @formalang/host build
node packages/host/dist/cli.mjs request '{"op":"evaluate","source":"(+ 137 349)"}'
# {"ok":true,"value":{"kind":"int","value":486},"diagnostics":[]}
node packages/host/dist/cli.mjs request '{"op":"typecheck","source":"(+ 137 349)"}'
```

In the examples, `; =>` marks the value an expression evaluates to. The
definitions in chapters 1 and 2 build on one another and form a single
program. The effect examples in sections 3.1 and 3.2, the stream program in
section 3.3, and the interpreter in section 4.1 each start fresh.

## 1 Building abstractions with functions

### 1.1 The elements of programming

Every powerful language gives you three things: primitive expressions,
ways to combine them, and ways to abstract, that is, to name a combination
and treat it as a unit. Forma starts with the same three.

#### Expressions

Type a number and you get the number back. A **combination** is a list in
parentheses: the first element is an operator and the rest are operands.

```lisp
486            ; => 486
(+ 137 349)    ; => 486
(* 5 99)       ; => 495
(+ 21 35 12 7) ; => 75
(+ (* 3 5) (- 10 6)) ; => 19
```

Prefix notation lets an operator take any number of arguments and nests
without precedence rules. The first difference from Scheme is in the numbers:
Forma has two numeric types and keeps them apart.

```lisp
(/ 10 4)   ; => 2.5   division always produces a Float
(/ 10 5)   ; => 2.0   still a Float, even when the result is whole
(+ 2.7 10) ; => 12.7  an Int is accepted where a Float is expected
(mod 10 4) ; => 2     mod requires Ints
```

`1` is an `Int` and `1.0` is a `Float`. `+`, `-`, and `*` return an Int when
every operand is an Int. Ints are limited to JavaScript's safe-integer range,
and arithmetic that overflows fails instead of wrapping. The
[language guide](./language.md#values-and-expressions) has the full rules.

#### Naming and the environment

`define` associates a name with a value:

```lisp
(define size 2)
(* 5 size) ; => 10

(define pi 3.14159)
(define radius 10.0)
(* pi (* radius radius)) ; => 314.159
```

The interpreter keeps a memory of name/value pairs, called the
**environment**. Naming is the simplest means of abstraction: once `pi` has a
name, nobody has to remember the digits.

#### Evaluating combinations

To evaluate a combination, Forma evaluates the operator and the operands, then
applies the function to the argument values. This rule is recursive, because
operands can themselves be combinations. Evaluating

```lisp
(* (+ 2 (* 4 6))
   (+ 3 5 7))
```

works up the tree from the leaves: `(* 4 6)` is `24`, `(+ 2 24)` is `26`,
`(+ 3 5 7)` is `15`, and the whole is `390`.

`define` does not follow this rule. `(define size 2)` does not apply a function
called `define` to two arguments. It names a value. Expressions with their own
evaluation rules are **special forms**: `define`, `if`, `fn`, `let`, `match`,
and `quote`. Forms such as `cond`, `when`, `and`, and `or` are **macros**,
defined in Forma source. Section 4.2 covers how they work.

#### Compound functions

A function definition names a computation:

```lisp
(: square (-> Int Int))
(define square [x] (* x x))
```

Read this as: "`square` has type `Int` to `Int`. To square something, multiply
it by itself." The parameter list is in square brackets. The line beginning
with `:` is a **signature**. It is optional: without it, Forma infers a type.
Write one when the inferred type is not the one you mean. Here, inference alone
would choose `Float -> Float`, because arithmetic on otherwise unconstrained
values defaults to Float.

Compound functions are used exactly like primitives, and they compose:

```lisp
(: sum-of-squares (-> Int Int Int))
(define sum-of-squares [x y] (+ (square x) (square y)))

(: f (-> Int Int))
(define f [a] (sum-of-squares (+ a 1) (* a 2)))

(f 5) ; => 136
```

#### The substitution model

Because these functions have no side effects, you can understand
`(f 5)` by substitution: replace each parameter with its argument and reduce.

```lisp
(f 5)
(sum-of-squares (+ 5 1) (* 5 2))
(+ (square 6) (square 10))
(+ (* 6 6) (* 10 10))
(+ 36 100)
136
```

The model stays valid for everything in chapters 1 and 2. In chapter 3, Forma
does not drop the model; it marks the places where it no longer applies.

#### Conditional expressions

`cond` picks the first clause whose test is true. `:else` matches
everything else.

```lisp
(: absolute (-> Int Int))
(define absolute [x]
  (cond (> x 0) x
        (= x 0) 0
        :else (- x)))

(absolute -3) ; => 3
```

`if` takes a test, a consequent, and an alternative. A Forma test must
be a `Bool`. There is no truthiness, so `(if 1 2 3)` is rejected before it
runs:

```text
typecheck/type-mismatch: Type mismatch: Int vs Bool
```

Both branches of an `if` must also have a common type. Scheme leaves these
mistakes to run time; Forma's checker reports them at the expression where
they occur.

#### Example: square roots by Newton's method

Mathematical functions describe properties; computer functions describe
methods. To compute √x, start with a guess and keep averaging it with
x / guess until it is good enough:

```lisp
(: average (-> Float Float Float))
(define average [x y] (/ (+ x y) 2))

(: improve (-> Float Float Float))
(define improve [guess x] (average guess (/ x guess)))

(: good-enough? (-> Float Float Bool))
(define good-enough? [guess x]
  (< (abs (- (* guess guess) x)) 0.001))

(: sqrt-iter (-> Float Float Float))
(define sqrt-iter [guess x]
  (if (good-enough? guess x)
      guess
      (sqrt-iter (improve guess x) x)))

(: square-root (-> Float Float))
(define square-root [x] (sqrt-iter 1.0 x))

(square-root 9.0) ; => 3.00009155413138
(square-root 2.0) ; => 1.4142156862745097
```

There is no special looping construct. Iteration is a function that calls
itself.

**Block structure.** SICP next moves the helpers inside `square-root` so the
names don't leak. Forma's `let` binds names lexically, but its bindings are
not recursive, so a self-calling helper such as `sqrt-iter` can't be written
with `let`. Nested `define` inside a function body evaluates, but the
typechecker does not accept it yet. For now, keep recursive helpers at the top
level, and use a [file module](./modules.md) to hide them. A module's
definitions are private unless it lists them in `export`.
[RFC 0019](https://github.com/bjacobso/forma/blob/main/docs/rfcs/0019-everyday-checker-gaps.md) proposes typing internal definitions as a local recursive
group, which would let these helpers move inside `square-root`.

> **Exercise 1.1.** `good-enough?` works poorly for very small and very large
> numbers. Rewrite it to stop when the guess changes by less than a small
> fraction of itself.

### 1.2 Functions and the processes they generate

A function is a pattern for the *local evolution* of a computation. Knowing
the overall shape of the process it generates is how you learn to predict
cost.

#### Linear recursion and iteration

Two factorials compute the same function and generate different processes:

```lisp
(: factorial (-> Int Int))
(define factorial [n]
  (if (= n 1)
      1
      (* n (factorial (- n 1)))))

(: fact-iter (-> Int Int Int Int))
(define fact-iter [product counter max-count]
  (if (> counter max-count)
      product
      (fact-iter (* counter product) (+ counter 1) max-count)))

(: factorial-iterative (-> Int Int))
(define factorial-iterative [n] (fact-iter 1 1 n))

(factorial 6)           ; => 720
(factorial-iterative 6) ; => 720
```

Use the substitution model on `(factorial 6)`. The expression grows into a
chain of deferred multiplications, then shrinks as they are performed: a
**linear recursive process**. `(factorial-iterative 6)` does not grow. At
every step, the state is fully described by three numbers, `product`,
`counter`, and `max-count`: a **linear iterative process**.

Both are *recursive functions*, because each refers to itself. Only one is a
recursive process. Forma's VM compiles a call in tail position as a tail
call, so an iterative process runs without a growing chain of pending
work. Each step still counts against the evaluator's **step limit**. The
host sets this budget (for example, the `stepLimit` field of an `evaluate`
request), and it keeps runaway programs from hanging an editor or a build.

#### Tree recursion

```lisp
(: fib (-> Int Int))
(define fib [n]
  (cond (= n 0) 0
        (= n 1) 1
        :else (+ (fib (- n 1)) (fib (- n 2)))))

(fib 10) ; => 55
```

Each call branches into two, so the process is a tree, and its size grows
exponentially with `n`. Tree recursion is wasteful here, but it is the natural
fit for problems that branch. A classic example: how many ways can you make
change for a dollar with half-dollars, quarters, dimes, nickels, and pennies?

```lisp
(: first-denomination (-> Int Int))
(define first-denomination [kinds-of-coins]
  (cond (= kinds-of-coins 1) 1
        (= kinds-of-coins 2) 5
        (= kinds-of-coins 3) 10
        (= kinds-of-coins 4) 25
        :else 50))

(: cc (-> Int Int Int))
(define cc [amount kinds-of-coins]
  (cond (= amount 0) 1
        (or (< amount 0) (= kinds-of-coins 0)) 0
        :else (+ (cc amount (- kinds-of-coins 1))
                 (cc (- amount (first-denomination kinds-of-coins))
                     kinds-of-coins))))

(: count-change (-> Int Int))
(define count-change [amount] (cc amount 5))

(count-change 100) ; => 292
```

The function says exactly what the problem says: count the ways that skip the
first kind of coin, plus the ways that use it at least once.

#### Greatest common divisors

Euclid's algorithm generates an iterative process whose number of steps grows
logarithmically:

```lisp
(: gcd (-> Int Int Int))
(define gcd [a b]
  (if (= b 0)
      a
      (gcd b (mod a b))))

(gcd 206 40) ; => 2
```

> **Exercise 1.2.** Write `fib` as an iterative process with two state
> variables. Compare how far each version gets under the same step limit.

### 1.3 Formulating abstractions with higher-order functions

A language that can name only numbers is weak. Functions that take and return
functions let you name *patterns of computation*.

#### Functions as arguments

These three sums share a shape: a term to add, and a way to get from one index
to the next.

```lisp
(: sum (-> (-> Int Int) Int (-> Int Int) Int Int))
(define sum [term a next b]
  (if (> a b)
      0
      (+ (term a) (sum term (next a) next b))))

(: inc (-> Int Int))
(define inc [n] (+ n 1))

(: cube (-> Int Int))
(define cube [n] (* n n n))

(: identity (-> Int Int))
(define identity [n] n)

(: sum-cubes (-> Int Int Int))
(define sum-cubes [a b] (sum cube a inc b))

(: sum-integers (-> Int Int Int))
(define sum-integers [a b] (sum identity a inc b))

(sum-cubes 1 10)      ; => 3025
(sum-integers 1 100)  ; => 5050
```

`sum`'s signature reads like its description: it takes a term function, a
lower bound, a next function, and an upper bound.

#### `fn` and `let`

`fn` makes a function without naming it, and `let` names values for the
length of one expression. Later `let` bindings can refer to earlier ones:

```lisp
((fn [x y] (+ x y)) 1 2)      ; => 3
(let [x 3 y (+ x 1)] (* x y)) ; => 12
```

There is one numeric rough edge. When an anonymous function does arithmetic on
its own parameters, inference currently types those parameters as `Float`. If
the function has to be `Int -> Int`, name it with a signature, as `inc` and
`cube` are named above, or ascribe it in place:
`(: (fn [x y] (+ x y)) (-> Int Int Int))`. [RFC 0019](https://github.com/bjacobso/forma/blob/main/docs/rfcs/0019-everyday-checker-gaps.md) proposes numeric
inference that removes this edge.

#### Functions as returned values

A fixed point of `f` is an `x` where `f(x) = x`. For some functions, you can
find one by applying `f` repeatedly until the value stops changing:

```lisp
(: tolerance Float)
(define tolerance 0.00001)

(: close-enough? (-> Float Float Bool))
(define close-enough? [a b] (< (abs (- a b)) tolerance))

(: fixed-point (-> (-> Float Float) Float Float))
(define fixed-point [f guess]
  (let [next (f guess)]
    (if (close-enough? guess next)
        next
        (fixed-point f next))))
```

Square roots are fixed points of `y ↦ x / y`, but that search oscillates.
**Average damping** fixes the oscillation. It is a function that takes a
function and returns a new one:

```lisp
(: average-damp (-> (-> Float Float) (-> Float Float)))
(define average-damp [f] (fn [x] (average x (f x))))

(: sqrt-by-fixed-point (-> Float Float))
(define sqrt-by-fixed-point [x]
  (fixed-point (average-damp (fn [y] (/ x y))) 1.0))

(sqrt-by-fixed-point 2.0) ; => 1.4142135623746899
```

The derivative is another operator on functions. With it, Newton's method is a
fixed-point search:

```lisp
(: dx Float)
(define dx 0.00001)

(: derivative (-> (-> Float Float) (-> Float Float)))
(define derivative [g] (fn [x] (/ (- (g (+ x dx)) (g x)) dx)))

(: newtons-method (-> (-> Float Float) Float Float))
(define newtons-method [g guess]
  (fixed-point (fn [x] (- x (/ (g x) ((derivative g) x)))) guess))

((derivative (fn [x] (* x x x))) 5.0)               ; => 75.00014999664018
(newtons-method (fn [y] (- (* y y) 2.0)) 1.0)       ; => 1.4142135623822438
```

Each of these signatures is a sentence: `derivative` takes a function from Float
to Float and returns one.

Inference handles the general case without help. Leave the signature off
`compose` and ask the typechecker for its type:

```lisp
(define compose [f g] (fn [x] (f (g x))))
```

```text
(t6 -{e7}-> t7) -> (t8 -{e7}-> t6) -> t8 -{e7}-> t7
```

The `t` variables say `compose` works for functions of any types that line up.
The `{e7}` on each arrow is an **effect variable**. It says `compose` performs
whatever effects `f` and `g` perform, and no others. That is the first sign of
chapter 3's subject.

> **Exercise 1.3.** Define `(twice f)`, which applies `f` twice, and predict
> the value of `((twice (twice inc)) 5)` before running it.

## 2 Building abstractions with data

### 2.1 Introduction to data abstraction

To build rational-number arithmetic, you need to glue a numerator and a
denominator together. In Forma, that glue is a record, and its shape can be
named:

```lisp
(type Rat {:numer Int :denom Int})

(: make-rat (-> Int Int Rat))
(define make-rat [n d]
  (let [g (gcd n d)]
    {:numer (quot n g) :denom (quot d g)}))

(: numer (-> Rat Int))
(define numer [x] x.numer)

(: denom (-> Rat Int))
(define denom [x] x.denom)
```

`x.numer` reads the `:numer` field of `x`. `quot` divides Ints and truncates
toward zero. Here the gcd divides both inputs exactly; `/` would instead
produce a Float.

Arithmetic is defined only in terms of the constructor and selectors:

```lisp
(: add-rat (-> Rat Rat Rat))
(define add-rat [x y]
  (make-rat (+ (* (numer x) (denom y)) (* (numer y) (denom x)))
            (* (denom x) (denom y))))

(: mul-rat (-> Rat Rat Rat))
(define mul-rat [x y]
  (make-rat (* (numer x) (numer y)) (* (denom x) (denom y))))

(: equal-rat? (-> Rat Rat Bool))
(define equal-rat? [x y]
  (= (* (numer x) (denom y)) (* (numer y) (denom x))))

(: show-rat (-> Rat String))
(define show-rat [x] (str (numer x) "/" (denom x)))

(define one-half (make-rat 1 2))
(define one-third (make-rat 1 3))

(show-rat (add-rat one-half one-third))  ; => "5/6"
(show-rat (mul-rat one-half one-third))  ; => "1/6"
(show-rat (add-rat one-third one-third)) ; => "2/3"
```

This is an **abstraction barrier**. Programs that use rational numbers call
`add-rat`. `add-rat` calls `make-rat`, `numer`, and `denom`. Only those three
know that a rational is a record. SICP enforces the barrier by convention. In
Forma, the type `Rat` also states it: a record missing `:denom`, or with a
misspelled field, is rejected with `Missing field(s) in record` where it is
written. A type does not hide the representation, though. To do that, put the
constructor and selectors in a [module](./modules.md) and export only them.

> **Exercise 2.1.** Make `make-rat` normalize signs, so that the denominator is
> always positive.

### 2.2 Hierarchical data and the closure property

Square brackets build lists. A list's elements share a type, so `[1 2 3]` is a
`(List Int)`. `map` and `filter` are built in, and patterns take lists apart:

```lisp
(map (fn [x] (* x x)) [1 2 3 4 5])        ; => (1 4 9 16 25)
(filter (fn [x] (> x 2)) [1 2 3 4 5])     ; => (3 4 5)
(first [1 2 3])                           ; => 1
(let [[head & tail] [1 2 3]] tail)        ; => (2 3)
```

SICP builds every list from pairs and then builds trees from lists. The
property that lets this work is **closure**: the result of combining things can
be combined again. Forma's built-in lists support typed `conj` (append an
element), `concat` (combine two lists), and `reduce` (accumulate a result).
To study SICP's pair-based representation rather than the built-in list,
this section builds the pairs itself and gives them a type. The definition
says what a sequence is: either the end, or a link with a first element and
the rest of the sequence.

```lisp
(type (Chain a)
  (Tagged
    End
    (Link {:first a :rest (Chain a)})))

(: link (-> a (Chain a) (Chain a)))
(define link [x chain] (Chain.Link {:first x :rest chain}))
```

`(Chain a)` is a generic type. A `(Chain Int)` and a `(Chain String)` are
different types, and one definition serves both. Constructors are qualified by
their type: `Chain.End`, `Chain.Link`. `match` takes a chain apart by its
constructors:

```lisp
(: enumerate-interval (-> Int Int (Chain Int)))
(define enumerate-interval [low high]
  (if (> low high)
      Chain.End
      (link low (enumerate-interval (+ low 1) high))))

(: map-chain (-> (-> a b) (Chain a) (Chain b)))
(define map-chain [f chain]
  (match chain
    End Chain.End
    (Link {:first x :rest more}) (link (f x) (map-chain f more))))

(: filter-chain (-> (-> a Bool) (Chain a) (Chain a)))
(define filter-chain [keep? chain]
  (match chain
    End Chain.End
    (Link {:first x :rest more})
      (if (keep? x)
          (link x (filter-chain keep? more))
          (filter-chain keep? more))))

(: accumulate (-> (-> a b b) b (Chain a) b))
(define accumulate [op initial chain]
  (match chain
    End initial
    (Link {:first x :rest more}) (op x (accumulate op initial more))))
```

#### Sequences as conventional interfaces

With these pieces, a program can be organized like a signal-processing
diagram: enumerate, filter, map, accumulate.

```lisp
(: odd? (-> Int Bool))
(define odd? [n] (= (mod n 2) 1))

(: add (-> Int Int Int))
(define add [x y] (+ x y))

(: sum-odd-squares (-> Int Int Int))
(define sum-odd-squares [low high]
  (accumulate add 0
    (map-chain square
      (filter-chain odd? (enumerate-interval low high)))))

(sum-odd-squares 1 10) ; => 165
```

Each stage has a type, and the stages connect only when the types line up.
Pass `odd?` to `map-chain` instead of `square` and the result is a
`(Chain Bool)`. The checker rejects that argument to `accumulate add` with
`Type mismatch: Bool vs Int`.

> **Exercise 2.2.** Define `(flatmap f chain)` and use it to enumerate all
> pairs `i`, `j` with `1 ≤ j < i ≤ n`.

### 2.3 Symbolic data

#### Quotation

So far, all data has been numbers, strings, and structures built from them.
SICP next introduces symbols, by quoting:

```lisp
(quote x)    ; => x
'(+ x 3)     ; => (+ x 3)
```

A quoted expression is not evaluated; it is returned as data. Forma keeps three
kinds of names apart. `'ready` is a symbol, `:ready` is a keyword, and
`"ready"` is a string. They are never equal, and the typechecker rejects
`(= :ready "ready")` as a type mismatch before it can run.

This is where a typed Lisp has to make a choice. In Scheme, `'(+ x 3)` is a list,
and any function can take it apart with `car` and `cdr`. In Forma, a quoted
form has type `Syntax`. Ordinary typed code can pass it around, but can't
take it apart: `(first '(+ 1 2))` is rejected with
`Cannot unify Syntax with List<t0>`. Code that inspects syntax runs at expansion
time, inside macros and forms (chapter 4). Runtime code that does symbolic
manipulation gives its expressions a type of their own.

#### Example: symbolic differentiation

SICP's symbolic differentiator works on algebraic expressions written as lists.
Here is the same program with the expression shape stated once as a type:

```lisp
(type Expr
  (Tagged
    (Num {:value Int})
    (Var {:name Symbol})
    (Sum {:left Expr :right Expr})
    (Product {:left Expr :right Expr})))
```

SICP's predicates `number?`, `variable?`, `sum?`, and `product?`, and its
selectors `addend` and `multiplicand`, become patterns. The differentiation rules
read almost exactly as they do in calculus:

```lisp
(: deriv (-> Expr Symbol Expr))
(define deriv [expr var]
  (match expr
    (Num _) (Expr.Num {:value 0})
    (Var {:name name}) (Expr.Num {:value (if (= name var) 1 0)})
    (Sum {:left u :right v}) (make-sum (deriv u var) (deriv v var))
    (Product {:left u :right v})
      (make-sum (make-product u (deriv v var))
                (make-product (deriv u var) v))))
```

The constructors simplify as they build. A vector pattern matches two values
at once, and literal patterns pick out zeros and ones:

```lisp
(: make-sum (-> Expr Expr Expr))
(define make-sum [a b]
  (match [a b]
    [(Num {:value 0}) _] b
    [_ (Num {:value 0})] a
    [(Num {:value x}) (Num {:value y})] (Expr.Num {:value (+ x y)})
    _ (Expr.Sum {:left a :right b})))

(: make-product (-> Expr Expr Expr))
(define make-product [a b]
  (match [a b]
    [(Num {:value 0}) _] (Expr.Num {:value 0})
    [_ (Num {:value 0})] (Expr.Num {:value 0})
    [(Num {:value 1}) _] b
    [_ (Num {:value 1})] a
    [(Num {:value x}) (Num {:value y})] (Expr.Num {:value (* x y)})
    _ (Expr.Product {:left a :right b})))

(: show (-> Expr String))
(define show [expr]
  (match expr
    (Num {:value value}) (str value)
    (Var {:name name}) (str name)
    (Sum {:left u :right v}) (str "(+ " (show u) " " (show v) ")")
    (Product {:left u :right v}) (str "(* " (show u) " " (show v) ")")))
```

```lisp
(define x (Expr.Var {:name 'x}))
(define y (Expr.Var {:name 'y}))
(define three (Expr.Num {:value 3}))

(show (deriv (make-sum x three) 'x))     ; => "1"
(show (deriv (make-product x y) 'x))     ; => "y"
(show (deriv (make-product (make-product x y) (make-sum x three)) 'x))
; => "(+ (* x y) (* y (+ x 3)))"
```

These are the answers SICP gets. What the type adds: an expression that is not
a number, variable, sum, or product cannot be built, so `deriv` never needs an
`else` clause that reports an unknown expression type.

> **Exercise 2.3.** Add `(Power {:base Expr :exponent Int})` and the rule
> d(uⁿ)/dx = n·uⁿ⁻¹·du/dx. Before you write the new `deriv` clause, run the
> typechecker and see which functions it reports as incomplete.

### 2.4 Multiple representations and generic operations

A tagged type is a set of representations, and a function that matches on it
is a **generic operation**: it dispatches on the tag.

```lisp
(type Shape
  (Tagged
    (Circle {:radius Float})
    (Rect {:width Float :height Float})))

(: area (-> Shape Float))
(define area [shape]
  (match shape
    (Circle {:radius r}) (* 3.14159 r r)
    (Rect {:width w :height h}) (* w h)))

(map area [(Shape.Circle {:radius 1.0}) (Shape.Rect {:width 2.0 :height 3.0})])
; => (3.14159 6.0)
```

SICP describes two ways to organize this. *Dispatching on type*: each
operation knows every representation. *Data-directed programming*: a table
indexed by operation and type. In both styles, the hard part is bookkeeping.
When a representation is added, something must find every operation that
needs a new case.

Forma's checker does that bookkeeping. Add `(Triangle {:a Float :b Float :c Float})`
to `Shape`, and every `match` that doesn't handle it is reported where it is
written:

```text
warning typecheck/diagnostic: Non-exhaustive match: missing constructor(s) Triangle
```

The kernel typechecker reports this as a warning. The Effect checker, used in
chapter 3 and in [domain modeling](./domain-modeling.md), treats a
non-exhaustive match as an error. Because an unmatched value fails at run time
with `No pattern matched the value`, [RFC 0019](https://github.com/bjacobso/forma/blob/main/docs/rfcs/0019-everyday-checker-gaps.md) proposes making it an error
in both.

> **Exercise 2.4.** SICP's message-passing style represents a shape as a
> function from an operation name to a result. Write `make-circle` that way,
> returning `(fn [op] ...)`. What does the type of the result force you to
> decide?

## 3 Modularity, objects, and state

So far, every function has been pure: its result depends only on its arguments,
and calling it changes nothing. That is why the substitution model works.
Chapter 3 of SICP introduces assignment, and with it time, identity, and an
environment model of evaluation to replace substitution.

Forma doesn't give ordinary functions a hidden way to change the world.
Instead, change is part of the type. An operation that reads or writes state,
can fail, or needs a capability has an `Effect` type:

```text
(Effect Success [Errors] [Requirements])
```

The type lists the value the operation produces, every failure it can raise,
and every capability it uses. A reader can learn all three without reading the
body.

### 3.1 Assignment and local state

SICP's first stateful object is a bank account that can refuse a withdrawal.
In Forma, the balance is a `Ref`, a mutable cell that can only be read or
written inside an effect, and the refusal is a typed error:

```lisp
(error InsufficientFunds {:balance Int :requested Int})

(: withdraw (-> (Ref Int) Int (Effect Int [InsufficientFunds])))
(define withdraw [account amount]
  (do! [balance (ref-get account)
        _ (when (> amount balance)
            (fail (InsufficientFunds {:balance balance :requested amount})))
        _ (ref-set account (- balance amount))]
    (- balance amount)))

(: demo (Effect (List Int) [InsufficientFunds]))
(define demo
  (do! [account (ref-make 100)
        a (withdraw account 25)
        b (withdraw account 25)]
    [a b]))
```

`do!` runs effects in order and binds their results, like Haskell's `do`
notation or Effect's `Effect.gen`. The signature of `withdraw` says it returns
an Int, can fail only with `InsufficientFunds`, and needs nothing from its
environment.

Programs with Effect types are checked by Forma's Effect checker and compiled
to [Effect](https://effect.website) TypeScript, which runs them. To try one,
use the [Effect playground](https://forma-lang.com/playground/demo/effect-ts),
or call `Mechanics.generateEffectProgram` from `@formalang/ts`. The checker
holds operations to their signatures. Delete `[InsufficientFunds]` from the
signature of `withdraw`, and the `fail` call is reported:

```text
7:19 mechanics/undeclared-error
Operation withdraw can fail with InsufficientFunds, but its signature declares no errors.
```

The generated code is ordinary Effect:

```ts
export const withdraw = (
  account: Ref.Ref<number>,
  amount: number,
): Effect.Effect<number, InsufficientFunds> =>
  Effect.gen(function* () {
    const balance = yield* Ref.get(account);
    if (amount > balance) {
      yield* Effect.fail(new InsufficientFunds({ balance, requested: amount }));
    }
    yield* Ref.set(account, __formaInt(balance - amount));
    return __formaInt(balance - amount);
  });
```

### 3.2 Capabilities instead of globals

SICP's objects reach the outside world through free variables in their
environments. Forma names that dependency as a **service**, and an operation
that uses one lists it in its requirements:

```lisp
(service Clock (: now (Effect Int)))

(: seconds-until (-> Int (Effect Int [] [Clock.now])))
(define seconds-until [deadline]
  (do! [now Clock.now]
    (max 0 (- deadline now))))
```

`seconds-until` can read the clock, and the signature says it can do nothing
else. The program does not choose an implementation. A `layer` supplies one,
whether a real clock, a fixed test clock, or anything else. The
[Effect reference](./effect/reference.md) covers services, layers, resources,
and concurrency.

### 3.3 Streams

SICP's other answer to modeling time is to model a changing quantity as an
infinite **stream** of values. The stream is computed only as far as someone
looks. Its key ingredient is a *delayed* tail: the rest of the stream is a
promise to compute it later. Like Scheme, Forma evaluates a function's
arguments before its body runs, so a delayed tail has to be wrapped in a
function.

A stream is a head and a function that produces the rest:

```lisp
(type (Flow a) (Tagged (Cell {:head a :tail (-> Unit (Flow a))})))

(: stream-first (-> (Flow a) a))
(define stream-first [stream]
  (match stream (Cell {:head head}) head))

(: stream-rest (-> (Flow a) (Flow a)))
(define stream-rest [stream]
  (match stream (Cell {:tail tail}) (tail nil)))
```

Three details here are workarounds. The type is called `Flow` because a
program that declares its own `Stream` type is currently mistaken for an
Effect program. The tail takes a `Unit` argument because Forma has no type for
zero-argument functions yet. And the stream is a one-constructor `Tagged` type
because a recursive generic record alias is rejected. [RFC 0019](https://github.com/bjacobso/forma/blob/main/docs/rfcs/0019-everyday-checker-gaps.md) proposes
fixing all three.

Now try the obvious constructor:

```lisp
(: cons-stream (-> a (Flow a) (Flow a)))
(define cons-stream [head tail]
  (Flow.Cell {:head head :tail (fn [_] tail)}))

(: integers-from (-> Int (Flow Int)))
(define integers-from [n] (cons-stream n (integers-from (+ n 1))))
```

This typechecks, but `(integers-from 2)` never returns. A function evaluates
its arguments before its body runs, so building the tail evaluates
`(integers-from 3)`, which evaluates `(integers-from 4)`, and so on, until the
evaluator stops at its step limit. `cons-stream` cannot be a function. It must be a
special form, one that leaves its second operand unevaluated. Scheme builds it into
the interpreter. Forma lets you write it yourself, as a macro:

```lisp
(macro (cons-stream head tail)
  (quasiquote
    (Flow.Cell {:head (unquote head) :tail (fn [_] (unquote tail))})))
```

A macro receives its operands as unevaluated syntax and returns new syntax,
which is then checked and evaluated in its place. `(cons-stream n
(integers-from (+ n 1)))` becomes a `Flow.Cell` whose tail is a function, and
nothing is computed until that function is called. With the macro in place,
the rest of SICP's stream program runs as written:

```lisp
(: integers-from (-> Int (Flow Int)))
(define integers-from [n] (cons-stream n (integers-from (+ n 1))))

(: stream-filter (-> (-> a Bool) (Flow a) (Flow a)))
(define stream-filter [keep? stream]
  (let [x (stream-first stream)]
    (if (keep? x)
        (cons-stream x (stream-filter keep? (stream-rest stream)))
        (stream-filter keep? (stream-rest stream)))))

(: stream-ref (-> (Flow a) Int a))
(define stream-ref [stream n]
  (if (= n 0)
      (stream-first stream)
      (stream-ref (stream-rest stream) (- n 1))))

(: divisible? (-> Int Int Bool))
(define divisible? [x y] (= (mod x y) 0))

(: sieve (-> (Flow Int) (Flow Int)))
(define sieve [stream]
  (let [p (stream-first stream)]
    (cons-stream p (sieve (stream-filter (fn [x] (not (divisible? x p)))
                                         (stream-rest stream))))))

(define primes (sieve (integers-from 2)))
(map (fn [i] (stream-ref primes i)) [0 1 2 3 4 5 6 7 8 9])
; => (2 3 5 7 11 13 17 19 23 29)
```

The sieve of Eratosthenes, as an infinite stream, from one macro.

> **Exercise 3.1.** Define `(stream-map f stream)` and use it to build the
> stream of squares. Then define `fibs` as a stream.

## 4 Metalinguistic abstraction

SICP's fourth chapter makes the point that the rest of this document builds on:

> The evaluator, which determines the meaning of expressions in a programming
> language, is just another program.

Once that is true, designing a new language is ordinary programming. Forma is
built for exactly this.

### 4.1 An evaluator is just a program

Here is an evaluator for a small language of arithmetic with local names. The
language's syntax is a type:

```lisp
(type Expr
  (Tagged
    (Lit {:value Int})
    (Var {:name String})
    (Add {:left Expr :right Expr})
    (Mul {:left Expr :right Expr})
    (Let {:name String :bound Expr :body Expr})))

(type Env (Map String Int))
```

An environment maps names to values. Looking up a missing name returns `None`,
so the evaluator has to say what an unbound variable means. Here, evaluation
returns a `Result`: `(Ok value)` or `(Err message)`.

```lisp
(: combine (-> (-> Int Int Int) (Result Int String) (Result Int String)
               (Result Int String)))
(define combine [op left right]
  (match left
    (Err message) (Err message)
    (Ok a) (match right
             (Err message) (Err message)
             (Ok b) (Ok (op a b)))))

(: interpret (-> Expr Env (Result Int String)))
(define interpret [expr env]
  (match expr
    (Lit {:value value}) (Ok value)
    (Var {:name name}) (match (get env name)
                         (Some value) (Ok value)
                         None (Err (str "unbound: " name)))
    (Add {:left l :right r})
      (combine (fn [a b] (+ a b)) (interpret l env) (interpret r env))
    (Mul {:left l :right r})
      (combine (fn [a b] (* a b)) (interpret l env) (interpret r env))
    (Let {:name name :bound bound :body body})
      (match (interpret bound env)
        (Err message) (Err message)
        (Ok value) (interpret body (assoc env name value)))))
```

```lisp
(define program
  (Expr.Let {:name "x" :bound (Expr.Lit {:value 6})
             :body (Expr.Mul {:left (Expr.Var {:name "x"})
                              :right (Expr.Lit {:value 7})})}))

(interpret program {})                   ; => {:_tag "Ok" :value 42}
(interpret (Expr.Var {:name "y"}) {})    ; => {:_tag "Err" :value "unbound: y"}
```

The value printer shows tagged values as records with a `:_tag` field, which
is also how they cross into JSON.

`interpret` has SICP's `eval` structure: one case per kind of expression,
and a recursive call for each subexpression. `Let` evaluates its bound
expression, then evaluates the body in an extended environment. That is the
environment model of chapter 3, in a few lines.

> **Exercise 4.1.** Add `(If {:test Expr :then Expr :else Expr})`, treating 0
> as false. Then add first-class functions: `Fn` and `Call`. What new kind of
> value does `interpret` need to return?

### 4.2 Macros: programs that write programs

Section 3.3 used a macro to add a special form. Most of Forma's familiar control
syntax is defined the same way, in Forma, in
[`preludes/kernel.lisp`](https://github.com/bjacobso/forma/blob/main/preludes/kernel.lisp).
This is the kernel's `when`:

```lisp
(macro
  (when test body ...)
  (quasiquote (if (unquote test) (do (unquote-splicing body)) nil)))
```

`body ...` collects the remaining operands. `quasiquote` builds a template,
`unquote` inserts one operand, and `unquote-splicing` inserts a sequence of
them. The same file defines `cond`, `and`, `or`, `->`, and `->>`. The
interpreter needs only a small core, and the language's surface grows in
libraries.

Expansion happens before type checking, and expanded code remembers where its
pieces came from. Expanding `(cons-stream n (integers-from (+ n 1)))` produces
a `fn` from the macro's definition, but the call `(integers-from (+ n 1))`
inside it keeps the line and column where the author wrote it. A type error
in a macro argument is reported in the author's source, not in the expansion.

### 4.3 Forms: programs that define languages

A macro turns syntax into more syntax. A **form** turns syntax into *typed
data*: it declares the shape of a new piece of syntax, the type of each part,
and the record it produces. This is how Forma hosts domain languages: forms
live in library files called **preludes**, and the compiler stays free of
domain concepts.

Here is a small language for describing a course catalog:

```lisp
(type CourseIR
  {:kind "Course" :name Symbol :title String :credits Int
   :requires (List Symbol)})

(form (course name title {:keys [credits requires]})
  "Declare a course and the courses it builds on."
  :types {:name (Declares Course)
          :title String
          :credits (Int :min 1 :max 6)
          :requires (List (Refers Course))}
  :ir CourseIR
  :check (fn [{:keys [name requires]}]
    (if (some (fn [r] (= r name)) requires)
      [{:severity :error :code "course/self-prerequisite"
        :message "A course cannot require itself." :slot :requires}]
      []))
  {:kind "Course" :name name :title title :credits credits :requires requires})
```

Taking the parts in order:

- The pattern `(course name title {:keys [credits requires]})` is the syntax:
  two positional parts, then keyword options.
- `:types` gives each part a **hole type**. `(Declares Course)` introduces a
  new name, and `(Refers Course)` must resolve to one. `(Int :min 1 :max 6)`
  is a refined literal.
- `:check` is an ordinary Forma function that adds rules the types can't
  express, and returns diagnostics.
- The final expression **projects** the parts into a `CourseIR` record, which
  the declared `:ir` type checks.

Programs in the new language look like they were always part of Forma:

```lisp
(course intro "Building Abstractions with Functions" :credits 4 :requires [])
(course data "Building Abstractions with Data" :credits 4 :requires [intro])
(course interp "Metalinguistic Abstraction" :credits 4 :requires [intro data])
```

Elaboration turns each one into checked data:

```json
{ "kind": "Course", "name": "interp", "title": "Metalinguistic Abstraction",
  "credits": 4, "requires": ["intro", "data"] }
```

Mistakes are reported in the author's terms, at the author's text:

```lisp
(course intro "Building Abstractions with Functions" :credits 4 :requires [])
(course data "Building Abstractions with Data" :credits 9 :requires [intro])
(course interp "Metalinguistic Abstraction" :credits 4 :requires [intro dta])
(course loop "Recursion" :credits 2 :requires [loop])
```

```text
program.lisp:2:57: credits must be at most 6
program.lisp:3:73: Unknown reference dta
program.lisp:4:47: A course cannot require itself.
```

The new language needed no parser, no separate checker, and no change to the
compiler. Because the form's descriptor is data, the same definition also
drives editor tooling and [generated reference pages](/preludes/). The
repository's preludes use this mechanism for
[email rules](./email.md), [HTTP APIs](./effect/http-api.md),
[Elm-style applications](./elm.md), and entity ontologies.
[Writing a form](./writing-a-form.md) covers the full mechanism, including
child forms, scopes, reflection, and diagnostic paths.

> **Exercise 4.2.** Add an optional `:summary` hole of type `(Option String)`
> and carry it into the IR. Then add a check that warns, with
> `:severity :warning`, when a course has more than three prerequisites.

### 4.4 The interpreter's own structure

SICP's last chapter opens the evaluator itself and compiles it down to a
register machine. Forma's pipeline is kept just as explicit:

```text
read → expand → infer → evaluate → elaborate → emit
```

The **reader** keeps every token's source position and its original
spelling, so the formatter and structural editors can reproduce the source
exactly. **Expansion** runs macros. **Inference** assigns Hindley–Milner types,
with effect rows. **Evaluation** compiles the core language to a VM; this is
where tail calls and the step limit are enforced. **Elaboration** runs forms
to produce typed IR, and **emission** packages artifacts or generates Effect
TypeScript. Each pass can be inspected in the
[playground](https://forma-lang.com/playground/demo/full-pipeline), and
[Architecture](./architecture.md) describes the boundaries between them.

## Where to go next

- [Language guide](./language.md): the full reference for what this chapter
  used informally.
- [Domain modeling in Forma](./domain-modeling.md): a companion guide that
  designs a business workflow with types, in the style of *Domain Modeling
  Made Functional*.
- [Writing a form](./writing-a-form.md): build your own domain language.
- [Effect reference](./effect/reference.md): services, layers, resources,
  concurrency, and the generated TypeScript.
