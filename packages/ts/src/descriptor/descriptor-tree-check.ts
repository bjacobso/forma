import { isFloatLiteral } from "../reader/types.js";
import type { FormDescriptor, SlotSpec, ValidationCheck } from "./FormDescriptor.js";
import {
  readDescriptorTreeComponentSpec,
  toCamelCase,
  type DescriptorTreeChildrenSpec,
  type DescriptorTreeComponentSpec,
} from "./descriptor-tree-metadata.js";
import { headSym, tail, type SExpr } from "../reader/types.js";
export type {
  DescriptorTreeChildrenSpec,
  DescriptorTreeComponentSpec,
} from "./descriptor-tree-metadata.js";

export interface DescriptorTreeDiagnostic {
  readonly severity: "error" | "warning";
  readonly message: string;
  readonly component?: string;
}

export type DescriptorTreePropType =
  | "string"
  | "number"
  | "int"
  | "float"
  | "boolean"
  | "expression"
  | "array"
  | "object"
  | "slot-content"
  | "any";

export interface DescriptorTreePropSchema {
  readonly type: DescriptorTreePropType;
  readonly required?: boolean;
  readonly values?: readonly string[];
}

export interface DescriptorTreeComponentSchema {
  readonly props: Record<string, DescriptorTreePropSchema>;
  readonly aliases: ReadonlyMap<string, string>;
  readonly treeSpec: DescriptorTreeComponentSpec;
}

type SimpleType =
  | "string"
  | "number"
  | "int"
  | "float"
  | "boolean"
  | "null"
  | "list"
  | "record"
  | "json"
  | "component"
  | "any"
  | "unknown";

interface TreeContext {
  readonly stateTypes: ReadonlyMap<string, SimpleType>;
  readonly queryNames: ReadonlySet<string>;
  readonly inputParams: ReadonlySet<string>;
  readonly defNames: ReadonlySet<string>;
  readonly componentSchemas: Readonly<Record<string, DescriptorTreeComponentSchema>>;
  readonly diagnostics: DescriptorTreeDiagnostic[];
}

export interface DescriptorTreeCheckInput {
  readonly layout: SExpr;
  readonly descriptors: readonly FormDescriptor[];
  readonly extensionKey: string;
  readonly stateVars: ReadonlyMap<string, string> | ReadonlySet<string>;
  readonly queryNames: ReadonlySet<string>;
  readonly inputParams: ReadonlySet<string>;
  readonly defNames?: ReadonlySet<string>;
}

export interface DescriptorTreeCheckResult {
  readonly diagnostics: readonly DescriptorTreeDiagnostic[];
  readonly hasErrors: boolean;
}

/** Check literal options even when a hosted tree has no expression scope. */
export function validateDescriptorTreeLiteralOptions(layout: SExpr, descriptors: readonly FormDescriptor[], extensionKey: string): readonly DescriptorTreeDiagnostic[] {
  const schemas = buildDescriptorTreeComponentSchemas(descriptors, extensionKey);
  const diagnostics: DescriptorTreeDiagnostic[] = [];
  const walk = (node: SExpr): void => {
    if (node._tag === "List") {
      const schema = schemas[headSym(node) ?? ""];
      if (schema) {
        const pairs: (readonly [SExpr, SExpr])[] = node.items.slice(1).flatMap(props => props._tag === "Map" ? props.pairs : []);
        for (let i=1;i+1<node.items.length;i++) {
          const key = node.items[i]!;
          if (key._tag === "Sym" && key.name.startsWith(":")) pairs.push([key, node.items[++i]!]);
        }
        for (const [key, value] of pairs) {
          const name = key._tag === "Sym" ? key.name.replace(/^:/, "") : key._tag === "Str" ? key.value : "";
          const prop = schema.props[toCamelCase(name)];
          if (prop?.values && (value._tag !== "Str" || !prop.values.includes(value.value))) {
            diagnostics.push({severity: "error", component: headSym(node)!, message: `${name} must be one of ${prop.values.join(", ")}`});
          }
        }
      }
      node.items.slice(1).forEach(walk);
    } else if (node._tag === "Vector") node.items.forEach(walk);
    else if (node._tag === "Map") node.pairs.forEach(([, value]) => walk(value));
  };
  walk(layout);
  return diagnostics;
}

export { readDescriptorTreeComponentSpec } from "./descriptor-tree-metadata.js";

