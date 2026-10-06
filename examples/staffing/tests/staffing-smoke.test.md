## Staffing Smoke Tests

```lisp
(test
  seeded-employees-are-available
  (:assert
    (query-count
      (:query
        (datalog (find ?employee) (where [?employee :_schema/type "Employee"])))
      (:gte 6))))
(test
  known-staffing-employee-facts-are-queryable
  (:arrange
    (pick
      Employee
      (:bind employee)
      (:where
        (datalog
          (find ?employee)
          (where [?employee :employee/first-name "Alice"])))))
  (:assert
    (entity-attr
      (:entity employee)
      (:attr :employee/last-name)
      (:expected "Johnson")))
  (:assert
    (no-violations (:entity employee) (:constraint employee-email-required))))
(test
  seeded-onboarding-requirement-records-are-queryable-for-david
  (:assert
    (query-count
      (:query
        (datalog
          (find ?task)
          (where
            [?task :_schema/type "OnboardingTask"]
            [?task :onboardingtask/title "I-9 Employment Eligibility"]
            [?task :onboardingtask/status "submitted"])))
      (:eq 1))))
```
