;; Recursive schemas need Schema.suspend, which Forma does not generate yet,
;; so they are rejected instead of producing a module that fails at load.
(type Category {:name String
 :children (List Category)})

(type Node {:value Int
 :next (Option Link)})
(type Link {:target Node})
