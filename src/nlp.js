import intentModel from "./intent-model.json" with { type: "json" };

const INTENT_WORDS = {
  create: /\b(create|add|make|generate|draw|build|insert)\b/i,
  update: /\b(change|set|update|resize|scale|color|colour|rename|turn|rotate)\b/i,
  delete: /\b(delete|remove|erase)\b/i,
  move: /\b(move|put|place|position)\b/i,
  duplicate: /\b(duplicate|copy|clone)\b/i,
  select: /\b(select|choose|focus)\b/i,
  clear: /\b(clear|reset|new scene)\b/i,
  undo: /\b(undo|revert)\b/i,
  redo: /\b(redo|restore)\b/i,
  view: /\b(view|camera|zoom|frame|fit|look)\b/i,
  mode: /\b(mode|switch to|change to)\b/i,
  help: /\b(help|examples|commands|guide)\b/i
};

const COLORS = {
  red: "#ef4444", blue: "#3b82f6", green: "#22c55e", yellow: "#eab308",
  orange: "#f97316", purple: "#8b5cf6", pink: "#ec4899", black: "#111827",
  white: "#ffffff", gray: "#94a3b8", grey: "#94a3b8", brown: "#8b5a2b", silver: "#cbd5e1"
};
const MATERIAL_COLORS = {
  wood: "#8b5a2b", metal: "#9ca3af", steel: "#6b7280", aluminum: "#d1d5db",
  plastic: "#f3f4f6", glass: "#93c5fd", copper: "#b87333", pcb: "#176b4d"
};
const TYPES = ["laptop", "table", "chair", "desk", "wall", "cube", "cylinder", "sphere", "lamp", "pcb", "resistor", "led", "mcu", "arduino"];
const MATERIALS = ["wood", "wooden", "metal", "steel", "aluminum", "plastic", "glass", "copper", "pcb", "silver"];

function classifyIntent(text) {
  const tokens = text.toLowerCase().match(/[a-z0-9]+/g) || [];
  const features = new Set(tokens);
  for (let i = 0; i < tokens.length - 1; i++) features.add(`${tokens[i]}_${tokens[i + 1]}`);

  const scores = Object.entries(intentModel.classes).map(([intent, model]) => {
    let score = Math.log(model.prior);
    for (const feature of features) score += Math.log(model.features[feature] || model.unknown);
    return [intent, score];
  }).sort((a, b) => b[1] - a[1]);
  return scores[0]?.[0] || "unknown";
}

function findIntent(text, hasTarget) {
  if (/\b(clear|reset|start over|remove)\b/i.test(text) && /\b(all|everything|scene|workspace)\b/i.test(text)) return "clear";
  if (hasTarget&&!/\bmake\s+(?:a|an|another|new)\b/i.test(text)&&
      /\b(color|colour|red|blue|green|yellow|orange|purple|pink|black|white|gray|grey|brown|silver|material|wood|wooden|metal|steel|aluminum|plastic|glass|copper|width|wide|length|long|depth|deep|height|tall|high|angle|degrees?|rename|rotate)\b/i.test(text) &&
      /\b(change|make|set|update|resize|scale|turn|rotate|rename)\b/i.test(text)) return "update";
  const explicit = Object.entries(INTENT_WORDS).find(([, pattern]) => pattern.test(text));
  if (explicit) return explicit[0];
  return classifyIntent(text);
}

function findTarget(text, scene) {
  const lower = text.toLowerCase();
  const byName = [...scene].sort((left, right) => right.name.length - left.name.length);
  return byName.find(object => lower.includes(object.name.toLowerCase())) ||
    byName.find(object => new RegExp(`\\b${object.type}\\b`, "i").test(text));
}

function toMeters(value, unit = "cm") {
  const number = Number(value);
  if (!Number.isFinite(number) || number <= 0) return null;
  return unit.toLowerCase() === "mm" ? number / 1000 : unit.toLowerCase() === "m" ? number : number / 100;
}

function parseDimensions(text, defaults) {
  const result = [...defaults];
  const unitPattern = "(mm|cm|m)?";
  const dimensions = [
    { axis: 0, names: "width|wide|length|long" },
    { axis: 1, names: "depth|deep" },
    { axis: 2, names: "height|tall|high" }
  ];
  let hasNamedDimension = false;
  for (const { axis, names } of dimensions) {
    const match = text.match(new RegExp(`(?:${names})\\s*(?:of|is|=)?\\s*(\\d+(?:\\.\\d+)?)\\s*${unitPattern}|(\\d+(?:\\.\\d+)?)\\s*${unitPattern}\\s*(?:${names})`, "i"));
    if (match) {
      hasNamedDimension = true;
      const dimension = toMeters(match[1] || match[3], match[2] || match[4] || "cm");
      if (dimension) result[axis] = dimension;
    }
  }
  if (!hasNamedDimension) {
    const triple = text.match(/(\d+(?:\.\d+)?)\s*(mm|cm|m)?\s*(?:x|by|×)\s*(\d+(?:\.\d+)?)\s*(mm|cm|m)?\s*(?:x|by|×)\s*(\d+(?:\.\d+)?)\s*(mm|cm|m)?/i);
    if (triple) {
      const fallbackUnit = triple[2] || triple[4] || triple[6] || "cm";
      result.splice(0, 3,
        toMeters(triple[1], triple[2] || fallbackUnit) || result[0],
        toMeters(triple[3], triple[4] || fallbackUnit) || result[1],
        toMeters(triple[5], triple[6] || fallbackUnit) || result[2]);
    }
  }
  return result;
}

