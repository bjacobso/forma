import { Effect, Schema } from "effect";

const __formaInt = (value: number): number => {
  if (!Number.isSafeInteger(value)) throw new RangeError("Int outside the safe integer range");
  return value === 0 ? 0 : value;
};

export const Slug = Schema.String.check(Schema.isPattern(new RegExp("^[a-z][a-z0-9-]*$")));
export type Slug = typeof Slug.Type;

export type Rule = { readonly kind: "present"; readonly attribute: Slug } | { readonly kind: "equals"; readonly attribute: Slug; readonly value: string } | { readonly kind: "all"; readonly rules: ReadonlyArray<Rule> } | { readonly kind: "not"; readonly rule: Rule };
export const Rule: Schema.Codec<Rule> = Schema.Union([
  Schema.Struct({ kind: Schema.Literal("present"), attribute: Slug }),
  Schema.Struct({ kind: Schema.Literal("equals"), attribute: Slug, value: Schema.String }),
  Schema.Struct({ kind: Schema.Literal("all"), rules: Schema.Array(Schema.suspend((): Schema.Codec<Rule> => Rule)) }),
  Schema.Struct({ kind: Schema.Literal("not"), rule: Schema.suspend((): Schema.Codec<Rule> => Rule) }),
]);

export type Tree = { readonly _tag: "Leaf"; readonly value: number } | { readonly _tag: "Branch"; readonly children: ReadonlyArray<Tree> };
export const Tree: Schema.Codec<Tree> = Schema.Union([
  Schema.Struct({ _tag: Schema.Literal("Leaf"), value: Schema.Int }),
  Schema.Struct({ _tag: Schema.Literal("Branch"), children: Schema.Array(Schema.suspend((): Schema.Codec<Tree> => Tree)) }),
]);

export type Link = { readonly weight: number; readonly target: Section };
export const Link: Schema.Codec<Link> = Schema.Struct({
  weight: Schema.Int.check(Schema.isGreaterThanOrEqualTo(0)).check(Schema.isLessThanOrEqualTo(10)),
  target: Schema.suspend((): Schema.Codec<Section> => Section),
});

export type Section = { readonly title: string; readonly next?: Link };
export const Section: Schema.Codec<Section> = Schema.Struct({
  title: Schema.String.check(Schema.isMinLength(1)),
  next: Schema.optionalKey(Schema.suspend((): Schema.Codec<Link> => Link)),
});

export const Property = Schema.Struct({
  name: Slug,
  label: Schema.String.check(Schema.isMinLength(1)).check(Schema.isMaxLength(40)),
  tags: Schema.Array(Schema.String).check(Schema.isMaxLength(3)),
  "visible-when": Schema.optionalKey(Rule),
});
export type Property = typeof Property.Type;

export class InvalidProperty extends Schema.TaggedError<InvalidProperty>()("InvalidProperty", {
  message: Schema.String,
}) {}

export const total = (tree: Tree): number =>
  tree._tag === "Leaf"
    ? tree.value
    : __formaInt(tree.children.map(total).reduce((total2, item) => total2 + item, 0));

export const both = (left: Rule, right: Rule): Rule => ({ kind: "all", rules: [left, right] });

export const parseProperty = (input: Schema.Json): Effect.Effect<Property, InvalidProperty> =>
  Effect.gen(function* () {
    return yield* Effect.catchTag(
      Schema.decodeUnknownEffect(Property)(input),
      "SchemaError",
      () => Effect.fail(new InvalidProperty({ message: "property does not match the schema" })),
    );
  });
