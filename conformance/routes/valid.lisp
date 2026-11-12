(import "../../preludes/modules/routes.lisp" [route])
(export post-url team-url root-url mirror-url example team root mirror)

(route post-url ["users" [:id] "posts" [:post]])
(define example (post-url {:id "alice" :post "intro"}))

; Different names/order prevent a canned id/post contract from passing.
(route team-url ["teams" [:team] "members" [:member]])
(define team (team-url {:member "bob%20smith" :team "eng"}))

(route root-url [])
(define root (root-url {}))

; Repeating a capture reuses the same required field.
(route mirror-url ["mirror" [:item] [:item]])
(define mirror (mirror-url {:item "blue"}))
