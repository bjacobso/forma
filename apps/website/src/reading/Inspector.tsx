import type { ReactNode } from "react";
import type { Analysis, Inspection, ReadingDiagnostic, TypedForm } from "./protocol";
import type { Range } from "./structure";
import { checkerOf, describeTag, effectOf, friendlyVars, parseType, printType, textOf, type Token, type Ty } from "./types";

export interface Subject extends Range {
  readonly text: string;
  readonly typed?: TypedForm | undefined;
  /** False when the type shown belongs to an enclosing form. */
  readonly exact: boolean;
}

export interface OutlineEntry extends Range {
  readonly label: string;
  readonly type?: string | undefined;
}

export function TypeTokens({ tokens, className = "rd-type" }: { readonly tokens: readonly Token[]; readonly className?: string }) {
  return <pre className={className}>{tokens.map((token, index) => <span className={token.cls ? `rd-t-${token.cls}` : undefined} key={index}>{token.text}</span>)}</pre>;
}

function Section({ title, aside, children }: { readonly title: string; readonly aside?: ReactNode; readonly children: ReactNode }) {
  return <section className="rd-section">
    <header><h3>{title}</h3>{aside ? <span className="rd-section-aside">{aside}</span> : null}</header>
    {children}
  </section>;
}

const show = (ty: Ty) => textOf(printType(ty));

export function Inspector({ subject, analysis, inspection, outline, onSelect, onJumpToName, onReplace }: {
  readonly subject: Subject | null;
  readonly analysis: Analysis | null;
  readonly inspection: Inspection;
  readonly outline: readonly OutlineEntry[];
  readonly onSelect: (range: Range) => void;
  readonly onJumpToName: (name: string) => boolean;
  readonly onReplace: (range: Range, text: string) => void;
}) {
  if (!analysis) return <div className="rd-inspector-empty"><span className="rd-pulse" />Loading the checker and preludes…</div>;
  if (!subject) return <OutlineView outline={outline} diagnostics={analysis.diagnostics} onSelect={onSelect} />;

  const typed = subject.typed;
  const ty = typed ? friendlyVars(parseType(typed.type)) : undefined;
  const effect = ty ? effectOf(ty) : undefined;
  const problems = analysis.diagnostics.filter(d => d.from < subject.to && d.to > subject.from || (d.from === d.to && d.from >= subject.from && d.from <= subject.to));
  const { form, definition, expansion } = inspection;
  const firstLine = subject.text.split("\n")[0]!;

  const chip = (item: Ty, kind: "error" | "req" | "ok") => {
    const label = show(item);
    const name = label.split(".")[0]!;
    return <button className={`rd-chip rd-chip-${kind}`} key={label} onClick={() => onJumpToName(name)} title={`Go to ${name}`} type="button">{label}</button>;
  };

  const formSection = form ? <Section title={form.from === subject.from && form.to === subject.to ? "Prelude form" : "Inside prelude form"} aside={form.prelude}>
      <div className="rd-form-head">
        <button className="rd-link rd-form-name" onClick={() => onSelect(form)} type="button">({form.name} …)</button>
        {form.produces ? <span className="rd-muted">produces <code>{form.produces}</code></span> : null}
      </div>
      {form.doc ? form.doc.split("\n\n").map((paragraph, index) => <p className="rd-doc" key={index}>{paragraph}</p>) : null}
      <table className="rd-slots">
        <tbody>
          {form.identifiers.map(identifier => <tr className="filled" key={`id:${identifier.name}`}>
            <td><code>{identifier.name}</code></td>
            <td>{identifier.value ? <code className="rd-slot-value">{identifier.value}</code> : <span className="rd-slot-missing">missing</span>}</td>
          </tr>)}
          {form.slots.map(slot => <tr className={[slot.name === form.activeSlot ? "active" : "", slot.missing ? "missing" : "", slot.filled ? "filled" : ""].join(" ")} key={slot.name}>
            <td><code>:{slot.name}</code></td>
            <td>
              {slot.values.length
                ? slot.values.map(value => <button className="rd-slot-value" key={value.from} onClick={() => onSelect(value)} type="button">{value.text.split("\n")[0]}{value.text.includes("\n") ? " …" : ""}</button>)
                : <span className={slot.missing ? "rd-slot-missing" : "rd-slot-empty"}>{slot.missing ? "missing" : slot.required ? "required" : "optional"}</span>}
              {slot.type ? <code className="rd-slot-type">{slot.type}</code> : null}
            </td>
          </tr>)}
        </tbody>
      </table>
    </Section> : null;
  // A prelude sub-form has no type of its own; its slots say more.
  const formFirst = Boolean(form && form.from === subject.from && form.to === subject.to && !subject.exact);

  return <div className="rd-inspector-body">
    <div className="rd-subject">
      <div className="rd-subject-kind">
        <span>{typed ? describeTag(typed.tag) : form && form.from === subject.from ? "prelude form" : "form"}</span>
        {typed && subject.exact ? <span className="rd-badge">{checkerOf(typed.tag)}</span> : null}
      </div>
      <code className="rd-subject-text">{firstLine.length > 60 ? `${firstLine.slice(0, 59)}…` : firstLine}{subject.text.includes("\n") ? " …" : ""}</code>
    </div>

    {formFirst ? formSection : null}

    <Section title="Type" aside={typed && !subject.exact ? "of the enclosing form" : undefined}>
      {ty ? <TypeTokens tokens={printType(ty, 38)} /> : <p className="rd-muted">The checker records no type for this form. Prelude slot syntax, keys, and signatures are checked as part of their enclosing form.</p>}
    </Section>

    {effect ? <Section title="Effect">
      <dl className="rd-effect">
        <dt>succeeds with</dt><dd><TypeTokens className="rd-type rd-type-inline" tokens={printType(effect.success, 30)} /></dd>
        <dt>fails with</dt><dd>{effect.errors.length ? effect.errors.map(e => chip(e, "error")) : <span className="rd-chip rd-chip-none">cannot fail</span>}</dd>
        <dt>requires</dt><dd>{effect.reqs.length ? effect.reqs.map(r => chip(r, "req")) : <span className="rd-chip rd-chip-none">no services</span>}</dd>
      </dl>
    </Section> : null}

    {problems.length ? <Section title={problems.length === 1 ? "Problem" : `${problems.length} problems`}>
      {problems.map((problem, index) => <Problem key={index} problem={problem} onReplace={onReplace} onSelect={onSelect} />)}
    </Section> : null}

    {definition ? <Section title="Name" aside={definition.local ? "local" : "global"}>
      <div className="rd-name">
        <code className="rd-name-text">{definition.name}</code>
        <span className="rd-muted">{definition.kind === "form" ? "a form from the preludes" : definition.kind === "builtin" ? "a builtin" : <>a {definition.kind} introduced by <code>{definition.form}</code></>}</span>
      </div>
      {definition.type && definition.type !== typed?.type ? <TypeTokens tokens={printType(friendlyVars(parseType(definition.type)), 38)} /> : null}
      <div className="rd-name-actions">
        {definition.from !== undefined && definition.to !== undefined && (definition.from !== subject.from || definition.to !== subject.to)
          ? <button className="rd-link" onClick={() => onSelect({ from: definition.from!, to: definition.to! })} type="button">Go to definition</button>
          : definition.elsewhere ? <span className="rd-muted">defined in {definition.elsewhere}</span> : <span className="rd-muted">defined here</span>}
        <span className="rd-muted">{definition.references} {definition.references === 1 ? "reference" : "references"}</span>
      </div>
    </Section> : null}


    {formFirst ? null : formSection}

    {expansion ? <Section title="Expands to" aside="kernel macros">
      <pre className="rd-expansion">{expansion}</pre>
    </Section> : null}
  </div>;
}

