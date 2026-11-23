;; A tagged union case cannot have a field named like its discriminator.
(type Shape (Tagged :tag kind (Circle {:kind String :radius Float})))
