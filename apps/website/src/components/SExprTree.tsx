import { useState } from "react";
import type { AstNode } from "@formalang/ts/engine";
import { nodeToSource, sameSpan, spanRange, type SpanRange } from "../lib/artifacts";

export function SExprTree({
  ast,
  selectedSpan,
  onSelectSpan,
}: {
  readonly ast: readonly AstNode[];
  readonly selectedSpan: SpanRange | null;
  readonly onSelectSpan: (span: SpanRange | null) => void;
}) {
  if (ast.length === 0) return <p className="empty-state">No tree output.</p>;
  return (
    <div className="tree-list">
      {ast.map((node, index) => (
        <TreeNode
          key={index}
          node={node}
          onSelectSpan={onSelectSpan}
          selectedSpan={selectedSpan}
        />
      ))}
    </div>
  );
}

function TreeNode({
  node,
  selectedSpan,
  onSelectSpan,
}: {
  readonly node: AstNode;
  readonly selectedSpan: SpanRange | null;
  readonly onSelectSpan: (span: SpanRange | null) => void;
}) {
  const [open, setOpen] = useState(true);
  const children = childNodes(node);
  const span = spanRange(node.span);
  const selected = sameSpan(span, selectedSpan);

  return (
    <div className="tree-node">
      <button
        className={`tree-node-label ${selected ? "selected-artifact" : ""}`}
        onClick={() => {
          if (children.length > 0) setOpen(!open);
          onSelectSpan(span);
        }}
        onMouseEnter={() => onSelectSpan(span)}
        type="button"
      >
        <span className="tree-kind">{node.kind}</span>
        <code>{shortLabel(node)}</code>
        {span ? (
          <small>
            {span[0]}:{span[1]}
          </small>
        ) : null}
      </button>
      {open && children.length > 0 ? (
        <div className="tree-children">
          {children.map((child, index) => (
            <TreeNode
              key={index}
              node={child}
              onSelectSpan={onSelectSpan}
              selectedSpan={selectedSpan}
            />
          ))}
        </div>
      ) : null}
    </div>
  );
}

function childNodes(node: AstNode): readonly AstNode[] {
  switch (node.kind) {
    case "list":
    case "vector":
    case "set":
      return node.items;
    case "map":
      return node.entries.flatMap((entry) => [entry.key, entry.value]);
    default:
      return [];
  }
}

function shortLabel(node: AstNode): string {
  const source = nodeToSource(node);
  return source.length > 80 ? `${source.slice(0, 77)}...` : source;
}