export function buildDescriptorTreeComponentSchemas(
  descriptors: readonly FormDescriptor[],
  extensionKey: string,
): Record<string, DescriptorTreeComponentSchema> {
  const schemas: Record<string, DescriptorTreeComponentSchema> = {};

  for (const descriptor of descriptors) {
    const treeSpec = readDescriptorTreeComponentSpec(descriptor, extensionKey);
    if (!treeSpec) continue;

    const props: Record<string, DescriptorTreePropSchema> = {};
    const aliases = new Map<string, string>();

    for (const slot of descriptor.slots) {
      const propName = toCamelCase(slot.name);
      const surfaceType = descriptor.surface?.holes.get(slot.name);
      const unwrapped = surfaceType?._tag === "List" && surfaceType.items[0]?._tag === "Sym" && surfaceType.items[0].name === "Option" ? surfaceType.items[1] : surfaceType;
      const literals = unwrapped?._tag === "List" && unwrapped.items[0]?._tag === "Sym" && unwrapped.items[0].name === "Union" ? unwrapped.items.slice(1) : undefined;
      const values = literals?.every(value => value._tag === "Str") ? literals.map(value => (value as Extract<SExpr, {_tag: "Str"}>).value) : deriveAllowedValues(descriptor.validation, slot.name);
      props[propName] = {
        type: propTypeFromSlot(slot),
        ...(slot.required ? { required: true } : {}),
        ...(values ? { values } : {}),
      };

      for (const alias of slot.aliases ?? []) {
        aliases.set(toCamelCase(alias), propName);
      }
    }

    schemas[descriptor.name] = {
      props,
      aliases,
      treeSpec,
    };
  }

  return schemas;
}

function propTypeFromSlot(slot: SlotSpec): DescriptorTreePropType {
  if (slot.mode === "form") return "slot-content";
  if (slot.mode === "expr") return "expression";

  switch (slot.type) {
    case "String":
    case "Str":
    case "Symbol":
      return "string";
    case "Int": return "int";
    case "Number":
    case "Num":
    case "Float": return "float";
    case "Boolean":
    case "Bool":
      return "boolean";
    case "Array":
      return "array";
    case "Object":
      return "object";
    default:
      return "any";
  }
}

function deriveAllowedValues(
  validation: FormDescriptor["validation"],
  slotName: string,
): readonly string[] | undefined {
  if (validation.kind !== "static" && validation.kind !== "composite") return undefined;

  const check = validation.checks.find(
    (candidate): candidate is ValidationCheck & { values: readonly string[] } =>
      candidate.kind === "one-of" &&
      candidate.slot === slotName &&
      Array.isArray(candidate.values) &&
      candidate.values.length > 0,
  );

  return check?.values;
}

function normalizeSymbol(expr: SExpr): string | undefined {
  return expr._tag === "Sym" ? expr.name.replace(/^:/, "") : undefined;
}

function simpleTypeFromStateKind(kind: string | undefined): SimpleType {
  switch (kind) {
    case "string":
      return "string";
    case "int": return "int";
    case "float": return "float";
    case "number":
      return "number";
    case "boolean":
      return "boolean";
    case "null":
      return "null";
    case "list":
      return "list";
    case "object":
      return "record";
    case "json":
      return "json";
    case "component":
      return "component";
    default:
      return "any";
  }
}

function inferPipeType(name: string, inputType: SimpleType): SimpleType {
  switch (name) {
    case "length":
      return "number";
    case "upper":
    case "lower":
    case "trim":
    case "currency":
    case "relative":
    case "date":
    case "datetime":
    case "string":
      return "string";
    case "json":
      return "json";
    default:
      return inputType === "unknown" ? "any" : inputType;
  }
}

