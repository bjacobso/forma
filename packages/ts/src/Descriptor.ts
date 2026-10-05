/**
 * Self-describing form system: descriptors, hooks, registries, parser, bootstrap.
 *
 * This is the public API for the two-layer architecture:
 * - Description Layer: FormDescriptor, FormDescriptorRegistry
 * - Elaboration Layer: ElaborationHook, ElaborationRegistry
 * - Bootstrap: load preludes and register forms + hooks
 *
 * @module Descriptor
 */

// Description layer
export type {
  FormDescriptor,
  IdentifierSpec,
  SlotSpec,
  SlotMode,
  ChildFormShape,
  DescriptorExtensionValue,
  DescriptorExtensions,
  BindingStrategy,
  BindingRule,
  ValidationStrategy,
  ValidationCheck,
  ElaborationStrategy,
  ElaborationOpcode,
  ResultTypeStrategy,
  ConstructSpec,
  ConstructField,
} from "./descriptor/FormDescriptor.js";

export { FormDescriptorRegistry } from "./descriptor/FormDescriptorRegistry.js";

// Elaboration layer
export type {
  ElaborationHook,
  HookKind,
  HookInput,
  HookOutput,
  NormalizedChildForm,
  NormalizedSlots,
  SemanticEnvironment,
  SemanticFactValue,
  DeclaredName,
  BindingMap,
  Diagnostic,
} from "./descriptor/ElaborationHook.js";

export { ElaborationError } from "./descriptor/ElaborationHook.js";
export { ElaborationRegistry } from "./descriptor/ElaborationRegistry.js";
export type {
  ElaborationDescriptor,
  ElaborationField,
  ElaborationObjectField,
  ElaborationSource,
} from "./descriptor/ElaborationDescriptor.js";
export {
  ElaborationDescriptorSyntaxError,
  parseElaborationDescriptor,
} from "./descriptor/ElaborationDescriptor.js";
export { ElaborationDescriptorRegistry } from "./descriptor/ElaborationDescriptorRegistry.js";

// Concrete implementations
export { SimpleNormalizedSlots, type SlotValue } from "./descriptor/NormalizedSlots.js";
export { SimpleSemanticEnvironment } from "./descriptor/SemanticEnvironment.js";

// Parser
export {
  parseFormDescriptors,
  parseFormDescriptor,
  parseFormDescriptorForms,
  FormDescriptorSyntaxError,
} from "./descriptor/parse-descriptor.js";
export type { MetaFnDecl } from "./descriptor/meta-fn-decl.js";
export { parseMetaFnDecl, parsePrelude } from "./descriptor/meta-fn-decl.js";

// Runtime expressions embedded in construct output
export {
  RUNTIME_STRING_LITERAL_KEY,
  RUNTIME_STRING_LITERAL_KIND,
  isRuntimeStringLiteral,
} from "./descriptor/runtime-expr.js";

