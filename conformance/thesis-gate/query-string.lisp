(entity Employee {:active Bool
    :name String})

(query active-employees
  :from Employee
  :where name
  :select [name])
