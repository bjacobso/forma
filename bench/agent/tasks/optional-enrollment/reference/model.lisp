(export Address Contact Member)
(type Address {:city String :unit (Option String)})
(type Contact {:email (Option String) :address (Option Address)})
(type Member {:name String :contact (Option Contact) :credits (Option Int)})
