(entity Employee {:status String})

(query active-employees
  :from Employee
  :where (= status "active")
  :select [status])
