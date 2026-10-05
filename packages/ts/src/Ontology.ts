/**
 * Typed elaboration for the bundled ontology DSL (`define-entity`,
 * `define-relation`, `define-action`, `define-query`, ...).
 *
 * @module Ontology
 */

export {
  elaborateOntology,
  ontologyScalarTypes,
  parseOntologyType,
  runtimeLiteralsToStrings,
  type ActionDeclaration,
  type ElaborateOntologyOptions,
  type ElaborateOntologyResult,
  type EntityDeclaration,
  type OntologyDeclaration,
  type OntologyField,
  type OntologyInput,
  type OntologyModel,
  type OntologyType,
  type QueryDeclaration,
  type RelationDeclaration,
} from "./ontology/elaborate-ontology.js";
