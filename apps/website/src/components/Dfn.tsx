import type { ReactNode } from "react";

const definitions: Record<string, string> = {
  elaboration: "Compiling a program into a structured description another system can execute.",
  macro: "A small program that rewrites Forma source before later compiler passes run.",
  inference: "Figuring out types from how values are used, without requiring annotations.",
  "s-expression": "A parenthesized tree notation where code and data share one shape.",
  typecheck: "The pass that proves expressions fit the types the compiler inferred.",
  diagnostic: "A structured compiler message with severity, text, and often a source span.",
};

export function Dfn({
  term,
  children,
}: {
  readonly term: keyof typeof definitions;
  readonly children?: ReactNode;
}) {
  return (
    <dfn className="dfn" title={definitions[term]}>
      {children ?? term}
    </dfn>
  );
}

export function InlineGlossaryText({ text }: { readonly text: string }) {
  const chunks = text.split(/(`[^`]+`)/g);
  return (
    <>
      {chunks.map((chunk, index) => {
        if (chunk.startsWith("`") && chunk.endsWith("`")) {
          return <code key={index}>{chunk.slice(1, -1)}</code>;
        }
        return <GlossaryWords key={index} text={chunk} />;
      })}
    </>
  );
}

/** Renders `code` spans without glossary definitions, for short labels. */
export function InlineCodeText({ text }: { readonly text: string }) {
  return (
    <>
      {text.split(/(`[^`]+`)/g).map((chunk, index) =>
        chunk.startsWith("`") && chunk.endsWith("`") ? (
          <code key={index}>{chunk.slice(1, -1)}</code>
        ) : (
          chunk
        ),
      )}
    </>
  );
}

function GlossaryWords({ text }: { readonly text: string }) {
  const parts = text.split(/\b(elaboration|macro|inference|S-expression|typecheck|diagnostic)s?\b/gi);
  return (
    <>
      {parts.map((part, index) => {
        const key = definitionKey(part);
        return key ? (
          <Dfn key={index} term={key}>
            {part}
          </Dfn>
        ) : (
          part
        );
      })}
    </>
  );
}

function definitionKey(value: string): keyof typeof definitions | null {
  const normalized = value.toLowerCase();
  if (normalized === "s-expression") return "s-expression";
  if (normalized in definitions) return normalized as keyof typeof definitions;
  return null;
}
