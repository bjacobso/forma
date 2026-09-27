/**
 * Unified Compiler
 *
 * A single-pass compiler that produces:
 * - Extracted data (FormResult)
 * - Synthesized types
 * - Errors with suggestions
 * - LSP features (completions, hover, diagnostics)
 *
 * @module
 */

import { Effect } from "effect";
import { parse, type RedNode, type Loc, nodeAtOffset } from "../reader/index.js";
import { isRedNode } from "../reader/index.js";
import {
  type DSLType,
  type Ctx,
  DSLError,
  type Completion,
  type HoverInfo,
  type Diagnostic,
  type CompletionPosition,
  emptyCtx,
} from "./core.js";
import { type Form, type FormResult, type FormRegistry } from "./form.js";
import { getNodeText, getContentChildren, getNodeLoc } from "./pattern.js";

// =============================================================================
// Compiler Interface
// =============================================================================

/**
 * A compiler for a DSL defined by forms.
 *
 * The compiler provides all the functionality needed for:
 * - Validation and type checking
 * - Data extraction
 * - LSP integration
 */
export interface Compiler<T extends DSLType> {
  /**
   * Compile a source string or parsed tree.
   *
   * Returns a result containing:
   * - The extracted data (if successful)
   * - The synthesized type (if the form has a type rule)
   * - All errors found
   * - The final context
   */
  compile<Args, R, Req>(
    source: string | RedNode,
    form: Form<T, Args, R, Req>,
    ctx?: Ctx<T>,
  ): Effect.Effect<FormResult<T, R>, never, Req>;

  /**
   * Get completions at a position in the source.
   */
  completions<Req>(
    source: string,
    offset: number,
    form: Form<T, unknown, unknown, Req>,
    ctx?: Ctx<T>,
  ): Effect.Effect<readonly Completion[], never, Req>;

  /**
   * Get hover information at a position.
   */
  hover<Req>(
    source: string,
    offset: number,
    form: Form<T, unknown, unknown, Req>,
    ctx?: Ctx<T>,
  ): Effect.Effect<HoverInfo | undefined, never, Req>;

  /**
   * Get all diagnostics for a source.
   */
  diagnostics<Req>(
    source: string,
    form: Form<T, unknown, unknown, Req>,
    ctx?: Ctx<T>,
  ): Effect.Effect<readonly Diagnostic[], never, Req>;
}

// =============================================================================
// Compiler Implementation
// =============================================================================

/**
 * Create a compiler for a DSL.
 *
 * @example
 * ```typescript
 * const compiler = createCompiler<DomainType>();
 *
 * const result = await Effect.runPromise(
 *   compiler.compile(source, QueryForm, initialCtx)
 * );
 *
 * if (result.errors.length === 0) {
 *   console.log("Query type:", result.type);
 *   console.log("Extracted:", result.result);
 * }
 * ```
 */
