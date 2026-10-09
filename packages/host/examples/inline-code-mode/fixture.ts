// Data and bindings belong to the host, outside assistant-generated source.
import type { Bindings } from "./runtime.ts";

export const source = `(let [issues (Issues.list-open)
      accounts (Accounts.list-active)]
  (map (fn [account]
         {:account account
          :open (count (filter (fn [issue]
                                 (starts-with? issue (str account "/")))
                               issues))})
       accounts))`;

export const initial = `I'll count open issues for each active account.

\`\`\`forma
(Issues.close "ada/I-1") ; illustrative only
\`\`\`

\`\`\`forma-run counts
${source}
\`\`\`
`;

export const write = `I can request closing the selected issue.
\`\`\`forma-run close
(Issues.close "ada/I-1")
\`\`\`
`;

export function mockBindings(variant: "primary" | "alternate" = "primary"): Bindings {
  return {
    "Issues.list-open": () => ({ ok: true, value: variant === "primary"
      ? ["ada/I-1", "ada/I-2", "lin/I-3", "bot/I-4"] : ["lin/I-9"] }),
    "Accounts.list-active": () => ({ ok: true, value: ["ada", "lin"] }),
    "Issues.close": () => ({ ok: true, value: true }),
  };
}

export async function* chunks(text: string, size = 7): AsyncGenerator<string> {
  for (let offset = 0; offset < text.length; offset += size) yield text.slice(offset, offset + size);
}
