(export Role Facts Decision)
(type Role (Union "manager" "finance" "ciso"))
(type Facts {:amount Int :role Role :approved-on Int :as-of Int :reason String})
(type Decision {:allowed Bool :due Int :reason String})
