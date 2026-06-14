import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";
import { getSchema, Node } from "@tiptap/core";
import StarterKit from "@tiptap/starter-kit";
import TaskList from "@tiptap/extension-task-list";
import TaskItem from "@tiptap/extension-task-item";
import { transformBlockJSON } from "../src/editor/blockTransforms.mjs";

const TestCallout = Node.create({
  name: "callout",
  group: "block",
  content: "block+",
  addAttributes: () => ({ type: { default: "note" } }),
});

const schema = getSchema([
  StarterKit,
  TaskList,
  TaskItem.configure({ nested: true }),
  TestCallout,
]);

const text = (value, marks) => ({
  type: "text",
  text: value,
  ...(marks ? { marks } : {}),
});
const paragraph = (value, marks) => ({
  type: "paragraph",
  content: [text(value, marks)],
});

test("bullet and numbered lists convert to valid task lists", () => {
  for (const type of ["bulletList", "orderedList"]) {
    const converted = transformBlockJSON({
      type,
      content: [
        { type: "listItem", content: [paragraph("Alpha")] },
        { type: "listItem", content: [paragraph("Beta")] },
      ],
    }, "task");

    assert.equal(converted[0].type, "taskList");
    assert.deepEqual(
      converted[0].content.map((item) => ({
        type: item.type,
        checked: item.attrs.checked,
        text: item.content[0].content[0].text,
      })),
      [
        { type: "taskItem", checked: false, text: "Alpha" },
        { type: "taskItem", checked: false, text: "Beta" },
      ]
    );
  }
});

test("task lists convert back to ordinary list items", () => {
  const converted = transformBlockJSON({
    type: "taskList",
    content: [
      {
        type: "taskItem",
        attrs: { checked: true },
        content: [paragraph("Done")],
      },
    ],
  }, "bullet");
  assert.equal(converted[0].type, "bulletList");
  assert.equal(converted[0].content[0].type, "listItem");
  assert.equal(converted[0].content[0].content[0].content[0].text, "Done");
});

test("each list item becomes its own heading and preserves inline marks", () => {
  const strong = [{ type: "bold" }];
  const converted = transformBlockJSON({
    type: "bulletList",
    content: [
      { type: "listItem", content: [paragraph("Alpha", strong)] },
      { type: "listItem", content: [paragraph("Beta")] },
    ],
  }, "heading2");

  assert.deepEqual(converted.map((node) => node.type), ["heading", "heading"]);
  assert.deepEqual(converted.map((node) => node.attrs.level), [2, 2]);
  assert.deepEqual(converted[0].content[0].marks, strong);
  assert.deepEqual(converted.map((node) => node.content[0].text), ["Alpha", "Beta"]);
});

test("wrapper and text blocks convert across all menu targets", () => {
  const source = {
    type: "blockquote",
    content: [paragraph("One"), paragraph("Two")],
  };
  assert.equal(transformBlockJSON(source, "text").length, 2);
  assert.equal(transformBlockJSON(source, "code").length, 2);
  assert.equal(transformBlockJSON(source, "ordered")[0].type, "orderedList");
  assert.equal(transformBlockJSON(source, "callout")[0].type, "callout");
  assert.equal(transformBlockJSON(paragraph("One"), "quote")[0].type, "blockquote");
});

test("generated standard blocks satisfy the editor schema", () => {
  const source = {
    type: "bulletList",
    content: [
      { type: "listItem", content: [paragraph("Alpha")] },
      { type: "listItem", content: [paragraph("Beta")] },
    ],
  };
  for (const target of [
    "text",
    "heading1",
    "heading2",
    "heading3",
    "bullet",
    "ordered",
    "task",
    "quote",
    "code",
    "callout",
  ]) {
    for (const node of transformBlockJSON(source, target)) {
      assert.doesNotThrow(() => schema.nodeFromJSON(node), target);
    }
  }
});

test("the block menu uses structural replacement rather than list toggles", () => {
  const source = fs.readFileSync(
    new URL("../src/editor/BlockMenu.tsx", import.meta.url),
    "utf8"
  );
  assert.match(source, /transformBlockJSON/);
  assert.match(source, /insertContentAt/);
  assert.doesNotMatch(source, /toggleTaskList|toggleBulletList|setHeading/);
});
