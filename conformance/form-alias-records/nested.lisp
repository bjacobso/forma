(type Item {:id String})
(type CheckedIR {:ok Bool})
(form (optional item)
  :types {:item (Expr (Option Item))}
  :ir CheckedIR
  {:ok true})
(form (nested items)
  :types {:items (Expr (List (List Item)))}
  :ir CheckedIR
  {:ok true})
(optional (Some {:id "a"}))
(nested [[{:id "b"}] []])
