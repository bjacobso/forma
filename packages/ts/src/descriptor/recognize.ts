import type { SExpr } from "../Reader.js";
import { headSym, trySym } from "../SExpr.js";
import { List } from "../Reader.js";
import type { FormDescriptor } from "./FormDescriptor.js";
import type { FormDescriptorRegistry } from "./FormDescriptorRegistry.js";

export interface RecognizedForm {
  readonly formName: string;
  readonly descriptor: FormDescriptor;
  readonly expr: SExpr;
}

/**
 * Unwrap `(define name (form-type ...))` into `(form-type name ...)`.
 * This lets domain authors use the standard Lisp `define` syntax while the
 * compiler recognizes the inner form descriptor.
 */
function unwrapDefine(expr: SExpr, registry: FormDescriptorRegistry): SExpr | null {
  const head = headSym(expr);
  if (head !== "define") return null;
  if (expr._tag !== "List" || expr.items.length !== 3) return null;

  const nameExpr = expr.items[1]!;
  const name = trySym(nameExpr);
  if (!name) return null;

  const body = expr.items[2]!;
  const bodyHead = headSym(body);
  if (!bodyHead || !registry.get(bodyHead)) return null;
  if (body._tag !== "List") return null;

  // Synthesize (form-type name ...body-tail)
  return List([body.items[0]!, nameExpr, ...body.items.slice(1)], expr.loc);
}

export function recognizeForm(
  expr: SExpr,
  registry: FormDescriptorRegistry,
): RecognizedForm | null {
  const head = headSym(expr);
  if (!head) return null;

  const descriptor = registry.get(head);
  if (descriptor) return { formName: descriptor.name, descriptor, expr };

  // Try unwrapping (define name (form-type ...))
  const unwrapped = unwrapDefine(expr, registry);
  if (unwrapped) {
    const unwrappedHead = headSym(unwrapped);
    if (unwrappedHead) {
      const unwrappedDescriptor = registry.get(unwrappedHead);
      if (unwrappedDescriptor) {
        return { formName: unwrappedHead, descriptor: unwrappedDescriptor, expr: unwrapped };
      }
    }
  }

  return null;
}

export function recognizeForms(
  exprs: readonly SExpr[],
  registry: FormDescriptorRegistry,
): RecognizedForm[] {
  return exprs
    .map((e) => recognizeForm(e, registry))
    .filter((r): r is RecognizedForm => r !== null);
}
