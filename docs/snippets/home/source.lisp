(define-entity Department
  (:field [department/name String {:required true}]))

(define-entity Employee
  (:field [employee/name String {:required true}])
  (:field [employee/department (Ref Department)])
  (:field [employee/active Bool]))

(define-query employee-directory
  (:from Employee)
  (:where employee/active)
  (:select [employee/name employee/department]))
