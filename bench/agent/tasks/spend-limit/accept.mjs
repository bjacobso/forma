import { acceptForm } from "../../accept-support.mjs";
export const accept = dir => acceptForm(dir, {
  "valid": "(import \"./forms.lisp\" [spend])\n(spend hidden0 -3)\n(spend hidden1 0)\n(spend hidden2 100)",
  "payloads": [
    {
      "kind": "Spend",
      "name": "hidden0",
      "amount": -3
    },
    {
      "kind": "Spend",
      "name": "hidden1",
      "amount": 0
    },
    {
      "kind": "Spend",
      "name": "hidden2",
      "amount": 100
    }
  ],
  "invalid": [
    "(import \"./forms.lisp\" [spend])\n(spend rejected 101)"
  ],
  "code": "spend/over-limit"
});