// Meta-fn execution
export { createMetaFnHook } from "./descriptor/meta-fn-executor.js";
export {
  createElaborationDescriptorHook,
  runElaborationDescriptor,
} from "./descriptor/elaboration-executor.js";
export {
  createMetaBuiltins,
  type HostedMetaBuiltinsFactory,
  type HostedDslMetaContext,
  type MetaBuiltinsContext,
  type MetaBuiltinsOptions,
} from "./descriptor/meta-builtins.js";
export {
  buildDescriptorTreeLayoutAliases,
  rewriteDescriptorTreeLayoutAliases,
  type DescriptorTreeAliasTarget,
} from "./descriptor/descriptor-tree-aliases.js";
export {
  buildDescriptorTreeComponentSchemas,
  typeCheckDescriptorTree,
  type DescriptorTreeCheckInput,
  type DescriptorTreeCheckResult,
  type DescriptorTreeComponentSchema,
  type DescriptorTreeDiagnostic,
  type DescriptorTreePropSchema,
  type DescriptorTreePropType,
} from "./descriptor/descriptor-tree-check.js";
export {
  findDescriptorTreeProtocolRegistry,
  readDescriptorTreeComponentSpec,
  readDescriptorTreeCompileSpec,
  readDescriptorTreeProtocolRegistry,
  type DescriptorTreeChildrenSpec,
  type DescriptorTreeCompileSpec,
  type DescriptorTreeComponentSpec,
  type DescriptorTreeProtocolRegistry,
  type DescriptorTreeSlotCompileKind,
  type DescriptorTreeSlotCompileSpec,
} from "./descriptor/descriptor-tree-metadata.js";
export {
  buildDescriptorTreeCompileSpecs,
  compileDescriptorTree,
  type DescriptorTreeCompileInput,
} from "./descriptor/descriptor-tree-compile.js";
export {
  PROTOCOL_MODULE_EXTENSION_KEY,
  PROTOCOL_OBJECT_EXTENSION_KEY,
  PROTOCOL_CATALOG_EXTENSION_KEY,
  PROTOCOL_ENUM_EXTENSION_KEY,
  PROTOCOL_TYPE_EXTENSION_KEY,
  PROTOCOL_UNION_EXTENSION_KEY,
  buildProtocolCatalogDescriptors,
  buildProtocolEnumDescriptors,
  buildProtocolModuleDescriptors,
  buildProtocolObjectDescriptors,
  buildProtocolTypeAliasDescriptors,
  buildProtocolUnionDescriptors,
  parseProtocolType,
  readProtocolEnumDescriptor,
  readProtocolCatalogDescriptor,
  readProtocolModuleDescriptor,
  readProtocolObjectDescriptor,
  readProtocolTypeAliasDescriptor,
  readProtocolUnionDescriptor,
  type ProtocolEnumDescriptor,
  type ProtocolCatalogDescriptor,
  type ProtocolLiteralSchemaDescriptor,
  type ProtocolModuleDescriptor,
  type ProtocolModuleImportDescriptor,
  type ProtocolObjectDescriptor,
  type ProtocolObjectFieldDescriptor,
  type ProtocolPrimitiveType,
  type ProtocolScalarLiteral,
  type ProtocolTypeAliasDescriptor,
  type ProtocolTypeDescriptor,
  type ProtocolUnionDescriptor,
  type ProtocolUnionMemberDescriptor,
} from "./descriptor/protocol-descriptor.js";
export {
  createProtocolSchemaRefResolver,
  emitProtocolEnumSchema,
  emitProtocolInterface,
  emitProtocolLiteralSchema,
  emitProtocolModule,
  emitProtocolModuleImports,
  emitProtocolObjectSchema,
  emitProtocolTypeAlias,
  emitProtocolTypeAliasSchema,
  emitProtocolUnionSchema,
  emitProtocolUnionType,
  protocolEnumsForModule,
  protocolObjectsForModule,
  protocolObjectsForUnion,
  protocolTypeAliasesForModule,
  protocolUnionsForModule,
  requiredProtocolEnum,
  requiredProtocolModule,
  requiredProtocolObject,
  requiredProtocolTypeAlias,
  requiredProtocolUnion,
  safeProtocolFieldName,
  schemaProtocolType,
  tsProtocolType,
  type EmitProtocolSchemaOptions,
  type EmitProtocolLiteralSchemaOptions,
  type EmitProtocolModuleOptions,
  type EmitProtocolUnionSchemaOptions,
  type ProtocolModuleImportEmitterOptions,
  type ProtocolSchemaRefResolverOptions,
  type ProtocolSchemaRefResolver,
} from "./descriptor/protocol-effect-schema.js";

// Bootstrap
export type {
  BootstrappedPrelude,
  BootstrapOptions,
  HostedDsl,
  BootstrappedHostedDsl,
} from "./descriptor/bootstrap.js";
export { bootstrapFromSources, bootstrapFromFiles } from "./descriptor/bootstrap.js";

// Form recognition and normalization
export { recognizeForm, recognizeForms, type RecognizedForm } from "./descriptor/recognize.js";
export { normalizeForm, type NormalizedForm } from "./descriptor/normalize.js";

// One-call elaboration with located diagnostics
export {
  ElaborationFailure,
  declarationDiagnostic,
  elaborateProgram,
  elaborateProgramOrThrow,
  elaborateSources,
  formatDiagnostic,
  isJsonRuntimeStringLiteral,
  sourceLocator,
  toJsonValue,
  type ElaborateProgramOptions,
  type ElaborateProgramResult,
  type ElaboratedDeclaration,
  type ProgramSource,
} from "./descriptor/elaborate.js";

// Descriptor codegen
export type {
  GeneratedSchemaModule,
  GenerateEffectSchemaModuleOptions,
} from "./descriptor/descriptor-to-schema.js";
export { generateEffectSchemaModule } from "./descriptor/descriptor-to-schema.js";