function inferExprType(expr: SExpr, ctx: TreeContext, componentPath: string): SimpleType {
  switch (expr._tag) {
    case "Str":
      return "string";
    case "Num":
      return isFloatLiteral(expr) ? "float" : "int";
    case "Bool":
      return "boolean";
    case "Vector":
      for (const item of expr.items) inferNestedExpressions(item, ctx, componentPath);
      return "list";
    case "Map":
      for (const [key, value] of expr.pairs) {
        inferNestedExpressions(key, ctx, componentPath);
        inferNestedExpressions(value, ctx, componentPath);
      }
      return "record";
    case "Sym": {
      const name = expr.name.replace(/^:/, "");
      if (name === "nil" || name === "null") return "null";
      if (name === "true" || name === "false") return "boolean";
      if (name === "$row") return "record";
      if (name === "$db") return "string";
      if (name === "$item") return "any";
      if (name === "$index") return "number";
      if (name === "$event") return "any";
      if (name === "$result") return "any";
      if (name === "$error") return "any";
      if (name === "$host") return "record";
      return "any";
    }
    case "List":
      break;
    default:
      return "unknown";
  }

  const head = headSym(expr);
  const args = tail(expr);
  if (!head) return "unknown";

  switch (head) {
    case "state": {
      const varName = args[0] ? normalizeSymbol(args[0]) : undefined;
      if (varName && !ctx.stateTypes.has(varName)) {
        ctx.diagnostics.push({
          severity: "error",
          message: `Reference to undeclared state variable '${varName}'. Declared: ${[...ctx.stateTypes.keys()].join(", ") || "(none)"}`,
          component: componentPath,
        });
      }
      return varName ? (ctx.stateTypes.get(varName) ?? "any") : "any";
    }
    case "query": {
      const queryName = args[0] ? normalizeSymbol(args[0]) : undefined;
      if (queryName && !ctx.queryNames.has(queryName)) {
        ctx.diagnostics.push({
          severity: "error",
          message: `Reference to undeclared query '${queryName}'. Declared: ${[...ctx.queryNames].join(", ") || "(none)"}`,
          component: componentPath,
        });
      }
      return "list";
    }
    case "input": {
      const paramName = args[0] ? normalizeSymbol(args[0]) : undefined;
      if (paramName && !ctx.inputParams.has(paramName)) {
        ctx.diagnostics.push({
          severity: "error",
          message: `Reference to undeclared input parameter '${paramName}'. Declared: ${[...ctx.inputParams].join(", ") || "(none)"}`,
          component: componentPath,
        });
      }
      return "any";
    }
    case "get":
      if (args[0]) inferExprType(args[0], ctx, componentPath);
      if (args[1]) inferNestedExpressions(args[1], ctx, componentPath);
      return "any";
    case "length":
      if (args[0]) inferExprType(args[0], ctx, componentPath);
      return "int";
    case "not":
    case "nil?":
      if (args[0]) inferExprType(args[0], ctx, componentPath);
      return "boolean";
    case "=":
    case "!=":
    case ">":
    case ">=":
    case "<":
    case "<=":
      if (args[0]) inferExprType(args[0], ctx, componentPath);
      if (args[1]) inferExprType(args[1], ctx, componentPath);
      return "boolean";
    case "and":
    case "or":
      if (args[0]) inferExprType(args[0], ctx, componentPath);
      if (args[1]) inferExprType(args[1], ctx, componentPath);
      return "boolean";
    case "if": {
      if (args[0]) {
        const condType = inferExprType(args[0], ctx, componentPath);
        if (condType !== "boolean" && condType !== "any" && condType !== "unknown") {
          ctx.diagnostics.push({
            severity: "warning",
            message: `Condition in 'if' expression has type '${condType}', expected boolean`,
            component: componentPath,
          });
        }
      }
      if (args[1]) inferExprType(args[1], ctx, componentPath);
      if (args[2]) inferExprType(args[2], ctx, componentPath);
      return "any";
    }
    case "+":
    case "-":
    case "*":
    case "/": {
      const types = args.map(arg => inferExprType(arg, ctx, componentPath));
      return headSym(expr) !== "/" && types.every(type => type === "int") ? "int" : "float";
    }
    case "pipe": {
      const inputType = args[0] ? inferExprType(args[0], ctx, componentPath) : "unknown";
      let outputType = inputType;
      for (const stage of args.slice(1)) {
        if (stage._tag === "Sym") {
          outputType = inferPipeType(stage.name.replace(/^:/, ""), outputType);
          continue;
        }
        if (stage._tag === "List") {
          const stageHead = headSym(stage);
          for (const arg of tail(stage)) inferNestedExpressions(arg, ctx, componentPath);
          outputType = inferPipeType(stageHead?.replace(/^:/, "") ?? "", outputType);
        }
      }
      return outputType;
    }
    default:
      for (const arg of args) inferNestedExpressions(arg, ctx, componentPath);
      return "unknown";
  }
}

function isBooleanCompatible(type: SimpleType): boolean {
  return type === "boolean" || type === "any" || type === "unknown";
}

