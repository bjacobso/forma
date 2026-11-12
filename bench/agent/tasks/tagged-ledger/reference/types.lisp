(export Role Event Summary)
(type Role (Union :manager :finance :auditor))
(type Event (Tagged (Charge {:cents Int :role Role}) (Refund {:cents Int}) Void))
(type Summary {:net Int :charges Int :roles (List Role)})