function extractColor(text) {
  for (const [name, value] of Object.entries(COLORS)) {
    if (new RegExp(`\\b${name}\\b`, "i").test(text)) return value;
  }
  return null;
}

function relationFor(text) {
  if (/\b(left of|to the left of)\b/i.test(text)) return "left";
  if (/\b(right of|to the right of)\b/i.test(text)) return "right";
  if (/\b(on|above|over|on top of)\b/i.test(text)) return "above";
  if (/\b(below|under)\b/i.test(text)) return "below";
  if (/\b(behind|at the back of)\b/i.test(text)) return "behind";
  if (/\b(in front of)\b/i.test(text)) return "front";
  if (/\b(next to|beside|near)\b/i.test(text)) return "next";
  return null;
}

function findRelationTarget(text, scene) {
  const phrase = text.match(/\b(?:next to|beside|near|left of|right of|on top of|on|above|over|below|under|behind|in front of)\s+(?:the\s+)?(.+)$/i)?.[1];
  return phrase ? findTarget(phrase, scene) : null;
}

function applyRelation(object, scene, text) {
  const relation = relationFor(text);
  if (!relation) return object;
  const target = findRelationTarget(text, scene);
  if (!target) return object;
  const position = [...target.position];
  const gap = 0.12;
  if (relation === "left") position[0] -= (target.size[0] + object.size[0]) / 2 + gap;
  else if (relation === "right" || relation === "next") position[0] += (target.size[0] + object.size[0]) / 2 + gap;
  else if (relation === "above") position[2] = target.position[2] + target.size[2] / 2 + object.size[2] / 2 + gap;
  else if (relation === "below") position[2] = target.position[2] - target.size[2] / 2 - object.size[2] / 2 - gap;
  else if (relation === "behind") position[1] -= (target.size[1] + object.size[1]) / 2 + gap;
  else position[1] += (target.size[1] + object.size[1]) / 2 + gap;
  return { ...object, position, relations: [{ relation, target: target.id, text }] };
}

function parseAngle(text) {
  const match = text.match(/(?:rotate|rotation|angle|screen(?: angle)?|display).{0,16}?\b(-?\d+(?:\.\d+)?)\s*(?:degrees?|°)?/i) ||
    text.match(/\b(-?\d+(?:\.\d+)?)\s*degrees?\b/i);
  return match ? Number(match[1]) : null;
}

