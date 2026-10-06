(define emitter
   [attr]
    (fn [f fs]
      [[(nth f 0) attr "value"]]))

(emitter "must")
