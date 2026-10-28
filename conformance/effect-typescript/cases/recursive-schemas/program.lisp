;; Recursive schemas reach themselves through Schema.suspend, directly or
;; through each other. Refined fields check patterns, lengths, and ranges
;; when untrusted JSON is decoded.
(type Slug (String :pattern "^[a-z][a-z0-9-]*$"))
(type
  Rule
  (Union
    {:kind "present" :attribute Slug}
    {:kind "equals" :attribute Slug :value String}
    {:kind "all" :rules (List Rule)}
    {:kind "not" :rule Rule}))
(type Tree (Tagged (Leaf {:value Int}) (Branch {:children (List Tree)})))
(type Section {:title (String :min-length 1) :next (Option Link)})
(type Link {:weight (Int :min 0 :max 10) :target Section})
(type
  Property
  {
    :name Slug
    :label (String :min-length 1 :max-length 40)
    :tags (List String :max-length 3)
    :visible-when (Option Rule)})
(error InvalidProperty {:message String})
(: total (-> Tree Int))
(define
  total
  [tree]
  (match
    tree
    (Leaf leaf)
    (get leaf :value)
    (Branch branch)
    (sum (map total (get branch :children)))))
(: both (-> Rule Rule Rule))
(define both [left right] {:kind "all" :rules [left right]})
(: parse-property (-> Json (Effect Property [InvalidProperty] [])))
(define
  parse-property
  [input]
  (catch
    (decode Property input)
    (SchemaError _)
    (fail (InvalidProperty {:message "property does not match the schema"}))))
