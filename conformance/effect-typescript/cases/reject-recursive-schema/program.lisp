;; Recursive schemas need Schema.suspend, which Forma does not generate yet,
;; so they are rejected instead of producing a module that fails at load.
(define-schema Category
  (Struct
    (field name String)
    (field children (Array Category))))

(define-schema Node (Struct (field value Int) (field next (Optional Link))))
(define-schema Link (Struct (field target Node)))
