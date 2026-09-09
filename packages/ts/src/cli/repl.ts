#!/usr/bin/env node
import { Effect } from "effect";
import { createInterface } from "node:readline/promises";
import { stdin as input, stdout as output } from "node:process";
import * as Evaluator from "../Evaluator.js";
import { createReplEnv, evaluateReplLine } from "./repl-session.js";

const HELP_TEXT = `Language Lisp REPL

Commands:
  :help          Show this help
  :quit | :exit  Exit the REPL

Examples:
  (+ 1 2 3)
  (define answer 42)
  answer
`;

const printError = (error: unknown): string => {
  if (error && typeof error === "object" && "_tag" in error) {
    const tagged = error as { readonly _tag: string; readonly message?: string };
    const message = tagged.message ?? "Unknown error";
    return `${tagged._tag}: ${message}`;
  }
  if (error instanceof Error) return error.message;
  return String(error);
};

const repl = Effect.gen(function* () {
  let env = createReplEnv();
  const rl = createInterface({ input, output, terminal: Boolean(input.isTTY && output.isTTY) });

  output.write("\nWelcome to @formalang/ts REPL\n");
  output.write("Type :help for commands.\n\n");

  while (true) {
    const line = (yield* Effect.tryPromise(() => rl.question("λ> "))).trim();
    if (line.length === 0) continue;

    if (line === ":quit" || line === ":exit") {
      rl.close();
      output.write("bye!\n");
      return;
    }

    if (line === ":help") {
      output.write(`${HELP_TEXT}\n`);
      continue;
    }

    const result = yield* Effect.either(evaluateReplLine(line, env));

    if (result._tag === "Left") {
      output.write(`${printError(result.left)}\n`);
      continue;
    }

    env = result.right.env;
    output.write(`${Evaluator.printKValue(result.right.value)}\n`);
  }
});

Effect.runPromise(repl).catch((error) => {
  output.write(`${printError(error)}\n`);
  process.exitCode = 1;
});
