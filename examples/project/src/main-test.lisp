(import "./test-support.lisp" [test is=])
(import "./data.lisp" [message])
(test "the example message" (is= message "Hello from Forma"))
