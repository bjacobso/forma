import { entryForms, projected, rejectedAt } from "../../hard-support.mjs";

export async function accept(dir) {
  const reasons = [
    ...entryForms(dir, "QuotaTier", 1),
    ...entryForms(dir, "ServicePolicy", 3),
  ];
  reasons.push(...await projected(dir, `(import "./policy.lisp" [service-policy])
(service-policy api-free :plan "free" :region "us" :rpm 60 :burst 20 :status "active")
(service-policy api-pro :plan "pro" :region "eu" :rpm 500 :burst 900 :status "active")
(service-policy api-draft :plan "free" :region "ap" :rpm 30 :burst 0 :status "draft")
(service-policy api-ent :plan "enterprise" :region "ap" :rpm 6000 :burst 1500 :status "active")`, [
    { kind: "ServicePolicy", name: "api-free", plan: "free", region: "us", rpm: 60, burst: 20, "effective-burst": 80, status: "active" },
    { kind: "ServicePolicy", name: "api-pro", plan: "pro", region: "eu", rpm: 500, burst: 900, "effective-burst": 1000, status: "active" },
    { kind: "ServicePolicy", name: "api-draft", plan: "free", region: "ap", rpm: 30, burst: 0, "effective-burst": 30, status: "draft" },
    { kind: "ServicePolicy", name: "api-ent", plan: "enterprise", region: "ap", rpm: 6000, burst: 1500, "effective-burst": 7500, status: "active" },
  ]));
  reasons.push(...await rejectedAt(dir, `(import "./policy.lisp" [service-policy])
(service-policy bad-multi :plan "free" :region "eu" :rpm 61 :burst -5 :status "active")`, [
    { code: "quota/rpm-out-of-range", token: "61" },
    { code: "quota/negative-burst", token: "-5" },
    { code: "quota/region-not-allowed", token: '"eu"' },
  ]));
  reasons.push(...await rejectedAt(dir, `(import "./policy.lisp" [service-policy])
(service-policy zero-rpm :plan "pro" :region "us" :rpm 0 :burst 10 :status "draft")`, [
    { code: "quota/rpm-out-of-range", token: "0" },
  ]));
  return { pass: reasons.length === 0, reasons };
}