function inferNestedExpressions(expr: SExpr, ctx: TreeContext, componentPath: string): void {
  switch (expr._tag) {
    case "List":
      inferExprType(expr, ctx, componentPath);
      return;
    case "Vector":
      for (const item of expr.items) inferNestedExpressions(item, ctx, componentPath);
      return;
    case "Map":
      for (const [key, value] of expr.pairs) {
        inferNestedExpressions(key, ctx, componentPath);
        inferNestedExpressions(value, ctx, componentPath);
      }
      return;
    default:
      return;
  }
}

function isKeywordForm(expr: SExpr): boolean {
  const head = headSym(expr);
  return head !== undefined && head.startsWith(":");
}

function literalPropValue(value: SExpr | undefined): string | undefined {
  if (!value) return undefined;
  if (value._tag === "Str") return value.value;
  if (value._tag === "Sym") return value.name.replace(/^:/, "");
  return undefined;
}

function resolvePropName(schema: DescriptorTreeComponentSchema, propName: string): string {
  return schema.aliases.get(propName) ?? propName;
}

function normalizeComponentType(raw: string | undefined): string | undefined {
  if (!raw) return undefined;
  return raw === "cond" ? "condition" : raw;
}

function childPolicy(schema: DescriptorTreeComponentSchema): DescriptorTreeChildrenSpec {
  return schema.treeSpec.children ?? { kind: "none" };
}

function validatePropValue(
  propName: string,
  value: SExpr,
  schema: DescriptorTreeComponentSchema,
  ctx: TreeContext,
  componentPath: string,
): void {
  const propSchema = schema.props[propName];
  if (!propSchema) {inferNestedExpressions(value,ctx,componentPath);return;}

  if (propSchema.values) {
    const literal=literalPropValue(value);
    if (!literal || !propSchema.values.includes(literal)) ctx.diagnostics.push({severity:"error",message:`Prop '${propName}' must be one of ${propSchema.values.join(", ")}`,component:componentPath});
  }
  if (propSchema.type === "expression" || propSchema.type === "any") {
    inferNestedExpressions(value, ctx, componentPath);
    return;
  }

  if (propSchema.type === "slot-content") {
    validateSlotContent(value, ctx, componentPath, componentPath.split(" > ").at(-1) ?? "");
    return;
  }

  if (propSchema.type === "string" && value._tag === "List") {
    inferExprType(value, ctx, componentPath);
    return;
  }

  if (propSchema.type === "boolean" && value._tag === "List") {
    const exprType = inferExprType(value, ctx, componentPath);
    if (exprType !== "boolean" && exprType !== "any" && exprType !== "unknown") {
      ctx.diagnostics.push({
        severity: "warning",
        message: `Prop '${propName}' expects a boolean but expression has type '${exprType}'`,
        component: componentPath,
      });
    }
    return;
  }

  if (["number", "int", "float"].includes(propSchema.type)) {
    const exprType = inferExprType(value, ctx, componentPath);
    if (exprType !== "any" && exprType !== "unknown" && !(propSchema.type === "int" ? exprType === "int" : ["number", "int", "float"].includes(exprType))) {
      ctx.diagnostics.push({
        severity: "warning",
        message: `Prop '${propName}' expects ${propSchema.type} but expression has type '${exprType}'`,
        component: componentPath,
      });
    }
    return;
  }

  if (propSchema.type === "object" || propSchema.type === "array") {
    inferNestedExpressions(value, ctx, componentPath);
    return;
  }


}

function validateSlotContent(
  value: SExpr,
  ctx: TreeContext,
  componentPath: string,
  parentType: string,
): void {
  if (value._tag === "Vector") {
    for (const item of value.items) {
      if (item._tag === "List" && headSym(item) && !headSym(item)!.startsWith(":")) {
        validateNode(item, ctx, componentPath, parentType);
      }
    }
    return;
  }

  if (value._tag === "List" && headSym(value) && !headSym(value)!.startsWith(":")) {
    validateNode(value, ctx, componentPath, parentType);
  }
}