export function createCompiler<T extends DSLType>(): Compiler<T> {
  return {
    compile<Args, R, Req>(
      source: string | RedNode,
      form: Form<T, Args, R, Req>,
      ctx: Ctx<T> = emptyCtx(),
    ): Effect.Effect<FormResult<T, R>, never, Req> {
      return Effect.gen(function* () {
        // Parse if needed
        let tree: RedNode;
        let loc: Loc;

        if (typeof source === "string") {
          const parseResult = parse(source);
          if (parseResult.errors.length > 0) {
            const e = parseResult.errors[0]!;
            const errorLoc = e.loc ?? { start: 0, end: 0, line: 1, col: 1 };
            return {
              result: undefined,
              type: undefined,
              errors: [new DSLError(e.message, errorLoc)],
              context: ctx,
              loc: errorLoc,
            };
          }
          // Get the first top-level form
          const topLevel = getContentChildren(parseResult.redTree).filter(isRedNode);
          if (topLevel.length === 0) {
            const defaultLoc = { start: 0, end: 0, line: 1, col: 1 };
            return {
              result: undefined,
              type: undefined,
              errors: [new DSLError("No forms found", defaultLoc)],
              context: ctx,
              loc: defaultLoc,
            };
          }
          tree = topLevel[0]!;
          loc = getNodeLoc(tree);
        } else {
          tree = source;
          loc = getNodeLoc(tree);
        }

        const errors: DSLError[] = [];

        // Match the pattern
        const matchResult = yield* Effect.result(form.pattern.match(tree));
        if (matchResult._tag === "Failure") {
          errors.push(matchResult.failure);
          return { result: undefined, type: undefined, errors, context: ctx, loc };
        }
        const args = matchResult.success;

        // Build context (bindings)
        let newCtx = ctx;
        if (form.bind) {
          const bindResult = yield* Effect.result(form.bind(ctx, args, loc));
          if (bindResult._tag === "Failure") {
            errors.push(bindResult.failure);
          } else {
            newCtx = bindResult.success;
          }
        }

        // Synthesize type
        let type: T | undefined;
        if (form.type) {
          const typeResult = yield* Effect.result(form.type(newCtx, args, loc));
          if (typeResult._tag === "Failure") {
            errors.push(typeResult.failure);
          } else {
            type = typeResult.success;
          }
        }

        // Run validation
        if (form.validate) {
          const validationErrors = yield* form.validate(newCtx, args, loc);
          errors.push(...validationErrors);
        }

        // Extract result
        let result: R | undefined;
        if (errors.length === 0 && form.extract) {
          const extractResult = yield* Effect.result(form.extract(newCtx, args, loc));
          if (extractResult._tag === "Failure") {
            errors.push(extractResult.failure);
          } else {
            result = extractResult.success;
          }
        } else if (errors.length === 0) {
          result = args as unknown as R;
        }

        return { result, type, errors, context: newCtx, loc };
      });
    },

    completions<Req>(
      source: string,
      offset: number,
      form: Form<T, unknown, unknown, Req>,
      ctx: Ctx<T> = emptyCtx(),
    ): Effect.Effect<readonly Completion[], never, Req> {
      return Effect.gen(function* () {
        // Parse the source
        const parseResult = parse(source);
        const topLevel = getContentChildren(parseResult.redTree).filter(isRedNode);
        if (topLevel.length === 0) {
          return [];
        }

        const tree = topLevel[0]!;

        // Find the node at the cursor position
        const cursorNode = nodeAtOffset(tree, offset);
        if (!cursorNode) {
          return [];
        }

        // Determine the completion position
        const pos = getCompletionPosition(tree, cursorNode, offset);

        // Try to get partial args from the pattern
        const matchResult = yield* Effect.result(form.pattern.match(tree));
        const partialArgs = matchResult._tag === "Success" ? matchResult.success : {};

        // Get completions from the form
        if (form.complete) {
          return yield* form.complete(ctx, partialArgs as Partial<unknown>, pos);
        }

        // Fall back to pattern completions
        if (form.pattern.complete) {
          return form.pattern.complete(pos.partial, pos);
        }

        return [];
      });
    },

    hover<Req>(
      source: string,
      offset: number,
      form: Form<T, unknown, unknown, Req>,
      ctx: Ctx<T> = emptyCtx(),
    ): Effect.Effect<HoverInfo | undefined, never, Req> {
      return Effect.gen(function* () {
        // Parse the source
        const parseResult = parse(source);
        const topLevel = getContentChildren(parseResult.redTree).filter(isRedNode);
        if (topLevel.length === 0) {
          return undefined;
        }

        const tree = topLevel[0]!;

        // Match the pattern to get args
        const matchResult = yield* Effect.result(form.pattern.match(tree));
        if (matchResult._tag === "Failure") {
          return undefined;
        }
        const args = matchResult.success;

        // Find the node at the cursor
        const hoverNode = nodeAtOffset(tree, offset);
        if (!hoverNode) {
          return undefined;
        }

        // Get hover position
        const pos = getHoverPosition(tree, hoverNode);

        // Get hover from the form
        if (form.hover) {
          return yield* form.hover(ctx, args, pos);
        }

        return undefined;
      });
    },

    diagnostics<Req>(
      source: string,
      form: Form<T, unknown, unknown, Req>,
      ctx: Ctx<T> = emptyCtx(),
    ): Effect.Effect<readonly Diagnostic[], never, Req> {
      const compiler = this;
      return Effect.gen(function* () {
        const result = yield* compiler.compile(source, form, ctx);

        return result.errors.map((e: DSLError): Diagnostic => {
          const diag: Diagnostic = {
            range: { start: e.loc, end: e.loc },
            severity: "error",
            message: e.message,
          };
          if (e.suggestions !== undefined) {
            return { ...diag, suggestions: e.suggestions };
          }
          return diag;
        });
      });
    },
  };
}

// =============================================================================
// Registry-based Compiler
// =============================================================================

/**
 * Extended compiler interface for registry-based compilation.
 *
 * @typeParam T - The DSL type system
 * @typeParam Req - Effect requirements from all forms in the registry
 */
export interface RegistryCompiler<T extends DSLType, Req = never> extends Compiler<T> {
  /**
   * Compile using the registry to find the appropriate form.
   */
  compileAuto(
    source: string | RedNode,
    ctx?: Ctx<T>,
  ): Effect.Effect<FormResult<T, unknown>, never, Req>;

  /**
   * Get completions using the registry to find forms.
   */
  completionsAuto(
    source: string,
    offset: number,
    ctx?: Ctx<T>,
  ): Effect.Effect<readonly Completion[], never, Req>;

  /**
   * Get hover information using the registry.
   */
  hoverAuto(
    source: string,
    offset: number,
    ctx?: Ctx<T>,
  ): Effect.Effect<HoverInfo | undefined, never, Req>;

