(import "./bench/agent/fixtures/described-domain/quota-lib.lisp" [quota-tier])
(import "./policy.lisp" [service-policy])

(quota-tier default-pro :plan "pro" :max-rpm 500)
(service-policy checkout-us :plan "free" :region "us" :rpm 50 :burst 25 :status "active")
(service-policy search-eu :plan "pro" :region "eu" :rpm 400 :burst 200 :status "active")
(service-policy beta-ap :plan "free" :region "ap" :rpm 40 :burst 10 :status "draft")