function validateAction(expr: SExpr, ctx: TreeContext, componentPath: string): void {
  if (expr._tag === "Vector") {
    for (const item of expr.items) validateAction(item, ctx, componentPath);
    return;
  }

  if (expr._tag !== "List") return;

  const head = headSym(expr);
  const args = tail(expr);
  if (!head) return;

  const positional: SExpr[] = [];
  const keywords = new Map<string, SExpr | undefined>();
  for (const arg of args) {
    if (arg._tag === "List" && isKeywordForm(arg)) {
      const values = tail(arg);
      keywords.set(headSym(arg)!.slice(1), values.length === 1 ? values[0] : undefined);
    } else {
      positional.push(arg);
    }
  }

  for (const callbackName of ["on-success", "on-error", "on-finally"] as const) {
    const callback = keywords.get(callbackName);
    if (callback) validateAction(callback, ctx, componentPath);
  }

  switch (head) {
    case "set-state":
    case "patch-state":
    case "toggle-state": {
      const varName = positional[0] ? normalizeSymbol(positional[0]) : undefined;
      if (varName && !ctx.stateTypes.has(varName)) {
        ctx.diagnostics.push({
          severity: "error",
          message: `${head} references undeclared state variable '${varName}'`,
          component: componentPath,
        });
      }
      if (head === "toggle-state" && varName) {
        const stateType = ctx.stateTypes.get(varName);
        if (stateType && stateType !== "boolean" && stateType !== "any") {
          ctx.diagnostics.push({
            severity: "warning",
            message: `toggle-state usually targets boolean state, but '${varName}' has type '${stateType}'`,
            component: componentPath,
          });
        }
      }
      if (positional[1]) inferNestedExpressions(positional[1], ctx, componentPath);
      break;
    }
    case "run-query": {
      const queryName = positional[0] ? normalizeSymbol(positional[0]) : undefined;
      if (queryName && !ctx.queryNames.has(queryName)) {
        ctx.diagnostics.push({
          severity: "error",
          message: `run-query references undeclared query '${queryName}'`,
          component: componentPath,
        });
      }
      break;
    }
    case "run-queries":
      for (const item of positional) {
        if (item._tag === "Vector") {
          for (const nested of item.items) validateQueryActionArg(nested, ctx, componentPath);
        } else {
          validateQueryActionArg(item, ctx, componentPath);
        }
      }
      break;
    case "navigate":
    case "show-toast":
    case "toast":
    case "fetch":
    case "tool-call":
    case "send-message":
      if (positional[0]) inferNestedExpressions(positional[0], ctx, componentPath);
      break;
    case "emit":
      if (positional[1]) inferNestedExpressions(positional[1], ctx, componentPath);
      break;
    case "run-action":
    case "execute-action":
      if (positional[1]) inferNestedExpressions(positional[1], ctx, componentPath);
      break;
    case "update-context":
      if (keywords.get("content"))
        inferNestedExpressions(keywords.get("content")!, ctx, componentPath);
      if (keywords.get("structured-content"))
        inferNestedExpressions(keywords.get("structured-content")!, ctx, componentPath);
      break;
    case "request-display-mode": {
      const mode = literalPropValue(positional[0]);
      if (mode && mode !== "inline" && mode !== "fullscreen" && mode !== "pip") {
        ctx.diagnostics.push({
          severity: "error",
          message: `request-display-mode expects one of inline, fullscreen, pip (received '${mode}')`,
          component: componentPath,
        });
      }
      break;
    }
    case "open-dialog":
    case "close-dialog":
    case "open-file-picker":
      break;
    default:
      ctx.diagnostics.push({
        severity: "error",
        message: `Unknown action '${head}'. Valid actions: set-state, patch-state, toggle-state, run-query, run-queries, navigate, show-toast, toast, open-dialog, close-dialog, emit, execute-action, run-action, fetch, tool-call, request-display-mode, update-context, send-message, open-file-picker`,
        component: componentPath,
      });
  }

  for (const value of keywords.values()) {
    if (value) inferNestedExpressions(value, ctx, componentPath);
  }
}

function validateQueryActionArg(expr: SExpr, ctx: TreeContext, componentPath: string): void {
  const queryName = normalizeSymbol(expr);
  if (queryName && !ctx.queryNames.has(queryName)) {
    ctx.diagnostics.push({
      severity: "error",
      message: `run-queries references undeclared query '${queryName}'`,
      component: componentPath,
    });
  }
}

