import { test } from "node:test";
import assert from "node:assert/strict";
import { interpretCommand } from "../src/nlp.js";

const makeObject = (type, options = {}) => ({
  id: `${type}-${Math.random().toString(36).slice(2)}`,
  type,
  name: options.name || type[0].toUpperCase() + type.slice(1),
  size: options.size || (type === "table" ? [1.2, 0.6, 0.75] : [1, 1, 1]),
  position: options.position || [0, 0, 0],
  rotation: options.rotation || [0, 0, 0],
  material: options.material || "default",
  color: options.color || "#94a3b8",
  relations: options.relations || []
});

test("parses object creation dimensions, material, and floor placement", () => {
  const result = interpretCommand("Create a wooden table 120 cm wide", [], makeObject);
  assert.equal(result.kind, "create");
  assert.equal(result.object.material, "wood");
  assert.equal(result.object.size[0], 1.2);
  assert.equal(result.object.position[2], result.object.size[2] / 2);
});

test("treats an article-led make request as object creation", () => {
  const result = interpretCommand("Make a wooden chair 60 cm wide", [], makeObject);
  assert.equal(result.kind, "create");
  assert.equal(result.object.type, "chair");
  assert.equal(result.object.material, "wood");
  assert.equal(result.object.size[0], 0.6);
});

test("does not invent a cube when no supported object type is named", () => {
  const result = interpretCommand("create an abstract object", [], makeObject);
  assert.equal(result.kind, "none");
  assert.match(result.message, /Specify an object type/);
});

test("places objects using Z-up spatial relations", () => {
  const table = makeObject("table", { id: "table-1", name: "Table", position: [0, 0, 0.375] });
  const result = interpretCommand("Create a lamp on the table", [table], makeObject);
  assert.equal(result.kind, "create");
  assert.equal(result.object.type, "lamp");
  assert.ok(result.object.position[2] > table.position[2]);
  assert.equal(result.object.relations[0].target, table.id);
  const lamp = makeObject("lamp", { id: "lamp-1", name: "Lamp" });
  const move = interpretCommand("Put the lamp on the table", [table, lamp], makeObject);
  assert.equal(move.kind, "update");
  assert.equal(move.id, lamp.id);
  assert.equal(move.patch.relations[0].target, table.id);
});

test("updates an existing object's color and width", () => {
  const table = makeObject("table", { id: "table-1", name: "Table" });
  const result = interpretCommand("Make the table red and 140 cm wide", [table], makeObject);
  assert.equal(result.kind, "update");
  assert.equal(result.patch.color, "#ef4444");
  assert.equal(result.patch.size[0], 1.4);
});

test("supports move, duplicate, delete, undo, redo, mode, and view intents", () => {
  const chair = makeObject("chair", { id: "chair-1", name: "Chair", size: [0.6, 0.6, 0.9], position: [1, 0, 0.45] });
  assert.equal(interpretCommand("move the chair right", [chair], makeObject).patch.position[0], 1.25);
  assert.equal(interpretCommand("duplicate the chair", [chair], makeObject).object.name, "Chair copy");
  assert.equal(interpretCommand("delete the chair", [chair], makeObject).id, chair.id);
  assert.equal(interpretCommand("undo", [], makeObject).kind, "undo");
  assert.equal(interpretCommand("redo", [], makeObject).kind, "redo");
  assert.equal(interpretCommand("switch to ECAD mode", [], makeObject).mode, "ECAD");
  assert.equal(interpretCommand("show top view", [], makeObject).view, "top");
});

test("resolves the longest object name when names overlap", () => {
  const lamp = makeObject("lamp", { id: "lamp-1", name: "Lamp" });
  const copy = makeObject("lamp", { id: "lamp-copy", name: "Lamp copy" });
  assert.equal(interpretCommand("delete the lamp copy", [lamp, copy], makeObject).id, copy.id);
});

test("does not claim to execute unrecognized commands", () => {
  assert.equal(interpretCommand("", [], makeObject).kind, "none");
  assert.match(interpretCommand("help", [], makeObject).message, /Try:/);
});
