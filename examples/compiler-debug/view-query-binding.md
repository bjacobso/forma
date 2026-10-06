# Query-backed View

```lisp
(export employee-directory-view)
(view employee-directory-view
  :query employee-directory
  :subject session
  :title "Employee Directory"
  :description "Compact compiler fixture for a query-backed table view."
  :mode "table"
  :empty-state "No employees found."
  :row-action :read
  (column :employee/name)
  (column :employee/status))
```