export function interpretCommand(text, scene, makeObject) {
  const command = text.trim();
  if (!command) return { kind: "none", message: "Type a design instruction." };

  const relationIndex=command.search(/\b(?:next to|beside|near|left of|right of|on top of|on|above|over|below|under|behind|in front of)\b/i);
  const commandTarget=relationIndex<0?command:command.slice(0,relationIndex);
  const target = findTarget(commandTarget, scene);
  const intent = findIntent(command, Boolean(target));
  const color = extractColor(command);

  if (intent === "help") return { kind: "none", message: "Try: create a 120 cm table, add a lamp on the table, change the table color to blue, or undo." };
  if (intent === "clear") return { kind: "clear", message: "Cleared the scene." };
  if (intent === "undo" || intent === "redo") return { kind: intent, message: intent === "undo" ? "Undid the last scene change." : "Redid the last scene change." };
  if (intent === "mode") {
    const mode = /\becad\b/i.test(command) ? "ECAD" : /\bcad\b/i.test(command) ? "CAD" : null;
    return mode ? { kind: "mode", mode, message: `Switched to ${mode}.` } : { kind: "none", message: "Specify CAD or ECAD mode." };
  }
  if (intent === "view") {
    const view = /\b(top|above)\b/i.test(command) ? "top" : /\b(front)\b/i.test(command) ? "front" : /\b(side)\b/i.test(command) ? "side" : "fit";
    return { kind: "view", view, message: `Changed view to ${view}.` };
  }
  if (intent === "delete") return target ? { kind: "delete", id: target.id, message: `Removed ${target.name}.` } : { kind: "none", message: "Name the object you want to delete." };
  if (intent === "select") return target ? { kind: "select", id: target.id, message: `Selected ${target.name}.` } : { kind: "none", message: "Name the object you want to select." };

  if (intent === "duplicate") {
    if (!target) return { kind: "none", message: "Name the object you want to duplicate." };
    const copy = makeObject(target.type, { ...target, name: `${target.name} copy`, relations: [] });
    copy.position = [...target.position];
    copy.position[0] += target.size[0] + 0.12;
    return { kind: "create", object: copy, message: `Duplicated ${target.name}.` };
  }

  if (target && intent === "update") {
    const patch = {};
    if (color) patch.color = color;
    if (/\b(material|made of|wooden|wood|metal|steel|aluminum|plastic|glass|copper)\b/i.test(command)) {
      const material = (command.match(/\b(wood|wooden|metal|steel|aluminum|plastic|glass|copper)\b/i) || [])[1];
      if (material) {
        patch.material = material.toLowerCase() === "wooden" ? "wood" : material.toLowerCase();
        if (!color) patch.color = MATERIAL_COLORS[patch.material] || target.color;
      }
    }
    if (/\b(width|wide|length|long|depth|deep|height|tall|high)\b/i.test(command)) {
      patch.size = parseDimensions(command, target.size);
    }
    const angle = parseAngle(command);
    if (angle !== null) {
      if (target.type === "laptop") patch.screenAngle = Math.min(170, Math.max(70, angle));
      else patch.rotation = [target.rotation[0], target.rotation[1], angle * Math.PI / 180];
    }
    if (/\b(rename|name)\b/i.test(command)) {
      const name = command.match(/\b(?:rename|name)\s+(?:the\s+)?(?:\w+\s+)?(?:to|as)\s+(.+)$/i);
      if (name) patch.name = name[1].trim();
    }
    if (!Object.keys(patch).length) return { kind: "none", message: "Specify a color, material, dimension, angle, or new name." };
    return { kind: "update", id: target.id, patch, message: `Updated ${target.name}.` };
  }

  if (intent === "move" && target) {
    if(relationFor(command)){
      if(!findRelationTarget(command,scene.filter(object=>object.id!==target.id))){
        return {kind:"none",message:"I couldn't find the referenced object in the scene."};
      }
      const moved=applyRelation(target,scene.filter(object=>object.id!==target.id),command);
      return {kind:"update",id:target.id,patch:{position:moved.position,relations:moved.relations},message:`Moved ${target.name}.`};
    }
    const direction = (command.match(/\b(left|right|forward|backward|back|up|down)\b/i) || [])[1]?.toLowerCase() || "";
    const distanceMatch = command.match(/(-?\d+(?:\.\d+)?)\s*(mm|cm|m)\b/i);
    const distance = distanceMatch ? toMeters(distanceMatch[1], distanceMatch[2]) : 0.25;
    const position = [...target.position];
    if (/\b(left)\b/.test(direction)) position[0] -= distance;
    else if (/\b(right)\b/.test(direction)) position[0] += distance;
    else if (/\b(forward|backward|back)\b/.test(direction)) position[1] += direction.includes("back") ? -distance : distance;
    else if (/\b(up)\b/.test(direction)) position[2] += distance;
    else if (/\b(down)\b/.test(direction)) position[2] -= distance;
    else return { kind: "none", message: "Specify a direction: left, right, forward, backward, up, or down." };
    return { kind: "update", id: target.id, patch: { position }, message: `Moved ${target.name}.` };
  }

  if (intent === "create" || intent === "move") {
    const relationIndex=command.search(/\b(?:next to|beside|near|left of|right of|on top of|on|above|over|below|under|behind|in front of)\b/i);
    const description=relationIndex<0?command:command.slice(0,relationIndex);
    const type = TYPES.find(candidate => new RegExp(`\\b${candidate}s?\\b`, "i").test(description)) ||
      (/\b(circuit board|pcb board|board)\b/i.test(description) ? "pcb" : null);
    if (!type) return { kind: "none", message: "Specify an object type such as cube, chair, laptop, PCB, or Arduino." };
    const material = (description.match(new RegExp(`\\b(${MATERIALS.join("|")})\\b`, "i")) || [])[1];
    const normalizedMaterial = material?.toLowerCase() === "wooden" ? "wood" : (material || (["table", "chair", "desk"].includes(type) ? "wood" : type === "pcb" ? "pcb" : "default")).toLowerCase();
    const object = makeObject(type, {
      material: normalizedMaterial,
      color: extractColor(description) || undefined,
      size: parseDimensions(description, makeObject(type).size)
    });
    object.position = [0, 0, object.size[2] / 2];
    const angle = parseAngle(description);
    if (type === "laptop" && angle !== null) object.screenAngle = Math.min(170, Math.max(70, angle));
    if (scene.length) {
      if (relationFor(command)) {
        if(!findRelationTarget(command,scene))return {kind:"none",message:"Create or name the referenced object before placing another object beside it."};
        return { kind: "create", object: applyRelation(object, scene, command), message: `Created ${object.name}.` };
      }
      object.position = [scene.length * (type === "arduino" ? 0.15 : 0.9), 0, object.size[2] / 2];
    } else object.position = [0, 0, object.size[2] / 2];
    return { kind: "create", object, message: `Created ${object.name}.` };
  }

  if (target) return { kind: "select", id: target.id, message: `Selected ${target.name}.` };
  return { kind: "none", message: "I couldn't map that instruction. Try “Create a wooden table 120 cm wide” or “help”." };
}
