(entity Department {:name String})

(entity Employee {:name String
    :department (Option (Id Department))
    :active Bool})

(query employee-directory
  :from Employee
  :where active
  :select [name department])