function validateNode(expr: SExpr, ctx: TreeContext, path: string, parentType?: string): void {
  if (expr._tag !== "List") return;

  const rawHead = headSym(expr);
  if (!rawHead || rawHead.startsWith(":")) return;

  const componentType = normalizeComponentType(rawHead)!;
  const componentPath = path ? `${path} > ${componentType}` : componentType;
  const items = tail(expr);

  const schema = ctx.componentSchemas[componentType];
  if (!schema) {
    ctx.diagnostics.push({
      severity: "error",
      message: `Unknown component type '${componentType}'. Valid types: ${Object.keys(ctx.componentSchemas).join(", ")}`,
      component: componentPath,
    });
    for (const item of items) {
      if (item._tag === "List" && headSym(item) && !headSym(item)!.startsWith(":")) {
        validateNode(item, ctx, componentPath, componentType);
      }
    }
    return;
  }

  const foundProps = new Set<string>();
  const literalProps = new Map<string, string>();
  const children: SExpr[] = [];
  const propState: PropValidationState = {
    hasBind: false,
    bindExpr: undefined,
  };

  for (let index=0;index<items.length;index++) {
    const item=items[index]!;
    if (item._tag === "Sym" && item.name.startsWith(":")) {
      const value=items[++index];
      if (value) validatePropEntry(item.name.slice(1),value,schema,ctx,componentType,componentPath,foundProps,literalProps,propState);
      continue;
    }
    if (item._tag === "Str" || item._tag === "Num" || item._tag === "Bool" || item._tag === "Sym") {
      const positional = schema.treeSpec.positionalProp;
      if (positional) {
        foundProps.add(positional);
        const literal = literalPropValue(item);
        if (literal) literalProps.set(positional, literal);
      }
      continue;
    }

    if (item._tag === "Map") {
      for (const [key, value] of item.pairs) {
        const keyStr = key._tag === "Sym" ? key.name.replace(/^:/, "") : undefined;
        if (!keyStr) continue;
        validatePropEntry(
          keyStr,
          value,
          schema,
          ctx,
          componentType,
          componentPath,
          foundProps,
          literalProps,
          propState,
        );
      }
      continue;
    }

    if (item._tag === "List" && isKeywordForm(item)) {
      const keyword = headSym(item)!.slice(1);
      const valueItems = tail(item);
      const value = valueItems.length === 1 ? valueItems[0] : undefined;
      if (value) {
        validatePropEntry(
          keyword,
          value,
          schema,
          ctx,
          componentType,
          componentPath,
          foundProps,
          literalProps,
          propState,
        );
      }
      continue;
    }

    if (item._tag === "List") {
      const childHead = headSym(item);
      if (childHead && !childHead.startsWith(":")) children.push(item);
    }
  }

  for (const [propName, propSchema] of Object.entries(schema.props)) {
    if (propSchema.required && !foundProps.has(propName)) {
      ctx.diagnostics.push({
        severity: "error",
        message: `Missing required prop '${propName}' on '${componentType}'`,
        component: componentPath,
      });
    }
  }

  validateChildren(componentType, schema, children, ctx, componentPath, parentType);
  validateStructuralComponentSemantics(
    componentType,
    propState.hasBind,
    propState.bindExpr,
    literalProps,
    children,
    ctx,
    componentPath,
  );

  for (const child of children) {
    validateNode(child, ctx, componentPath, componentType);
  }
}

interface PropValidationState {
  hasBind: boolean;
  bindExpr: SExpr | undefined;
}

function validatePropEntry(
  rawKey: string,
  value: SExpr,
  schema: DescriptorTreeComponentSchema,
  ctx: TreeContext,
  componentType: string,
  componentPath: string,
  foundProps: Set<string>,
  literalProps: Map<string, string>,
  state: PropValidationState,
): void {
  const camelKey = resolvePropName(schema, toCamelCase(rawKey));

  if (camelKey === "bind" || camelKey === "visible") {
    if (camelKey === "visible") {
      const visType = inferExprType(value, ctx, componentPath);
      if (!isBooleanCompatible(visType)) {
        ctx.diagnostics.push({
          severity: "error",
          message: `'visible' expression has type '${visType}', expected boolean`,
          component: componentPath,
        });
      }
    }
    if (camelKey === "bind") {
      state.hasBind = true;
      state.bindExpr = value;
      inferExprType(value, ctx, componentPath);
      if (schema.treeSpec.allowsBind !== true) {
        ctx.diagnostics.push({
          severity: "warning",
          message: `Component '${componentType}' does not typically use data binding`,
          component: componentPath,
        });
      }
    }
    return;
  }

  if (schema.treeSpec.events?.includes(rawKey)) {
    validateAction(value, ctx, componentPath);
    return;
  }

  foundProps.add(camelKey);
  const literal = literalPropValue(value);
  if (literal) literalProps.set(camelKey, literal);
  validatePropValue(camelKey, value, schema, ctx, componentPath);
}

