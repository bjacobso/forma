(type Item {:id String})
(type BundleIR {:items (List Item)})
(form (bundle items)
  :types {:items (Expr (List Item))}
  :ir BundleIR
  {:items items})
(bundle [{:id 42}])