  /**
   * Get diagnostics using the registry.
   */
  diagnosticsAuto(source: string, ctx?: Ctx<T>): Effect.Effect<readonly Diagnostic[], never, Req>;

  /**
   * The form registry.
   */
  readonly registry: FormRegistry<T, Req>;
}

/**
 * Create a compiler that uses a form registry.
 *
 * This allows dispatching to different forms based on the head symbol.
 */
export function createRegistryCompiler<T extends DSLType, Req = never>(
  registry: FormRegistry<T, Req>,
): RegistryCompiler<T, Req> {
  const baseCompiler = createCompiler<T>();

  const registryCompiler: RegistryCompiler<T, Req> = {
    ...baseCompiler,

    registry,

    compileAuto(
      source: string | RedNode,
      ctx: Ctx<T> = emptyCtx(),
    ): Effect.Effect<FormResult<T, unknown>, never, Req> {
      return Effect.gen(function* () {
        // Parse if needed
        let tree: RedNode;
        const defaultLoc = { start: 0, end: 0, line: 1, col: 1 };

        if (typeof source === "string") {
          const parseResult = parse(source);
          if (parseResult.errors.length > 0) {
            const e = parseResult.errors[0]!;
            const errorLoc = e.loc ?? defaultLoc;
            return {
              result: undefined,
              type: undefined,
              errors: [new DSLError(e.message, errorLoc)],
              context: ctx,
              loc: errorLoc,
            };
          }
          const topLevel = getContentChildren(parseResult.redTree).filter(isRedNode);
          if (topLevel.length === 0) {
            return {
              result: undefined,
              type: undefined,
              errors: [new DSLError("No forms found", defaultLoc)],
              context: ctx,
              loc: defaultLoc,
            };
          }
          tree = topLevel[0]!;
        } else {
          tree = source;
        }

        const treeLoc = getNodeLoc(tree);

        // Find the head symbol
        const head = getFormHead(tree);
        if (!head) {
          return {
            result: undefined,
            type: undefined,
            errors: [new DSLError("Expected a list form", treeLoc)],
            context: ctx,
            loc: treeLoc,
          };
        }

        // Look up the form in the registry
        const form = registry.get(head);
        if (!form) {
          const available = Array.from(registry.forms.keys());
          return {
            result: undefined,
            type: undefined,
            errors: [new DSLError(`Unknown form '${head}'`, treeLoc, available)],
            context: ctx,
            loc: treeLoc,
          };
        }

        // Compile with the found form
        return yield* baseCompiler.compile(tree, form, ctx);
      });
    },

    completionsAuto(
      source: string,
      offset: number,
      ctx: Ctx<T> = emptyCtx(),
    ): Effect.Effect<readonly Completion[], never, Req> {
      return Effect.gen(function* () {
        // Parse the source
        const parseResult = parse(source);
        const topLevel = getContentChildren(parseResult.redTree).filter(isRedNode);

        // Helper to create form completions
        const formToCompletion = (
          [name, form]: [string, Form<T, unknown, unknown, Req>],
          withSnippet = false,
        ): Completion => {
          const completion: Completion = {
            label: name,
            kind: "form",
          };
          if (form.description) {
            return { ...completion, detail: form.description };
          }
          if (withSnippet) {
            return { ...completion, insertText: `(${name} $0)`, isSnippet: true };
          }
          return completion;
        };

        // If cursor is at top level (not inside a form), return all form names
        if (topLevel.length === 0) {
          return Array.from(registry.forms.entries()).map((entry) => formToCompletion(entry, true));
        }

        const tree = topLevel[0]!;

        // Find the node at cursor
        const cursorNode = nodeAtOffset(tree, offset);
        if (!cursorNode) {
          return [];
        }

        // Find the head symbol to dispatch to the right form
        const head = getFormHead(tree);
        if (!head) {
          // Cursor is in an empty list, suggest all forms
          return Array.from(registry.forms.entries()).map((entry) => formToCompletion(entry));
        }

        const form = registry.get(head);
        if (!form) {
          // Unknown form, suggest all forms as alternatives
          return Array.from(registry.forms.entries()).map((entry) => formToCompletion(entry));
        }

        // Get completions from the matched form
        return yield* baseCompiler.completions(source, offset, form, ctx);
      });
    },

    hoverAuto(
      source: string,
      offset: number,
      ctx: Ctx<T> = emptyCtx(),
    ): Effect.Effect<HoverInfo | undefined, never, Req> {
      return Effect.gen(function* () {
        // Parse the source
        const parseResult = parse(source);
        const topLevel = getContentChildren(parseResult.redTree).filter(isRedNode);
        if (topLevel.length === 0) {
          return undefined;
        }

        // Find the top-level form containing the cursor offset
        let tree: RedNode | undefined;
        for (const node of topLevel) {
          const loc = getNodeLoc(node);
          if (offset >= loc.start && offset < loc.end) {
            tree = node;
            break;
          }
        }

        if (!tree) {
          return undefined;
        }

        // Find the head symbol
        const head = getFormHead(tree);
        if (!head) {
          return undefined;
        }

        // Check if hovering over the form head
        const children = getContentChildren(tree).filter(isRedNode);
        if (children.length > 0) {
          const headNode = children[0]!;
          const headLoc = getNodeLoc(headNode);
          if (offset >= headLoc.start && offset < headLoc.end) {
            // Hovering over the form head - show form documentation
            const form = registry.get(head);
            if (form) {
              return {
                content: `## ${form.name}\n\n${form.description ?? "No description available."}`,
                range: { start: headLoc, end: headLoc },
              };
            }
          }
        }

        const form = registry.get(head);
        if (!form) {
          return undefined;
        }

        // Get hover from the matched form
        return yield* baseCompiler.hover(source, offset, form, ctx);
      });
    },

    diagnosticsAuto(
      source: string,
      ctx: Ctx<T> = emptyCtx(),
    ): Effect.Effect<readonly Diagnostic[], never, Req> {
      return Effect.gen(function* () {
        const result = yield* registryCompiler.compileAuto(source, ctx);

        return result.errors.map((e: DSLError): Diagnostic => {
          const diag: Diagnostic = {
            range: { start: e.loc, end: e.loc },
            severity: "error",
            message: e.message,
          };
          if (e.suggestions !== undefined) {
            return { ...diag, suggestions: e.suggestions };
          }
          return diag;
        });
      });
    },
  };

  return registryCompiler;
}

