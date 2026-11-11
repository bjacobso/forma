(import "./valid.lisp" [post-url])
(define inspect-post [params]
  (post-url params)
  (get params :poost))
