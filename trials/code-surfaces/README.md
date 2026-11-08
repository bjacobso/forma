# Connected code surfaces

An interactive design trial for Forma's static code blocks and browser editor /
workbench presentation. This is not a production styling rollout. It does not
change compiler behavior, the homepage, or the structural workbench in Foldworks.

Open [`index.html`](./index.html) in a browser from a local checkout. The page is
self-contained and works directly from a file URL: no build, server, dependencies,
or network requests are needed. A published copy is available as an
[interactive design artifact](https://ampcode.com/artifacts/visuals/forma-code-surfaces-connected-diagnostics-c2c2afee-3e21-49f4-bb62-d5c4684a7ea3).
The checked-in HTML is the reviewable source of truth for this trial.

## Recommendation

Use the **Connected** direction: one restrained code window with a persistent
source-located diagnostic, a nearby explanation, and explicitly authored manual
guidance. Keep Forma's warm-paper light mode, green-black dark panels, blue accent,
and serif identity. The tradeoff is more vertical space than a compact problems
list. On narrow screens, stack source before output rather than shrinking text.

The **Today's anatomy** alternative is a simplified comparison of the current
source / inferred types / separate problems arrangement, not a pixel reproduction.

## Try it

1. Compare the two directions in static and editor modes, both themes, and both
   error and checked fixtures.
2. In the error fixture, open **Review manual edit**. This reveals guidance without
   modifying source; there is no automatic fix.
3. In editor mode, **Select offending source** selects `"oops"` and focuses the
   textarea. Tab leaves the editor rather than trapping focus.
4. Edit the source. Previous types and diagnostics disappear, and the panel says
   **Unchecked edits**. **Reload fixture** restores the selected fixture.
5. Resize to 360px wide. Source, output, and guidance stack without page overflow.

All diagnostic messages, inline types, and checked results are **design fixtures**.
The numeric-order function and its broken string operand come from the existing
`inference` example in `apps/website/src/workbench/examples.ts`. Type wording here
is illustrative prose, not Forma compiler notation. The function is not evaluated.
The editor is a textarea, not CodeMirror or a structural editor. Switching the
surface or fixture reloads fixture source; arbitrary edits are not compiled.

## Existing implementation boundaries

- `docs/.vitepress/theme/custom.css`: documentation colors and typography.
- `docs/.vitepress/theme/WorkbenchEmbed.vue`: embedded browser workbench and theme
  synchronization. Avoid a second decorative frame around the proposed window.
- `apps/website/src/components/LiveWorkbench.tsx`: real compiler results, cursor /
  hover inspection, diagnostics, and source navigation.
- `apps/website/src/components/WorkbenchEditor.tsx`: CodeMirror and reveal ranges.
- `apps/website/src/components/TargetCodeView.tsx`: read-only generated code.
- `packages/editor/src/codemirror/appearance.ts` and `theme.ts`: shared editor
  palettes. Their current colors differ from the documentation code windows.

After design review, a small production slice can use shared presentation tokens
and this diagnostic anatomy in one browser workbench example. Use real existing
diagnostic messages, spans, and inferred types; keep authored explanations separate
from compiler output. Compiler-supplied fixes need a real API contract first.

## Verification

The original prototype was exercised in Chromium at 2× DPR:

- All 16 direction × surface × theme × fixture combinations.
- Exact `"oops"` selection from a diagnostic, Tab exit, and a 2px focus outline.
- Immediate removal of stale types and diagnostics after arbitrary edits.
- Manual guidance expansion and fixture reload without automatic repairs.
- At 360 CSS pixels, `scrollWidth = innerWidth = 360` and source/output stack.
- Reduced-motion preference with computed animation `none`; no animated transitions.
- Proposed text/status/syntax colors against both panel backgrounds: minimum
  contrast 8.28:1 dark and 5.98:1 light. This is not a full accessibility audit.
- Inspected dark static/error, light editor/checked, narrow editor/unchecked, and
  narrow dark expanded-guidance screenshots, plus an interaction recording.

These are prototype checks, not compiler correctness, CodeMirror integration, or
Foldworks tests. Narrow Chromium viewport checks are not real-device/touch tests.
