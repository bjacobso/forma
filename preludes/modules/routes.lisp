; A structured route template derives a URL builder's parameter record.
; Import explicitly; no compiler hooks or host-side route generator required.
(export route)

; Literal segments are strings; [:name] is a required String parameter.
; Parameter values are already URL-encoded path segments, not arbitrary text.
(macro (route builder segments)
  (if (sexpr-vector? segments) nil (fail "route requires a vector of segments"))
  (let [parts (sexpr-items segments)
        captures (filter (fn [part] (sexpr-vector? part)) parts)
        field (fn [capture]
                (let [items (sexpr-items capture)]
                  (if (= (count items) 1)
                    (let [name (sexpr-sym-name (first items))]
                      (if (if (= name nil) false (starts-with? name ":"))
                        (keyword name)
                        (fail "route capture must contain one keyword")))
                    (fail "route capture must contain one keyword"))))
        contract (reduce (fn [fields capture] (assoc fields (field capture) 'String)) {} captures)
        params (gensym "params")
        pieces (map (fn [part]
                      (if (sexpr-vector? part)
                        `(get ~params ~(field part))
                        `(: ~part String))) parts)]
    `(define ~builder
       (: (fn [~params]
            ~(if (= (count parts) 0)
               "/"
               `(str ~@(reduce (fn [out piece] (concat out ["/" piece])) [] pieces))))
          (~(sym "->") ~contract String)))))
