import { Effect, Option, Schema } from "effect";

export const ShapeId = Schema.String.pipe(Schema.brand("ShapeId"));
export type ShapeId = typeof ShapeId.Type;

export const Color = Schema.Literals(["red", "green", "blue"]);
export type Color = typeof Color.Type;

export const Point = Schema.Tuple([Schema.Number, Schema.Number]);
export type Point = typeof Point.Type;

export const Shape = Schema.Union([
  Schema.Struct({ kind: Schema.Literal("Circle"), radius: Schema.Number }),
  Schema.Struct({ kind: Schema.Literal("Rectangle"), width: Schema.Number, height: Schema.Number }),
  Schema.Struct({ kind: Schema.Literal("Polygon"), points: Schema.Array(Point) }),
]);
export type Shape = typeof Shape.Type;

export const Label = Schema.Union([Schema.String, Schema.Int]);
export type Label = typeof Label.Type;

export const Drawing = Schema.Struct({
  id: ShapeId,
  shape: Shape,
  color: Color,
  label: Schema.optionalKey(Label),
  tags: Schema.Record(Schema.String, Schema.String),
  title: Schema.String.annotate({ description: "Human readable title" }),
});
export type Drawing = typeof Drawing.Type;

export class InvalidDrawing extends Schema.TaggedError<InvalidDrawing>()("InvalidDrawing", {
  message: Schema.String,
}) {}

export const makeCircle = (id: string, radius: number): Drawing => ({
  id: ShapeId.make(id),
  shape: { kind: "Circle", radius },
  color: "red",
  tags: {},
  title: `circle ${id}`,
});

export const area = (shape: Shape): Effect.Effect<number> =>
  Effect.gen(function* () {
    switch (shape.kind) {
      case "Circle": {
        const c = shape;
        return 3.14 * c.radius * c.radius;
      }
      case "Rectangle": {
        const r = shape;
        return r.width * r.height;
      }
      case "Polygon": {
        const p = shape;
        return p.points.length;
      }
    }
  });

export const warmth = (color: Color): Effect.Effect<string> =>
  Effect.gen(function* () {
    switch (color) {
      case "red": {
        return "warm";
      }
      default: {
        return "cool";
      }
    }
  });

export const parseDrawing = (input: Schema.Json): Effect.Effect<Drawing, InvalidDrawing> =>
  Effect.gen(function* () {
    return yield* Effect.catchTag(
      Schema.decodeUnknownEffect(Drawing)(input),
      "SchemaError",
      () => Effect.fail(new InvalidDrawing({ message: "drawing does not match the schema" })),
    );
  });

export const describeDrawing = (input: Schema.Json): Effect.Effect<string, InvalidDrawing> =>
  Effect.gen(function* () {
    const drawing = yield* parseDrawing(input);
    const size = yield* area(drawing.shape);
    const tone = yield* warmth(drawing.color);
    const label = Option.fromUndefinedOr(drawing.label);
    return `${drawing.title}: ${tone} ${drawing.shape.kind} of area ${size} [${Option.getOrElse(label, (): Label => "unlabelled")}]`;
  });