function validateChildren(
  componentType: string,
  schema: DescriptorTreeComponentSchema,
  children: readonly SExpr[],
  ctx: TreeContext,
  componentPath: string,
  parentType: string | undefined,
): void {
  const componentChildPolicy = childPolicy(schema);
  if (children.length > 0 && componentChildPolicy.kind === "none") {
    ctx.diagnostics.push({
      severity: "warning",
      message: `Component '${componentType}' does not expect child components (found ${children.length})`,
      component: componentPath,
    });
  }

  if (componentChildPolicy.kind === "only") {
    for (const child of children) {
      const normalizedChild = normalizeComponentType(headSym(child));
      if (!normalizedChild || !componentChildPolicy.types.includes(normalizedChild)) {
        ctx.diagnostics.push({
          severity: "error",
          message: `'${componentType}' only accepts ${componentChildPolicy.types.map((type) => `'${type}'`).join(", ")} children`,
          component: componentPath,
        });
      }
    }
  }

  if (schema.treeSpec.parents && schema.treeSpec.parents.length > 0) {
    if (!parentType || !schema.treeSpec.parents.includes(parentType)) {
      ctx.diagnostics.push({
        severity: "error",
        message: `'${componentType}' must appear directly under ${schema.treeSpec.parents.map((type) => `'${type}'`).join(", ")}`,
        component: componentPath,
      });
    }
  }
}

function validateStructuralComponentSemantics(
  componentType: string,
  hasBind: boolean,
  bindExpr: SExpr | undefined,
  literalProps: ReadonlyMap<string, string>,
  children: readonly SExpr[],
  ctx: TreeContext,
  componentPath: string,
): void {
  if (componentType === "for-each") {
    if (!hasBind || !bindExpr) {
      ctx.diagnostics.push({
        severity: "error",
        message: `'for-each' requires a :bind expression that resolves to a list`,
        component: componentPath,
      });
    } else {
      const bindType = inferExprType(bindExpr, ctx, componentPath);
      if (bindType !== "list" && bindType !== "any" && bindType !== "unknown") {
        ctx.diagnostics.push({
          severity: "warning",
          message: `'for-each' is usually bound to a list, but received '${bindType}'`,
          component: componentPath,
        });
      }
    }
  }

  if (componentType === "condition") {
    let elseCount = 0;
    for (const child of children) {
      const normalizedChild = normalizeComponentType(headSym(child));
      if (normalizedChild === "else") elseCount += 1;
    }
    if (elseCount > 1) {
      ctx.diagnostics.push({
        severity: "error",
        message: `'condition' accepts at most one 'else' child`,
        component: componentPath,
      });
    }
  }

  if (componentType === "use") {
    const defName = literalProps.get("name");
    if (defName && !ctx.defNames.has(defName)) {
      ctx.diagnostics.push({
        severity: "error",
        message: `use references unknown def '${defName}'. Declared defs: ${[...ctx.defNames].join(", ") || "(none)"}`,
        component: componentPath,
      });
    }
  }
}

export function typeCheckDescriptorTree(
  input: DescriptorTreeCheckInput,
): DescriptorTreeCheckResult {
  const componentSchemas = buildDescriptorTreeComponentSchemas(
    input.descriptors,
    input.extensionKey,
  );
  const stateTypes =
    input.stateVars instanceof Map
      ? new Map(
          [...input.stateVars.entries()].map(([name, kind]) => [
            name,
            simpleTypeFromStateKind(kind),
          ]),
        )
      : new Map([...input.stateVars].map((name) => [name, "any" as SimpleType]));

  const ctx: TreeContext = {
    stateTypes,
    queryNames: input.queryNames,
    inputParams: input.inputParams,
    defNames: input.defNames ?? new Set<string>(),
    componentSchemas,
    diagnostics: [],
  };

  validateNode(input.layout, ctx, "");

  return {
    diagnostics: ctx.diagnostics,
    hasErrors: ctx.diagnostics.some((diagnostic) => diagnostic.severity === "error"),
  };
}
