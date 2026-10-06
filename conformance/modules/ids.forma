(export CustomerId Customer make-customer)
(type CustomerId (Brand String))
(class Customer {:id CustomerId :name String})
(: make-customer (-> CustomerId String Customer))
(define make-customer [id name]
  (Customer {:id id :name name}))