function Problem({ problem, onReplace, onSelect }: { readonly problem: ReadingDiagnostic; readonly onReplace: (range: Range, text: string) => void; readonly onSelect: (range: Range) => void }) {
  return <div className={`rd-problem rd-problem-${problem.severity}`}>
    <button className="rd-problem-message" onClick={() => onSelect(problem)} type="button">{problem.message}</button>
    <code className="rd-problem-code">{problem.code}</code>
    {problem.help ? <p className="rd-muted">{problem.help}</p> : null}
    {problem.code === "typecheck/hole" && problem.candidates?.length ? <div className="rd-candidates">
      <span className="rd-muted">fill with</span>
      {problem.candidates.map(candidate => <button className="rd-chip rd-chip-ok" key={candidate} onClick={() => onReplace(problem, candidate)} type="button">{candidate}</button>)}
    </div> : null}
    {problem.fix?.length === 1 ? <button className="rd-link" onClick={() => onReplace(problem.fix![0]!, problem.fix![0]!.insert)} type="button">Apply fix: {problem.fix[0]!.insert || "remove"}</button> : null}
  </div>;
}

function OutlineView({ outline, diagnostics, onSelect }: { readonly outline: readonly OutlineEntry[]; readonly diagnostics: readonly ReadingDiagnostic[]; readonly onSelect: (range: Range) => void }) {
  return <div className="rd-inspector-body">
    <Section title="Outline" aside={`${outline.length} forms`}>
      <ol className="rd-outline">
        {outline.map(entry => <li key={entry.from}>
          <button onClick={() => onSelect(entry)} type="button">
            <code className="rd-outline-label">{entry.label}</code>
            {entry.type ? <TypeTokens className="rd-type rd-type-inline" tokens={printType(friendlyVars(parseType(entry.type)), 34)} /> : null}
          </button>
        </li>)}
      </ol>
    </Section>
    {diagnostics.length ? <Section title={`${diagnostics.length} ${diagnostics.length === 1 ? "problem" : "problems"}`}>
      {diagnostics.map((problem, index) => <div className={`rd-problem rd-problem-${problem.severity}`} key={index}>
        <button className="rd-problem-message" onClick={() => onSelect(problem)} type="button">{problem.message}</button>
      </div>)}
    </Section> : null}
    <p className="rd-muted rd-tip">Put the caret in a form, or select one with Alt-click, to see its type, effect, name, and prelude form.</p>
  </div>;
}
