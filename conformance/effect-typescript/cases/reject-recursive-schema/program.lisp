;; Recursive schemas are typed Schema.Codec<T>, which needs the decoded and
;; encoded shapes to agree. Brands and classes make them differ, so recursion
;; through either is rejected instead of producing a module that fails to
;; typecheck.
(type CategoryId (Brand String))
(type Category {:id CategoryId
 :children (List Category)})

(class Folder {:name String :parent (Option Entry)})
(type Entry {:folder Folder})