// =============================================================================
// Helper Functions
// =============================================================================

/**
 * Get the length of a node's text
 */
function getNodeLength(node: RedNode): number {
  return getNodeText(node).length;
}

/**
 * Get the head symbol of a form (list)
 */
function getFormHead(node: RedNode): string | undefined {
  if (node.kind() !== "List") return undefined;

  const children = getContentChildren(node).filter(isRedNode);
  if (children.length === 0) return undefined;

  return getNodeText(children[0]!);
}

/**
 * Get completion position information
 */
function getCompletionPosition(
  root: RedNode,
  cursorNode: RedNode,
  offset: number,
): CompletionPosition {
  // Find which argument index the cursor is in
  let argIndex = -1;
  let partial = "";
  const loc = getNodeLoc(cursorNode);

  if (root.kind() === "List") {
    const children = getContentChildren(root).filter(isRedNode);
    for (let i = 0; i < children.length; i++) {
      const child = children[i]!;
      const childStart = getNodeLoc(child).start;
      const childEnd = childStart + getNodeLength(child);
      if (offset >= childStart && offset <= childEnd) {
        argIndex = i - 1; // -1 because first child is the head
        partial = getNodeText(child).substring(0, offset - childStart);
        break;
      }
    }
  }

  return {
    argIndex,
    offset: offset - loc.start,
    partial,
    loc,
  };
}

/**
 * Get hover position information
 */
function getHoverPosition(root: RedNode, hoverNode: RedNode): { argIndex: number; loc: Loc } {
  let argIndex = -1;
  const loc = getNodeLoc(hoverNode);

  if (root.kind() === "List") {
    const children = getContentChildren(root).filter(isRedNode);
    for (let i = 0; i < children.length; i++) {
      if (children[i] === hoverNode || isDescendant(children[i]!, hoverNode)) {
        argIndex = i - 1;
        break;
      }
    }
  }

  return { argIndex, loc };
}

/**
 * Check if a node is a descendant of another
 */
function isDescendant(ancestor: RedNode, node: RedNode): boolean {
  const children = getContentChildren(ancestor).filter(isRedNode);
  for (const child of children) {
    if (child === node || isDescendant(child, node)) {
      return true;
    }
  }
  return false;
}

// =============================================================================
// Synthesis Function
// =============================================================================

/**
 * Create a type synthesis function from a form registry.
 *
 * This is useful when you need to synthesize types for sub-expressions
 * within a form's type rule.
 */
export function createSynthesizer<T extends DSLType, Req = never>(registry: FormRegistry<T, Req>) {
  const compiler = createRegistryCompiler(registry);

  return function synthesize(ctx: Ctx<T>, node: RedNode): Effect.Effect<T, DSLError, Req> {
    return Effect.gen(function* () {
      const result = yield* compiler.compileAuto(node, ctx);

      if (result.errors.length > 0) {
        return yield* Effect.fail(result.errors[0]!);
      }

      if (result.type === undefined) {
        return yield* Effect.fail(new DSLError("Expression has no type", getNodeLoc(node)));
      }

      return result.type;
    });
  };
}
