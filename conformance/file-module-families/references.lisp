(export item catalog)
(type ItemDef Symbol)
(type ItemIR {:name Symbol})
(form (item name) :types {:name (Declares ItemDef)} :ir ItemIR {:name name})
(type Selection {:target (Refers ItemDef) :count Int})
(type CatalogIR {:name Symbol :items (List Symbol) :selection {:target Symbol :count Int}})
(form (catalog name {:keys [items selection]})
  :types {:name (Declares CatalogDef) :items (Option (List (Refers ItemDef))) :selection Selection}
  :ir CatalogIR {:name name :items items :selection selection})
