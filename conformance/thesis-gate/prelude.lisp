; thesis-gate.lisp
; -----------------------------------------------------------------------------
; Minimal descriptor fixture for the Forma thesis gate.
;
; This avoids consumer-specific domain vocabulary. The goal is to prove that an
; authored descriptor-backed form reaches bidirectional typechecking and that a
; boundary mismatch returns a located HM diagnostic.
; -----------------------------------------------------------------------------

(__form-descriptor literal-type
  (:check-fn literal-type/check))

(__form-descriptor expected-echo
  (:check-fn expected-echo/check))

(__form-descriptor checked-bool
  (:check-fn checked-bool/check))

(__form-descriptor inferred-type
  (:infer-fn inferred-type/infer))

(__form-descriptor typed-field
  (:slots
    (slot field value
      (:child-identifier name Value)
      (:child-slot value expr (:positional true) (:type Bool)))))

(__form-descriptor repeated-bool
  (:slots
    (slot item expr (:many true) (:type Bool))))

(__macro bool-wrapper [value]
  `(repeated-bool (:item ~value)))

(__form-hook literal-type/check
  (:kind check)
  (:body
    (if (= (get-in input [:args 0 :kind]) "literal")
      (if (= (get-in input [:args 0 :value]) true)
        "Bool"
        "String")
      "Any")))

(__form-hook expected-echo/check
  (:kind check)
  (:body (get input :expected-type)))

(__form-hook checked-bool/check
  (:kind check)
  (:body
    (meta/check-expr
      input
      (meta/positional-arg input 0)
      (type/constant "Bool"))))

(__form-hook inferred-type/infer
  (:kind infer)
  (:body
    (meta/infer-expr-type input (meta/positional-arg input 0))))
