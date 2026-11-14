import { Link } from "react-router-dom";
import { useDocumentMeta } from "../lib/documentMeta";
import { ordersSource } from "../effectPageSources";
import { FormaSnippet } from "./FormaReader";
import { ReaderRoot } from "./model";
import { Breadcrumbs, CheckStatus, ReaderEditor, ReaderInspector } from "./parts";
import "./reading.css";

const older = `(define older [person]
  (assoc person :age (+ (get person :age) 1)))

(define ada {:name "Ada" :age 36})

(older ada)`;

const counter = `(entity Counter
  :state {:count Int}
  :initial {:count 0}
  :storage :memory
  (command Increment
    :payload {:by Int}
    :success Int
    :delivery :volatile
    :update {:count (+ state.count by)}
    :reply state.count)
  (query Count :success Int :reply state.count))`;

const threading = `(define both [a b]
  (when (and a b)
    (-> [a b] (count) (str " flags"))))`;

const usage = `import { FormaSnippet } from "./reading/FormaReader";

<FormaSnippet source={source} focus="(define older" title="older.lisp" />`;

const composed = `import { ReaderRoot } from "./reading/model";
import { Breadcrumbs, CheckStatus, ReaderEditor, ReaderInspector } from "./reading/parts";

<ReaderRoot files={[{ id: "main.lisp", source }]} focus="(entity">
  <Breadcrumbs /> <CheckStatus />
  <ReaderEditor fit="content" />
  <ReaderInspector />
</ReaderRoot>`;

const embed = `<!-- Any docs page or blog post (VitePress) -->
<ReaderEmbed title="counter.lisp" focus="(command Increment" source="(entity Counter …)" />`;

/** The reader's parts in prose: inline snippets, a custom layout, and the docs embed. */
export function SnippetsPage() {
  useDocumentMeta({ title: "Forma reader snippets", description: "Inline, checked Forma snippets with types on hover, for posts, docs, and demos." });
  return <main className="rd-article">
    <span className="rd-eyebrow">Prototype · reading editor</span>
    <h1>Checked snippets anywhere</h1>
    <p className="rd-lede">
      The <Link className="rd-link" to="/read">reader</Link> is a set of parts around one <code>ReaderRoot</code>. The same parts
      make an inline snippet for a post, a custom layout for a demo, or the full reader. Every snippet below is live:
      hover a form for its type, Alt-click to select one, and edit it to see it checked again. All of them share one checker
      in a background worker.
    </p>

    <h2>An inline snippet</h2>
    <p>A snippet sizes itself to its code. The line under it shows the type of the form at the caret, and the inspector opens on demand.</p>
    <FormaSnippet focus="(define older" source={older} title="older.lisp" />
    <pre className="rd-usage">{usage}</pre>

    <h2>Effect operations carry their errors and services</h2>
    <p>Click inside <code>pay</code>: the line under the code lists what it can fail with and which services it needs.</p>
    <FormaSnippet focus="(retry (Payments.charge" source={ordersSource} title="orders.lisp" />

    <h2>Macros, one step at a time</h2>
    <p>Alt-click the <code>when</code> form and open the details: the inspector steps through each macro that rewrites it, <code>when</code>, then <code>and</code>, then <code>-&gt;</code>, marking the lines each step changed.</p>
    <FormaSnippet focus="(when (and" source={threading} title="both.lisp" />

    <h2>Compose your own</h2>
    <p>Here the inspector sits under the code, and the snippet starts on the entity. Select the <code>command</code> form to see its record in the entity's IR and the TypeScript it generates.</p>
    <ReaderRoot className="rd-snippet rd-composed" files={[{ id: "counter.lisp", source: counter }]} focus="(command Increment">
      <header className="rd-snippet-head"><Breadcrumbs /><CheckStatus /></header>
      <ReaderEditor fit="content" />
      <div className="rd-snippet-inspector"><ReaderInspector /></div>
    </ReaderRoot>
    <pre className="rd-usage">{composed}</pre>

    <h2>In the docs and the blog</h2>
    <p>
      The VitePress site embeds a snippet with <code>&lt;ReaderEmbed&gt;</code>, an iframe of <code>/playground/embed/read</code> that follows the
      page's light or dark setting and sizes itself to its content.
    </p>
    <pre className="rd-usage">{embed}</pre>
  </main>;
}
