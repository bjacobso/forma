(import "forma:test" [test is is=])
(test "structural equality" (is= [{:answer 42}] [{:answer 42}]))
(test "multiple assertions" (is true) (is= "hello" "hello"))
(test "builtin value calls" (let [f +] (is= (f 1 2) 3)))
