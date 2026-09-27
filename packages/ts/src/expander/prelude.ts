/**
 * Lisp Prelude — self-hosted sugar macros.
 *
 * These 7 macros replace hardcoded TypeScript special forms in eval.ts:
 * not, when, cond, and, or, ->, ->>
 *
 * The prelude environment is provided as an Effect service (PreludeEnv).
 * Use `makePreludeLayer` from eval.ts to create the layer.
 *
 * @module
 */

import { Context } from "effect";
import type { Env } from "../Env.js";

/**
 * Effect service providing the prelude environment.
 * Contains macro definitions (not, when, cond, and, or, ->, ->>).
 */
export class PreludeEnv extends Context.Service<PreludeEnv, Env>()("PreludeEnv") {}

/**
 * The prelude source — pure Lisp defining 7 sugar macros.
 *
 * Order matters: later macros may use earlier ones in their expansions.
 */
export const PRELUDE_SOURCE = `
;; not — logical negation
(define-macro not [x]
  \`(if ~x false true))

;; when — conditional with implicit do
(define-macro when [test & body]
  \`(if ~test (do ~@body) nil))

;; cond — multi-branch conditional
(define-macro cond [& clauses]
  (if (empty? clauses)
    nil
    (let [test (first clauses)
          expr (nth clauses 1)
          rest-clauses (rest (rest clauses))]
      (if (= (sexpr-sym-name test) ":else")
        expr
        (if (empty? rest-clauses)
          \`(if ~test ~expr nil)
          \`(if ~test ~expr (cond ~@rest-clauses)))))))

;; and — short-circuit logical AND
(define-macro and [& args]
  (if (empty? args)
    true
    (if (= (count args) 1)
      (first args)
      (let [g (gensym "and")]
        \`(let [~g ~(first args)]
           (if ~g (and ~@(rest args)) ~g))))))

;; or — short-circuit logical OR
(define-macro or [& args]
  (if (empty? args)
    nil
    (if (= (count args) 1)
      (first args)
      (let [g (gensym "or")]
        \`(let [~g ~(first args)]
           (if ~g ~g (or ~@(rest args))))))))

;; -> — thread-first
(define-macro -> [x & forms]
  (if (empty? forms)
    x
    (let [form (first forms)
          rest-forms (rest forms)
          threaded (if (sexpr-list? form)
                     (let [items (sexpr-items form)
                           head (first items)
                           rest-args (rest items)]
                       \`(~head ~x ~@rest-args))
                     \`(~form ~x))]
      (if (empty? rest-forms)
        threaded
        \`(-> ~threaded ~@rest-forms)))))

;; ->> — thread-last
(define-macro ->> [x & forms]
  (if (empty? forms)
    x
    (let [form (first forms)
          rest-forms (rest forms)
          threaded (if (sexpr-list? form)
                     (let [items (sexpr-items form)]
                       \`(~@items ~x))
                     \`(~form ~x))]
      (if (empty? rest-forms)
        threaded
        \`(->> ~threaded ~@rest-forms)))))
`;
