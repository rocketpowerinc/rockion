const LIST_TYPES = new Set(["bulletList", "orderedList", "taskList"]);
const ITEM_TYPES = new Set(["listItem", "taskItem"]);
const CONTAINER_TYPES = new Set(["blockquote", "callout"]);

function cloneNode(node) {
  const marks = node.marks?.map((mark) => ({
    ...mark,
    ...(mark.attrs ? { attrs: { ...mark.attrs } } : {}),
  }));
  return {
    ...node,
    ...(node.attrs ? { attrs: { ...node.attrs } } : {}),
    ...(marks ? { marks } : {}),
    ...(node.content ? { content: node.content.map(cloneNode) } : {}),
  };
}

function collectBlocks(node) {
  if (!node) return [];
  if (["paragraph", "heading", "codeBlock"].includes(node.type)) {
    return [{ content: node.content?.map(cloneNode) ?? [] }];
  }
  if (
    LIST_TYPES.has(node.type) ||
    ITEM_TYPES.has(node.type) ||
    CONTAINER_TYPES.has(node.type)
  ) {
    return (node.content ?? []).flatMap(collectBlocks);
  }
  const nested = (node.content ?? []).flatMap(collectBlocks);
  return nested.length ? nested : [{ content: [] }];
}

function withContent(type, content, attrs) {
  const node = { type };
  if (attrs) node.attrs = attrs;
  if (content.length) node.content = content.map(cloneNode);
  return node;
}

function paragraph(block) {
  return withContent("paragraph", block.content);
}

function textFromInline(nodes) {
  return nodes
    .map((node) => {
      if (node.type === "text") return node.text ?? "";
      if (node.type === "hardBreak") return "\n";
      return textFromInline(node.content ?? []);
    })
    .join("");
}

function codeBlock(block) {
  const text = textFromInline(block.content);
  return text
    ? { type: "codeBlock", attrs: { language: null }, content: [{ type: "text", text }] }
    : { type: "codeBlock", attrs: { language: null } };
}

function list(blocks, listType) {
  const itemType = listType === "taskList" ? "taskItem" : "listItem";
  return {
    type: listType,
    content: blocks.map((block) => ({
      type: itemType,
      ...(itemType === "taskItem" ? { attrs: { checked: false } } : {}),
      content: [paragraph(block)],
    })),
  };
}

function alreadyTarget(node, target) {
  if (target === "text") return node.type === "paragraph";
  if (target.startsWith("heading")) {
    return node.type === "heading" && node.attrs?.level === Number(target.slice(-1));
  }
  if (target === "bullet") return node.type === "bulletList";
  if (target === "ordered") return node.type === "orderedList";
  if (target === "task") return node.type === "taskList";
  if (target === "quote") return node.type === "blockquote";
  if (target === "code") return node.type === "codeBlock";
  if (target === "callout") return node.type === "callout";
  return false;
}

export function transformBlockJSON(node, target) {
  if (alreadyTarget(node, target)) return [cloneNode(node)];
  const blocks = collectBlocks(node);
  const normalized = blocks.length ? blocks : [{ content: [] }];

  if (target === "text") return normalized.map(paragraph);
  if (target.startsWith("heading")) {
    const level = Number(target.slice(-1));
    return normalized.map((block) => withContent("heading", block.content, { level }));
  }
  if (target === "bullet") return [list(normalized, "bulletList")];
  if (target === "ordered") return [list(normalized, "orderedList")];
  if (target === "task") return [list(normalized, "taskList")];
  if (target === "quote") {
    return [{ type: "blockquote", content: normalized.map(paragraph) }];
  }
  if (target === "code") return normalized.map(codeBlock);
  if (target === "callout") {
    return [{
      type: "callout",
      attrs: { type: "note" },
      content: normalized.map(paragraph),
    }];
  }
  throw new Error(`unknown block conversion target: ${target}`);
}
