(entity Employee {:active Bool
    :name String})

(query active-employees
  :from Employee
  :where active
  :select [name])
