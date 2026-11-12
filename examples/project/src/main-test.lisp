(import "forma:test" [test is=])
(import "./data.lisp" [message])
(test "the example message" (is= message "Hello from Forma"))
