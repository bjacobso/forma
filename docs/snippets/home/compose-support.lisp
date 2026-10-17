(import "./tools.forma" [tool])
(import "./agents.forma" [allow])

(tool refund "Refund an order.")
(allow support-refunds refund)
(allow support-deletes delete-account)
