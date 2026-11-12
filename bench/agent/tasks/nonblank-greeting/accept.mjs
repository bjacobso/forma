import { acceptForm } from "../../accept-support.mjs";
export const accept = dir => acceptForm(dir, {
  "valid": "(import \"./forms.lisp\" [greeting])\n(greeting hidden0 \"Hello Ada\")\n(greeting hidden1 \"  hi  \")",
  "payloads": [
    {
      "kind": "Greeting",
      "name": "hidden0",
      "message": "Hello Ada"
    },
    {
      "kind": "Greeting",
      "name": "hidden1",
      "message": "  hi  "
    }
  ],
  "invalid": [
    "(import \"./forms.lisp\" [greeting])\n(greeting rejected \"  \")",
    "(import \"./forms.lisp\" [greeting])\n(greeting empty \"\")"
  ],
  "code": "greeting/empty"
});
