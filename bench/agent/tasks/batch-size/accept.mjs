import { acceptForm } from "../../accept-support.mjs";
export const accept = dir => acceptForm(dir, {
  "valid": "(import \"./forms.lisp\" [batch])\n(batch hidden0 1)\n(batch hidden1 50)",
  "payloads": [
    {
      "kind": "Batch",
      "name": "hidden0",
      "size": 1
    },
    {
      "kind": "Batch",
      "name": "hidden1",
      "size": 50
    }
  ],
  "invalid": [
    "(import \"./forms.lisp\" [batch])\n(batch rejected 0)",
    "(import \"./forms.lisp\" [batch])\n(batch huge 51)"
  ],
  "code": "batch/size"
});
