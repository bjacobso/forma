(import "./domain.lisp" [Greeting])
(import "forma:effect/rpc" [rpc-group rpc])
(export Greetings)
(rpc-group Greetings (rpc "Greet" :payload String :success Greeting))
