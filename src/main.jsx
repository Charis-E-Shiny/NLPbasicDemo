import React, { useEffect, useMemo, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import { interpretCommand } from "./nlp.js";
import "./styles.css";
import "./responsive.css";

const MATERIAL_COLORS = {
  wood: "#8b5a2b",
  metal: "#9ca3af",
  steel: "#6b7280",
  aluminum: "#d1d5db",
  plastic: "#f3f4f6",
  glass: "#93c5fd",
  copper: "#b87333",
  pcb: "#176b4d",
  default: "#94a3b8"
};

const COLORS = ["#94a3b8","#ef4444","#f97316","#eab308","#22c55e","#06b6d4","#3b82f6","#8b5cf6","#ec4899","#111827","#ffffff"];

function uid(prefix="obj") { return `${prefix}_${Math.random().toString(36).slice(2,8)}_${Date.now().toString(36)}`; }
function cmToM(v) { return Number(v || 0) / 100; }
function mmToM(v) { return Number(v || 0) / 1000; }
function downloadBlob(blob, filename) {
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = filename;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}
function downloadText(text, filename, type="text/plain") {
  downloadBlob(new Blob([text], {type}), filename);
}

function defaultColorFor(material="default") {
  return MATERIAL_COLORS[material.toLowerCase()] || MATERIAL_COLORS.default;
}

function makeObject(type, props={}) {
  const presets = {
    cube: {name:"Cube", size:[1,1,1], material:"default"},
    table: {name:"Table", size:[1.2,.6,.75], material:"wood"},
    chair: {name:"Chair", size:[.6,.6,.9], material:"wood"},
    desk: {name:"Desk", size:[1.2,.6,.75], material:"wood"},
    wall: {name:"Wall", size:[3,.12,2.5], material:"default"},
    cylinder: {name:"Cylinder", size:[.5,.5,1], material:"metal"},
    sphere: {name:"Sphere", size:[.7,.7,.7], material:"plastic"},
    lamp: {name:"Lamp", size:[.35,.35,.7], material:"metal"},
    pcb: {name:"PCB", size:[.1,.06,.0016], material:"pcb"},
    resistor: {name:"Resistor", size:[.01,.004,.004], material:"metal"},
    led: {name:"LED", size:[.006,.006,.006], material:"plastic"},
    mcu: {name:"MCU", size:[.012,.012,.004], material:"plastic"},
    arduino: {name:"Arduino UNO R3", size:[.0686,.0534,.014], material:"pcb"},
    laptop: {name:"Laptop", size:[.32,.22,.025], material:"aluminum"}
  };
  const p = presets[type] || presets.cube;
  return {
    id: uid(type),
    type,
    name: props.name || p.name,
    position: props.position || [0,0,0],
    rotation: props.rotation || [0,0,0],
    size: props.size || p.size,
    material: props.material || p.material,
    color: props.color || defaultColorFor(props.material || p.material),
    relations: props.relations || []
  };
}

function validateProject(data) {
  const allowedTypes=["cube","table","chair","desk","wall","cylinder","sphere","lamp","pcb","resistor","led","mcu","laptop","arduino"];
  const allowedMaterials=Object.keys(MATERIAL_COLORS);
  if(!data||data.format!=="CADVoice"||data.version!==1||!Array.isArray(data.scene)||data.scene.length>1000){
    throw new Error("Project format or version is unsupported.");
  }
  const identifiers=new Set();
  for(const object of data.scene){
    if(!object||typeof object.id!=="string"||!object.id||identifiers.has(object.id)||
      typeof object.name!=="string"||!object.name.trim()||object.name.length>120||
      !allowedTypes.includes(object.type)||!allowedMaterials.includes(object.material)||
      !/^#[0-9a-f]{6}$/i.test(object.color)||
      !Array.isArray(object.size)||object.size.length!==3||!object.size.every(value=>Number.isFinite(value)&&value>0&&value<=100)||
      !Array.isArray(object.position)||object.position.length!==3||!object.position.every(value=>Number.isFinite(value)&&Math.abs(value)<=10000)||
      !Array.isArray(object.rotation)||object.rotation.length!==3||!object.rotation.every(Number.isFinite)||
      (object.screenAngle!==undefined&&(!Number.isFinite(object.screenAngle)||object.screenAngle<70||object.screenAngle>170))||
      (object.relations!==undefined&&!Array.isArray(object.relations))
    )throw new Error("Project contains an invalid object.");
    identifiers.add(object.id);
  }
  return {
    mode:data.mode==="ECAD"?"ECAD":"CAD",
    scene:data.scene.map(object=>({...object,name:object.name.trim(),relations:(object.relations||[]).slice(0,100)}))
  };
}

function buildGeometry(obj) {
  const [x,y,z] = obj.size;
  if (obj.type === "cylinder" || obj.type === "lamp") return new THREE.CylinderGeometry(x/2, x/2, z, 32).rotateX(Math.PI/2);
  if (obj.type === "sphere") return new THREE.SphereGeometry(x/2, 32, 20);
  if (obj.type === "resistor") return new THREE.BoxGeometry(x,y,z);
  if (obj.type === "led") return new THREE.CylinderGeometry(x/2,x/2,z,24).rotateX(Math.PI/2);
  return new THREE.BoxGeometry(x,y,z);
}

function matFor(obj, color=obj.color) {
  return new THREE.MeshStandardMaterial({
    color,
    metalness: ["metal","steel","aluminum","copper"].includes(obj.material) ? .65 : 0,
    roughness: .42
  });
}
function part(geometry, material, position=[0,0,0], rotation=[0,0,0]) {
  const m = new THREE.Mesh(geometry, material);
  m.position.set(...position); m.rotation.set(...rotation);
  m.castShadow = true; m.receiveShadow = true;
  return m;
}
function createMesh(obj) {
  const root = new THREE.Group();
  root.position.set(...obj.position);
  root.rotation.set(...obj.rotation.map(Number));
  root.userData.objectId = obj.id;
  const [w,d,h] = obj.size;
  const mat = matFor(obj);

  // Parametric visual assemblies so furniture/components don't look like cubes.
  if (obj.type === "table" || obj.type === "desk") {
    const topH = Math.max(.055, h*.08);
    const leg = Math.max(.045, Math.min(w,d)*.07);
    root.add(part(new THREE.BoxGeometry(w,d,topH), mat, [0,0,h/2-topH/2]));
    const lx=w/2-leg/2, lz=h/2-topH;
    for (const x of [-lx,lx]) for (const z of [-d/2+leg/2,d/2-leg/2])
      root.add(part(new THREE.BoxGeometry(leg,leg,h-topH), mat, [x,z*0+0,z], [0,0,0]));
    // Correct leg layout: x is width axis, y is depth axis, z is height.
    root.children.slice(1).forEach((m,i)=>{
      const x = i%2===0 ? -lx : lx;
      const y = i<2 ? -d/2+leg/2 : d/2-leg/2;
      m.position.set(x,y,-topH/2);
    });
  } else if (obj.type === "chair") {
    const wood = mat;
    const seatH = h*.52, seatT = Math.max(.05,h*.07), leg=.055, floor=-h/2;
    root.add(part(new THREE.BoxGeometry(w,d,seatT), wood, [0,0,seatH-h/2]));
    // four legs
    const lx=w/2-leg/2, ly=d/2-leg/2;
    for (const x of [-lx,lx]) for (const y of [-ly,ly])
      root.add(part(new THREE.BoxGeometry(leg,leg,seatH), wood, [x,y,floor+seatH/2]));
    // back posts and backrest
    root.add(part(new THREE.BoxGeometry(leg,leg,h-seatH), wood, [-lx,ly,(h+seatH)/2-h/2]));
    root.add(part(new THREE.BoxGeometry(leg,leg,h-seatH), wood, [lx,ly,(h+seatH)/2-h/2]));
    root.add(part(new THREE.BoxGeometry(w,leg*.9,h*.30), wood, [0,ly,h*.76-h/2]));
    root.add(part(new THREE.BoxGeometry(w*.82,leg*.75,h*.18), wood, [0,ly,h*.58-h/2]));
  } else if (obj.type === "lamp") {
    root.add(part(new THREE.CylinderGeometry(w*.34,w*.40,h*.08,32).rotateX(Math.PI/2), mat, [0,0,-h/2+h*.04]));
    root.add(part(new THREE.CylinderGeometry(w*.045,w*.045,h*.58,24).rotateX(Math.PI/2), mat, [0,0,-h*.16]));
    root.add(part(new THREE.ConeGeometry(w*.42,w*.32,32,1,true).rotateX(Math.PI/2), matFor(obj, obj.color), [0,0,h*.25]));
    root.add(part(new THREE.SphereGeometry(w*.12,24,16), new THREE.MeshStandardMaterial({color:"#fff7c2", emissive:"#fff0a0", emissiveIntensity:1.5}), [0,0,h*.10]));
  } else if (obj.type === "wall") {
    root.add(part(new THREE.BoxGeometry(w,d,h), mat));
    const edge = new THREE.LineSegments(new THREE.EdgesGeometry(new THREE.BoxGeometry(w,d,h)), new THREE.LineBasicMaterial({color:"#475569"}));
    root.add(edge);
  } else if (obj.type === "laptop") {
    // Parametric laptop: base + keyboard deck + trackpad + screen + bezel + hinges.
    const baseH = Math.max(.012, h);
    const deckH = Math.max(.003, baseH*.22);
    const silver = matFor(obj, obj.color);
    const dark = matFor(obj, "#20242a");
    const screenMat = new THREE.MeshStandardMaterial({
      color: "#111827", metalness: .05, roughness: .18,
      emissive: "#0b1220", emissiveIntensity: .15
    });
    const keyboardMat = matFor(obj, "#2b3037");
    root.add(part(new THREE.BoxGeometry(w,d,baseH), silver, [0,0,-h/2+baseH/2]));
    root.add(part(new THREE.BoxGeometry(w*.92,d*.72,deckH), keyboardMat, [0,-d*.035,-h/2+baseH+deckH/2]));
    root.add(part(new THREE.BoxGeometry(w*.24,d*.30,.002), dark, [0,-d*.11,-h/2+baseH+deckH+.0015]));
    // keyboard key field
    for(let r=0;r<5;r++) for(let c=0;c<11;c++){
      const kw=w*.055, kd=d*.045;
      root.add(part(new THREE.BoxGeometry(kw,kd,.0015), matFor(obj,"#606771"),
        [(-w*.30)+c*w*.06, d*.08-r*d*.055, -h/2+baseH+deckH+.0025]));
    }
    const screenW=w*.96, screenH=w*.62, bezel=.008;
    const screenDepth=.012;
    const screenGroup=new THREE.Group();
    screenGroup.position.set(0,d*.43,-h/2+baseH);
    const openAngle = obj.screenAngle ?? 110;
    screenGroup.rotation.x = THREE.MathUtils.degToRad(openAngle-180);
    screenGroup.add(part(new THREE.BoxGeometry(screenW,screenDepth,screenH), dark, [0,0,screenH/2]));
    screenGroup.add(part(new THREE.BoxGeometry(screenW-bezel*2,.003,screenH-bezel*2), screenMat, [0,-screenDepth/2-.002,screenH/2]));
    // top/bottom/side bezel accents
    screenGroup.add(part(new THREE.BoxGeometry(screenW,.004,bezel), matFor(obj,"#343a40"), [0,-screenDepth/2-.004,bezel/2]));
    root.add(screenGroup);
    root.add(part(new THREE.CylinderGeometry(.006,.006,d*.10,20), silver, [-w*.22,d*.40,-h/2+baseH], [0,0,Math.PI/2]));
    root.add(part(new THREE.CylinderGeometry(.006,.006,d*.10,20), silver, [w*.22,d*.40,-h/2+baseH], [0,0,Math.PI/2]));
  } else if (obj.type === "arduino") {
    const boardThickness=.0016, boardZ=-h/2+boardThickness/2;
    const boardTop=-h/2+boardThickness;
    const boardShape=new THREE.Shape();
    const radius=.004;
    boardShape.moveTo(-w/2+radius,-d/2);
    boardShape.lineTo(w/2-radius,-d/2); boardShape.quadraticCurveTo(w/2,-d/2,w/2,-d/2+radius);
    boardShape.lineTo(w/2,d/2-radius); boardShape.quadraticCurveTo(w/2,d/2,w/2-radius,d/2);
    boardShape.lineTo(-w/2+radius,d/2); boardShape.quadraticCurveTo(-w/2,d/2,-w/2,d/2-radius);
    boardShape.lineTo(-w/2,-d/2+radius); boardShape.quadraticCurveTo(-w/2,-d/2,-w/2+radius,-d/2);
    const boardGeometry=new THREE.ExtrudeGeometry(boardShape,{depth:boardThickness,bevelEnabled:false});
    const board=part(boardGeometry,mat,[0,0,boardZ-boardThickness/2]);
    root.add(board);
    const component=(geometry,material,x,y,z)=>root.add(part(geometry,material,[x,y,boardTop+(h/2-z)]));
    const green=matFor(obj,"#087443"), dark=matFor(obj,"#20252b");
    const gold=matFor(obj,"#d4af37"), steel=matFor(obj,"#b8c2cc");
    const pinMat=matFor(obj,"#c7a64b");
    const copper=matFor(obj,"#dcae36");
    for (const [x,y] of [[-w*.39,-d*.39],[w*.39,-d*.39],[-w*.39,d*.39],[w*.39,d*.39]]) {
      component(new THREE.CylinderGeometry(.0025,.0025,.0004,24).rotateX(Math.PI/2),gold,x,y,h/2-.0001);
      component(new THREE.CylinderGeometry(.0011,.0011,.0005,20).rotateX(Math.PI/2),dark,x,y,h/2+.0002);
    }
    component(new THREE.BoxGeometry(.018,.014,.011),steel,-w*.36,-d*.07,h/2-.0055);
    component(new THREE.BoxGeometry(.013,.013,.012),dark,-w*.34,-d*.34,h/2-.006);
    component(new THREE.CylinderGeometry(.004,.004,.009,24),dark,-w*.26,-d*.34,h/2-.0045);
    component(new THREE.BoxGeometry(.027,.010,.004),dark,w*.03,-d*.14,h/2-.002);
    component(new THREE.BoxGeometry(.009,.005,.003),green,-w*.20,-d*.12,h/2-.0015);
    component(new THREE.BoxGeometry(.007,.005,.003),dark,w*.30,-d*.20,h/2-.0015);
    component(new THREE.BoxGeometry(.007,.005,.003),dark,w*.30,d*.21,h/2-.0015);
    component(new THREE.BoxGeometry(.006,.004,.003),dark,w*.24,-d*.35,h/2-.0015);
    for(const x of [-w*.30,-w*.12,w*.17,w*.38]){
      for(const y of [-d*.47,d*.47]){
        component(new THREE.BoxGeometry(.004,.002,.006),dark,x,y,h/2-.003);
        component(new THREE.BoxGeometry(.001,.001,.006),pinMat,x,y,h/2-.006);
      }
    }
    for(let i=0;i<6;i++) for(const y of [-d*.37,d*.37]){
      const x=-w*.20+i*w*.075;
      component(new THREE.CylinderGeometry(.001,.001,.0025,12).rotateX(Math.PI/2),copper,x,y,h/2-.0001);
      component(new THREE.BoxGeometry(.001,.001,.006),pinMat,x,y,h/2-.004);
    }
    for(let i=0;i<4;i++){
      const x=-w*.16+i*w*.11;
      component(new THREE.BoxGeometry(.002,.003,.003),steel,x,d*.20,h/2-.0015);
    }
    component(new THREE.BoxGeometry(.004,.005,.003),dark,-w*.05,d*.20,h/2-.0015);
    component(new THREE.SphereGeometry(.0015,12,8),new THREE.MeshStandardMaterial({color:"#ef4444",emissive:"#ef4444",emissiveIntensity:.7}),w*.32,d*.02,h/2-.001);
  } else if (obj.type === "pcb") {
    root.add(part(new THREE.BoxGeometry(w,d,h), mat));
    const sil = new THREE.MeshStandardMaterial({color:"#e5e7eb",metalness:.1,roughness:.3});
    for (const x of [-w*.38,w*.38]) for (const y of [-d*.38,d*.38])
      root.add(part(new THREE.CylinderGeometry(.0015,.0015,.002,16).rotateX(Math.PI/2), sil, [x,y,h/2+.001]));
  } else if (obj.type === "mcu") {
    root.add(part(new THREE.BoxGeometry(w,d,h), matFor(obj,"#20252b")));
    const pinMat=matFor(obj,"#d4af37");
    for(let i=-2;i<=2;i++){ root.add(part(new THREE.BoxGeometry(.001,w*.08,h*.5),pinMat,[i*w*.18,-d/2-.001,0])); root.add(part(new THREE.BoxGeometry(.001,w*.08,h*.5),pinMat,[i*w*.18,d/2+.001,0])); }
  } else if (obj.type === "resistor") {
    root.add(part(new THREE.CylinderGeometry(w*.18, w*.18, w*.72, 20), matFor(obj,"#d6b98c"), [0,0,0], [0,Math.PI/2,0]));
    root.add(part(new THREE.CylinderGeometry(w*.035,w*.035,w*.28,12), matFor(obj,"#c0a080"), [-w*.5,0,0],[0,Math.PI/2,0]));
    root.add(part(new THREE.CylinderGeometry(w*.035,w*.035,w*.28,12), matFor(obj,"#c0a080"), [w*.5,0,0],[0,Math.PI/2,0]));
  } else if (obj.type === "led") {
    root.add(part(new THREE.CylinderGeometry(w/2,w/2,h*.7,24).rotateX(Math.PI/2), matFor(obj,obj.color), [0,0,h*.1]));
    root.add(part(new THREE.CylinderGeometry(w*.42,w*.42,h*.35,24).rotateX(Math.PI/2), new THREE.MeshStandardMaterial({color:obj.color,transparent:true,opacity:.72,emissive:obj.color,emissiveIntensity:.35}), [0,0,h*.55]));
  } else {
    root.add(part(buildGeometry(obj), mat));
  }
  return root;
}

function parseNumber(text, unit="cm") {
  const m = String(text).match(/(-?\d+(?:\.\d+)?)\s*(mm|cm|m)?/i);
  if (!m) return null;
  const n = Number(m[1]), u = (m[2] || unit).toLowerCase();
  return u === "mm" ? mmToM(n) : u === "m" ? n : cmToM(n);
}

function parseDimensions(text, type) {
  const lower = text.toLowerCase();
  let size = type === "chair" ? [.6,.6,.9] :
    type === "table" || type === "desk" ? [1.2,.6,.75] :
    type === "laptop" ? [.32,.22,.025] : [1,1,1];
  const unit = lower.includes("mm") ? "mm" : lower.includes(" m ") || lower.endsWith("m") ? "m" : "cm";
  const vals = [...lower.matchAll(/(\d+(?:\.\d+)?)\s*(mm|cm|m)?/g)].map(m => {
    const u = (m[2] || unit).toLowerCase(), n=Number(m[1]);
    return u==="mm"?mmToM(n):u==="m"?n:cmToM(n);
  });
  const w = lower.match(/(?:width|wide)\s*(?:of|is|=)?\s*(\d+(?:\.\d+)?)\s*(mm|cm|m)?/);
  const d = lower.match(/(?:depth|deep)\s*(?:of|is|=)?\s*(\d+(?:\.\d+)?)\s*(mm|cm|m)?/);
  const h = lower.match(/(?:height|tall|high)\s*(?:of|is|=)?\s*(\d+(?:\.\d+)?)\s*(mm|cm|m)?/);
  const l = lower.match(/(?:length|long)\s*(?:of|is|=)?\s*(\d+(?:\.\d+)?)\s*(mm|cm|m)?/);
  const conv = m => {
    if (!m) return null;
    const n=Number(m[1]), u=(m[2]||unit).toLowerCase();
    return u==="mm"?mmToM(n):u==="m"?n:cmToM(n);
  };
  if (w || d || h || l) {
    size = [conv(w||l)||size[0], conv(d)||size[1], conv(h)||size[2]];
  } else if (vals.length >= 3 && /(\d).*(?:x|by|×).*?(\d).*(?:x|by|×).*?(\d)/i.test(lower)) {
    size = vals.slice(0,3);
  }
  return size;
}

function detectType(text) {
  const t=text.toLowerCase();
  const types=["laptop","table","chair","desk","wall","cube","cylinder","sphere","lamp","pcb","resistor","led","mcu"];
  return types.find(x => new RegExp(`\\b${x}s?\\b`).test(t)) || "cube";
}

function parseColor(text, material) {
  const t=text.toLowerCase();
  const names={red:"#ef4444",blue:"#3b82f6",green:"#22c55e",yellow:"#eab308",orange:"#f97316",purple:"#8b5cf6",pink:"#ec4899",black:"#111827",white:"#ffffff",gray:"#94a3b8",grey:"#94a3b8",brown:"#8b5a2b"};
  for (const [k,v] of Object.entries(names)) if (new RegExp(`\\b${k}\\b`).test(t)) return v;
  return defaultColorFor(material);
}

function spatialPlacement(newObj, scene, text) {
  const t=text.toLowerCase();
  const refs=scene.filter(o => o.id !== newObj.id);
  let ref = refs.find(o => t.includes(o.name.toLowerCase())) || refs.find(o => t.includes(o.type));
  if (!ref) return newObj;
  const gap=.12;
  const p=[...ref.position];
  if (/\b(left|to the left)\b/.test(t)) p[0] -= (ref.size[0]+newObj.size[0])/2+gap;
  else if (/\b(right|to the right)\b/.test(t)) p[0] += (ref.size[0]+newObj.size[0])/2+gap;
  else if (/\b(above|on top|over)\b/.test(t)) p[1] += (ref.size[1]+newObj.size[1])/2+gap;
  else if (/\b(below|under)\b/.test(t)) p[1] -= (ref.size[1]+newObj.size[1])/2+gap;
  else if (/\b(behind|back)\b/.test(t)) p[2] -= (ref.size[2]+newObj.size[2])/2+gap;
  else p[0] += (ref.size[0]+newObj.size[0])/2+gap;
  return {...newObj, position:p, relations:[{relation:"spatial",target:ref.id,text}]};
}

function interpretLegacyCommand(text, scene) {
  const t=text.toLowerCase().trim();
  if (!t) return {kind:"none", message:"Type a design instruction."};

  const target = scene.find(o => t.includes(o.name.toLowerCase())) || scene.find(o => t.includes(o.type));
  const color = parseColor(t, target?.material);
  if (target && /\b(make|change|set).*(?:color|colour|red|blue|green|yellow|orange|purple|pink|black|white|gray|grey|brown)\b/.test(t)) {
    return {kind:"update", id:target.id, patch:{color}, message:`Changed ${target.name} color.`};
  }
  if (target && /\b(delete|remove)\b/.test(t)) return {kind:"delete", id:target.id, message:`Removed ${target.name}.`};
  if (target && /\b(?:make|set|change).*(?:width|wide)\b/.test(t)) {
    const m=t.match(/(?:width|wide)[^\d]*(\d+(?:\.\d+)?)\s*(mm|cm|m)?/);
    if(m) return {kind:"update",id:target.id,patch:{size:[parseNumber(m[0]),target.size[1],target.size[2]]},message:`Updated ${target.name} width.`};
  }
  if (/\b(move|put|place|create|add|make|generate|draw)\b/.test(t)) {
    const type=detectType(t), material=(t.match(/\b(wood|wooden|metal|steel|aluminum|plastic|glass|copper|pcb)\b/)||[])[1] || (type==="pcb"?"pcb":type==="table"||type==="chair"||type==="desk"?"wood":"default");
    const normalizedMaterial=material==="wooden"?"wood":material;
    let obj=makeObject(type,{material:normalizedMaterial,color:parseColor(t,normalizedMaterial)});
    obj.size=parseDimensions(t,type);
    if (type==="pcb") obj.size=parseDimensions(t,"cube");
    if (type==="laptop") {
      const angle=t.match(/(?:screen|display).{0,20}?(?:at|to|of)\\s*(\\d+(?:\\.\\d+)?)\\s*°?/);
      if(angle) obj.screenAngle=Number(angle[1]);
      const open=t.match(/open.{0,15}?(\\d+(?:\\.\\d+)?)\\s*°?/);
      if(open) obj.screenAngle=Number(open[1]);
    }
    if (/\b(on|above|over)\b/.test(t) && scene.length) obj=spatialPlacement(obj,scene,t);
    else if (scene.length && /\b(next to|beside|near|left of|right of|behind|in front of|below|under|above)\b/.test(t)) obj=spatialPlacement(obj,scene,t);
    else if (scene.length) obj.position=[scene.length*.9,0,0];
    return {kind:"create",object:obj,message:`Created ${obj.name}.`};
  }
  if (target) return {kind:"select",id:target.id,message:`Selected ${target.name}.`};
  return {kind:"none",message:"I couldn't map that instruction yet. Try: “Create a wooden chair 60 cm wide next to the table.”"};
}

function sceneToOpenSCAD(scene) {
  return `// CADVoice generated OpenSCAD\n// Units: millimeters\n\n${scene.map(o => {
    const [x,y,z]=o.size.map(v=>Math.round(v*1000*100)/100);
    const [px,py,pz]=o.position.map(v=>Math.round(v*1000*100)/100);
    const [rx,ry,rz]=o.rotation.map(v=>+(v*180/Math.PI).toFixed(2));
    const geometry=o.type==="cylinder"
      ? `translate([0,0,${-z/2}]) cylinder(h=${z}, r=${x/2}, $fn=48);`
      : o.type==="sphere" ? `sphere(r=${x/2}, $fn=48);` : `cube([${x},${y},${z}], center=true);`;
    return `translate([${px},${py},${pz}]) rotate([${rx},${ry},${rz}]) color("${o.color}") ${geometry}`;
  }).join("\n")}`;
}
function sceneToCadQuery(scene) {
  return `# CADVoice generated CadQuery\n# Units: millimeters\nimport cadquery as cq\n\nassembly = cq.Assembly()\n${scene.map(o => {
    const [x,y,z]=o.size.map(v=>Math.round(v*1000*100)/100);
    const [px,py,pz]=o.position.map(v=>Math.round(v*1000*100)/100);
    const [rx,ry,rz]=o.rotation.map(v=>+(v*180/Math.PI).toFixed(2));
    const name=o.id.replace(/[^a-zA-Z0-9_]/g,"_");
    return `shape_${name} = cq.Workplane("XY").box(${x}, ${y}, ${z}).rotate((0,0,0), (1,0,0), ${rx}).rotate((0,0,0), (0,1,0), ${ry}).rotate((0,0,0), (0,0,1), ${rz}).translate((${px}, ${py}, ${pz}))\nassembly.add(shape_${name}.val(), name="${name}", color=cq.Color("${o.color}"))`;
  }).join("\n")}\n\nassembly.save("design.step")`;
}
function sceneToOpenJSCAD(scene) {
  return `// CADVoice generated OpenJSCAD\nconst { cuboid, cylinder, sphere } = require('@jscad/modeling').primitives;\nconst { translate, rotate } = require('@jscad/modeling').transforms;\n\nconst objects = [\n${scene.map(o=>{
    const [x,y,z]=o.size.map(v=>Math.round(v*1000*100)/100);
    const [px,py,pz]=o.position.map(v=>Math.round(v*1000*100)/100);
    const [rx,ry,rz]=o.rotation.map(v=>+(v*180/Math.PI).toFixed(2));
    const shape=o.type==="sphere"?`sphere({radius:${x/2},segments:32})`:o.type==="cylinder"?`cylinder({radius:${x/2},height:${z},segments:32})`:`cuboid({size:[${x},${y},${z}]})`;
    return `  translate([${px},${py},${pz}], rotate([${rx},${ry},${rz}], ${shape}))`;
  }).join(",\n")}\n];\nmodule.exports = { main: () => objects };`;
}

function App(){
  const [scene,setScene]=useState([]);
  const [selected,setSelected]=useState(null);
  const [prompt,setPrompt]=useState("");
  const [status,setStatus]=useState("Ready — no account or database required.");
  const [tab,setTab]=useState("visual");
  const [scriptLang,setScriptLang]=useState("openscad");
  const [script,setScript]=useState("");
  const [exportOpen,setExportOpen]=useState(false);
  const [mode,setMode]=useState("CAD");
  const canvasRef=useRef(null);
  const sceneStateRef=useRef(scene);
  const historyRef=useRef({undo:[],redo:[]});
  const rendererRef=useRef(null);
  const groupRef=useRef(null);
  const cameraRef=useRef(null);
  const controlsRef=useRef(null);

  const selectedObj=scene.find(o=>o.id===selected);

  useEffect(()=>{
    const container=canvasRef.current;
    const sc=new THREE.Scene(); sc.background=new THREE.Color("#f8fafc");
    sc.add(new THREE.HemisphereLight(0xffffff,0x64748b,2));
    const dir=new THREE.DirectionalLight(0xffffff,2.5); dir.position.set(5,8,6); dir.castShadow=true; sc.add(dir);
    const grid=new THREE.GridHelper(12,24,0xcbd5e1,0xe2e8f0); grid.rotation.x=Math.PI/2; sc.add(grid);
    const axes=new THREE.AxesHelper(1.5); sc.add(axes);
    let renderer;
    try{
      renderer=new THREE.WebGLRenderer({antialias:true,preserveDrawingBuffer:true});
    }catch(error){
      setStatus(`3D rendering is unavailable in this browser: ${error.message}`);
      return;
    }
    renderer.setPixelRatio(Math.min(devicePixelRatio,2)); renderer.setSize(container.clientWidth,container.clientHeight); renderer.shadowMap.enabled=true; container.appendChild(renderer.domElement);
    const camera=new THREE.PerspectiveCamera(45,container.clientWidth/container.clientHeight,.01,100); camera.up.set(0,0,1); camera.position.set(4,-5,4);
    const controls=new OrbitControls(camera,renderer.domElement); controls.enableDamping=true;
    const group=new THREE.Group(); sc.add(group);
    rendererRef.current=renderer; groupRef.current=group; cameraRef.current=camera; controlsRef.current=controls;
    const resize=()=>{const width=container.clientWidth,height=container.clientHeight;if(!width||!height)return;camera.aspect=width/height;camera.updateProjectionMatrix();renderer.setSize(width,height)};
    const observer=new ResizeObserver(resize); observer.observe(container); resize();
    let raf; const loop=()=>{controls.update();renderer.render(sc,camera);raf=requestAnimationFrame(loop)}; loop();
    return ()=>{cancelAnimationFrame(raf);observer.disconnect();controls.dispose();renderer.dispose();if(container.contains(renderer.domElement))container.removeChild(renderer.domElement);rendererRef.current=null;cameraRef.current=null;controlsRef.current=null;};
  },[]);

  useEffect(()=>{
    sceneStateRef.current=scene;
    const group=groupRef.current; if(!group) return;
    while(group.children.length){
      const child=group.children[0];
      child.traverse(node=>{node.geometry?.dispose();if(Array.isArray(node.material))node.material.forEach(material=>material.dispose());else node.material?.dispose();});
      group.remove(child);
    }
    scene.forEach(o=>group.add(createMesh(o)));
  },[scene]);

  const changeScene=(next)=>{
    const current=sceneStateRef.current;
    const value=typeof next==="function"?next(current):next;
    if(value===current)return;
    historyRef.current.undo.push(current);
    if(historyRef.current.undo.length>100)historyRef.current.undo.shift();
    historyRef.current.redo=[];
    sceneStateRef.current=value;
    setScene(value);
  };
  const undoScene=()=>{
    const previous=historyRef.current.undo.pop();
    if(!previous){setStatus("Nothing to undo.");return;}
    historyRef.current.redo.push(sceneStateRef.current);
    sceneStateRef.current=previous;setScene(previous);setSelected(null);
  };
  const redoScene=()=>{
    const next=historyRef.current.redo.pop();
    if(!next){setStatus("Nothing to redo.");return;}
    historyRef.current.undo.push(sceneStateRef.current);
    sceneStateRef.current=next;setScene(next);setSelected(null);
  };

  const changeView=(view)=>{
    const camera=cameraRef.current,controls=controlsRef.current,group=groupRef.current;
    if(!camera||!controls)return;
    const bounds=new THREE.Box3().setFromObject(group);
    const center=bounds.isEmpty()?new THREE.Vector3(0,0,0):bounds.getCenter(new THREE.Vector3());
    const size=bounds.isEmpty()?new THREE.Vector3(2,2,2):bounds.getSize(new THREE.Vector3());
    const distance=Math.max(size.length(),.1)*1.7;
    controls.target.copy(center);
    if(view==="top"){camera.position.set(center.x,center.y,center.z+distance);camera.up.set(0,1,0);}
    else if(view==="front"){camera.position.set(center.x,center.y-distance,center.z);camera.up.set(0,0,1);}
    else if(view==="side"){camera.position.set(center.x+distance,center.y,center.z);camera.up.set(0,0,1);}
    else{camera.position.set(center.x+distance*.65,center.y-distance*.65,center.z+distance*.45);camera.up.set(0,0,1);}
    camera.lookAt(center);controls.update();
  };

  const runPrompt=()=>{
    const r=interpretCommand(prompt,scene,makeObject); setStatus(r.message);
    if(r.kind==="create"){changeScene(s=>[...s,r.object]);setSelected(r.object.id);}
    if(r.kind==="update"){
      changeScene(s=>s.map(o=>{
        if(o.id!==r.id)return o;
        const patch={...r.patch};
        if(patch.size)patch.position=[o.position[0],o.position[1],o.position[2]+(patch.size[2]-o.size[2])/2];
        return {...o,...patch};
      }));
      setSelected(r.id);
    }
    if(r.kind==="delete"){changeScene(s=>s.filter(o=>o.id!==r.id));setSelected(null);}
    if(r.kind==="select")setSelected(r.id);
    if(r.kind==="clear"){changeScene([]);setSelected(null);}
    if(r.kind==="undo")undoScene();
    if(r.kind==="redo")redoScene();
    if(r.kind==="mode")setMode(r.mode);
    if(r.kind==="view")changeView(r.view);
    setPrompt("");
  };

  const startVoice=()=>{
    const SR=window.SpeechRecognition||window.webkitSpeechRecognition;
    if(!SR){setStatus("Speech recognition is not supported by this browser. Try Chrome/Edge.");return;}
    const rec=new SR(); rec.lang=navigator.language||"en-US"; rec.interimResults=false;
    rec.onstart=()=>setStatus("Listening…");
    rec.onresult=e=>{const t=e.results[0][0].transcript;setPrompt(t);setStatus("Voice captured. Press Generate.");};
    rec.onerror=e=>setStatus(`Voice input failed: ${e.error||"permission or network error"}.`);
    try{rec.start();}catch(error){setStatus(`Voice input could not start: ${error.message}`);}
  };

  const updateSelected=(patch)=>{
    if(!selectedObj)return;
    if(patch.size&&(!patch.size.every(Number.isFinite)||patch.size.some(v=>v<=0||v>100))){
      setStatus("Dimensions must be positive values no larger than 100 m.");
      return;
    }
    if(patch.position&&(!patch.position.every(Number.isFinite)||patch.position.some(v=>Math.abs(v)>10000))){
      setStatus("Position values must be finite and within 10,000 m.");
      return;
    }
    if(patch.rotation&&!patch.rotation.every(Number.isFinite)){
      setStatus("Rotation values must be finite.");
      return;
    }
    if(patch.name!==undefined&&!patch.name.trim()){
      setStatus("Object names cannot be empty.");
      return;
    }
    changeScene(s=>s.map(o=>{
      if(o.id!==selectedObj.id)return o;
      const nextPatch={...patch};
      if(nextPatch.size)nextPatch.position=[o.position[0],o.position[1],o.position[2]+(nextPatch.size[2]-o.size[2])/2];
      return {...o,...nextPatch};
    }));
  };

  const saveProject=()=>downloadText(JSON.stringify({format:"CADVoice",version:1,mode,scene},null,2),"design.cadvoice","application/json");
  const openProject=(e)=>{
    const file=e.target.files?.[0]; if(!file)return;
    if(file.size>10*1024*1024){setStatus("Project files must be smaller than 10 MB.");e.target.value="";return;}
    const r=new FileReader();
    r.onerror=()=>setStatus("Could not read the selected project file.");
    r.onload=()=>{
      try{
        const project=validateProject(JSON.parse(r.result));
        changeScene(project.scene);setMode(project.mode);setSelected(null);setStatus("Project opened locally.");
      }catch(error){setStatus(`Invalid .cadvoice project file: ${error.message}`);}
    };
    r.readAsText(file);
    e.target.value="";
  };

  const loadSample=async()=>{
    try{
      const response=await fetch("/examples/arduino-demo.cadvoice");
      if(!response.ok)throw new Error(`Sample request failed (${response.status}).`);
      const project=validateProject(await response.json());
      changeScene(project.scene);setMode(project.mode);setSelected(project.scene[0]?.id||null);setStatus("Loaded Arduino UNO R3 sample scene.");
      requestAnimationFrame(()=>requestAnimationFrame(()=>changeView("fit")));
    }catch(error){setStatus(`Could not load sample: ${error.message}`);}
  };

  const exportFile=async(kind)=>{
    setExportOpen(false);
    if(kind==="openscad"){downloadText(sceneToOpenSCAD(scene),"design.scad");return;}
    if(kind==="cadquery"){downloadText(sceneToCadQuery(scene),"design.py");return;}
    if(kind==="openjscad"){downloadText(sceneToOpenJSCAD(scene),"design.js");return;}
    if(kind==="json"){downloadText(JSON.stringify({format:"CADVoice",version:1,scene},null,2),"design.cadvoice","application/json");return;}
    if(kind==="bom"){
      const counts={}; scene.filter(o=>["arduino","pcb","resistor","led","mcu"].includes(o.type)).forEach(o=>counts[o.name]=(counts[o.name]||0)+1);
      const csvField=value=>`"${String(value).replace(/^[=+\-@]/,"'$&").replace(/"/g,'""')}"`;
      const csv="Part,Quantity\r\n"+Object.entries(counts).map(([k,v])=>`${csvField(k)},${v}`).join("\r\n");
      downloadText(csv, "bom.csv","text/csv");return;
    }
    if(kind==="stl"){
      const {STLExporter}=await import("three/examples/jsm/exporters/STLExporter.js");
      const group=new THREE.Group(); scene.forEach(o=>group.add(createMesh(o))); const data=new STLExporter().parse(group,{binary:true}); downloadBlob(new Blob([data],{type:"model/stl"}),"design.stl");return;
    }
    if(kind==="obj"){
      const {OBJExporter}=await import("three/examples/jsm/exporters/OBJExporter.js");
      const group=new THREE.Group(); scene.forEach(o=>group.add(createMesh(o))); downloadText(new OBJExporter().parse(group),"design.obj");return;
    }
    if(kind==="glb"){
      const {GLTFExporter}=await import("three/examples/jsm/exporters/GLTFExporter.js");
      const group=new THREE.Group(); scene.forEach(o=>group.add(createMesh(o)));
      try{
        new GLTFExporter().parse(group,(result)=>downloadBlob(new Blob([result],{type:"model/gltf-binary"}),"design.glb"),error=>setStatus(`GLB export failed: ${error.message}`),{binary:true});
      }catch(error){setStatus(`GLB export failed: ${error.message}`);}
      return;
    }
    if(kind==="png"){
      const canvas=rendererRef.current?.domElement; if(canvas){const a=document.createElement("a");a.href=canvas.toDataURL("image/png");a.download="design.png";a.click();}return;
    }
    if(kind==="pdf"){
      const {jsPDF}=await import("jspdf");
      const pdf=new jsPDF(); pdf.setFontSize(20);pdf.text("CADVoice Design",20,25);pdf.setFontSize(11);
      pdf.text(`Objects: ${scene.length}`,20,38); pdf.text(`Mode: ${mode}`,20,46);
      scene.forEach((o,i)=>{
        const index=i%24;
        if(i>0&&index===0)pdf.addPage();
        const y=(index===0&&i>0?18:58)+index*9;
        const line=pdf.splitTextToSize(`${o.name} | ${o.type} | ${o.size.map(v=>Math.round(v*1000)).join(" × ")} mm | ${o.material}`,170);
        pdf.text(line,20,y);
      });
      pdf.save("design.pdf");return;
    }
    if(kind==="ecad-json"){downloadText(JSON.stringify({format:"CADVoice-ECAD",version:1,board:scene.find(o=>["pcb","arduino"].includes(o.type))||null,components:scene.filter(o=>["resistor","led","mcu"].includes(o.type)),connections:[]},null,2),"ecad.json","application/json");}
  };
  const runExport=kind=>exportFile(kind).catch(error=>setStatus(`Export failed: ${error.message}`));

  useEffect(()=>{
    if(scriptLang==="openscad")setScript(sceneToOpenSCAD(scene));
    if(scriptLang==="cadquery")setScript(sceneToCadQuery(scene));
    if(scriptLang==="openjscad")setScript(sceneToOpenJSCAD(scene));
    if(scriptLang==="autolisp")setScript("; CADVoice AutoLISP export placeholder\n; Use the scene dimensions/coordinates below as input for AutoCAD automation.\n"+scene.map(o=>`; ${o.name}: ${o.size.map(v=>Math.round(v*1000)).join(" x ")} mm @ ${o.position.map(v=>Math.round(v*1000)).join(", ")} mm`).join("\n"));
  },[scene,scriptLang]);

  const clear=()=>{changeScene([]);setSelected(null);setStatus("New empty scene.");};

  useEffect(()=>{
    if(new URLSearchParams(window.location.search).get("example")==="arduino")loadSample();
  },[]);

  return <div className="app">
    <header className="topbar">
      <div className="brand"><span className="logo">⌁</span><div><b>CADVoice</b><small>Spatial CAD / ECAD</small></div></div>
      <div className="top-actions">
        <button onClick={clear}>New</button>
        <button onClick={loadSample}>Example</button>
        <label className="button">Open<input type="file" accept=".cadvoice,.json" hidden onChange={openProject}/></label>
        <button onClick={saveProject}>Save</button>
        <div className="export-wrap"><button className="primary" onClick={()=>setExportOpen(v=>!v)}>Export ▾</button>{exportOpen&&<div className="export-menu">
          <strong>CAD / 3D</strong><button onClick={()=>runExport("stl")}>STL — 3D printing</button><button onClick={()=>runExport("obj")}>OBJ — 3D model</button><button onClick={()=>runExport("glb")}>GLB — web/3D</button>
          <strong>Code</strong><button onClick={()=>runExport("openscad")}>OpenSCAD (.scad)</button><button onClick={()=>runExport("cadquery")}>Python / CadQuery (.py)</button><button onClick={()=>runExport("openjscad")}>OpenJSCAD (.js)</button><button onClick={()=>runExport("autolisp")}>AutoLISP notes (.lsp)</button>
          <strong>Document</strong><button onClick={()=>runExport("pdf")}>PDF — design summary</button><button onClick={()=>runExport("png")}>PNG — canvas</button>
          <strong>ECAD / Project</strong><button onClick={()=>runExport("ecad-json")}>ECAD JSON</button><button onClick={()=>runExport("bom")}>BOM CSV</button><button onClick={()=>runExport("json")}>CADVoice project</button>
        </div>}</div>
      </div>
    </header>

    <div className="modebar"><div className="mode-switch"><button className={mode==="CAD"?"active":""} onClick={()=>setMode("CAD")}>📐 CAD</button><button className={mode==="ECAD"?"active":""} onClick={()=>setMode("ECAD")}>⚡ ECAD</button></div><span className="status" role="status" aria-live="polite">{status}</span></div>

    <main className="workspace">
      <aside className="left-panel">
        <h3>Tools</h3>
        <button onClick={undoScene} aria-label="Undo the last scene change">↶ Undo</button>
        <button onClick={redoScene} aria-label="Redo the last scene change">↷ Redo</button>
        <button onClick={()=>{const o=makeObject("cube");o.position[2]=o.size[2]/2;changeScene(s=>[...s,o]);setSelected(o.id)}}>＋ Cube</button>
        <button onClick={()=>{const o=makeObject("cylinder");o.position[2]=o.size[2]/2;changeScene(s=>[...s,o]);setSelected(o.id)}}>＋ Cylinder</button>
        <button onClick={()=>{const o=makeObject("sphere");o.position[2]=o.size[2]/2;changeScene(s=>[...s,o]);setSelected(o.id)}}>＋ Sphere</button>
        <hr/>
        <h3>Presets</h3>
        {["laptop","table","chair","desk","lamp","wall"].map(t=><button key={t} onClick={()=>{const o=makeObject(t);o.position=[scene.length*.9,0,o.size[2]/2];changeScene(s=>[...s,o]);setSelected(o.id)}}>＋ {t[0].toUpperCase()+t.slice(1)}</button>)}
        {mode==="ECAD"&&<><hr/><h3>ECAD</h3>{["arduino","pcb","mcu","resistor","led"].map(t=><button key={t} onClick={()=>{const o=makeObject(t);o.position=[scene.length*.12,0,o.size[2]/2];changeScene(s=>[...s,o]);setSelected(o.id)}}>＋ {t==="arduino"?"Arduino UNO R3":t.toUpperCase()}</button>)}</>}
        <hr/>
        <h3>Objects ({scene.length})</h3>
        <div className="object-list">{scene.map(o=><button className={selected===o.id?"selected":""} key={o.id} onClick={()=>setSelected(o.id)}>{o.name}</button>)}</div>
      </aside>

      <section className="center">
        <div className="viewport" ref={canvasRef}></div>
        <div className="promptbar">
          <textarea aria-label="Natural-language design command" value={prompt} onChange={e=>setPrompt(e.target.value)} onKeyDown={e=>{if(e.key==="Enter"&&!e.shiftKey){e.preventDefault();runPrompt()}}} placeholder='Try: "Create a wooden chair 60 cm wide next to the table."'></textarea>
          <button className="voice" aria-label="Dictate a command" title="Dictate a command" onClick={startVoice}>🎙️</button>
          <button className="generate" onClick={runPrompt}>Generate</button>
        </div>
        <div className="tabs"><button className={tab==="visual"?"active":""} onClick={()=>setTab("visual")}>Visual</button><button className={tab==="ai"?"active":""} onClick={()=>setTab("ai")}>AI</button><button className={tab==="script"?"active":""} onClick={()=>setTab("script")}>Script</button></div>
        {tab==="ai"&&<div className="info-panel"><b>On-device NLP intent model</b><p>A compact Naive Bayes model classifies supported command types locally; rule-based parsing extracts sizes, materials, colors, and spatial relations. No account, API key, or hosted model is used.</p><p>Try: “Create a metal lamp on the table,” “Make the table 140 cm wide,” “Duplicate the chair,” or “Show top view.”</p><p className="hint">This focused model is trained from the included CSV examples; it is not a general-purpose LLM.</p></div>}
        {tab==="script"&&<div className="script-panel"><div className="script-toolbar"><select value={scriptLang} onChange={e=>setScriptLang(e.target.value)}><option value="openscad">OpenSCAD</option><option value="cadquery">Python / CadQuery</option><option value="openjscad">OpenJSCAD</option><option value="autolisp">AutoLISP</option></select><button onClick={()=>downloadText(script,scriptLang==="cadquery"?"design.py":scriptLang==="openscad"?"design.scad":scriptLang==="openjscad"?"design.js":"design.lsp")}>Download code</button></div><textarea value={script} onChange={e=>setScript(e.target.value)} spellCheck={false}/><p className="hint">This prototype generates portable source code. It does not execute arbitrary scripts in the browser.</p></div>}
      </section>

      <aside className="right-panel">
        <h3>Properties</h3>
        {selectedObj?<div className="properties">
          <label>Name<input value={selectedObj.name} onChange={e=>updateSelected({name:e.target.value})}/></label>
          <label>Type<input value={selectedObj.type} disabled/></label>
          <div className="grid3"><label>W<input type="number" step="0.01" value={(selectedObj.size[0]*1000).toFixed(1)} onChange={e=>updateSelected({size:[Number(e.target.value)/1000,selectedObj.size[1],selectedObj.size[2]]})}/></label><label>D<input type="number" step="0.01" value={(selectedObj.size[1]*1000).toFixed(1)} onChange={e=>updateSelected({size:[selectedObj.size[0],Number(e.target.value)/1000,selectedObj.size[2]]})}/></label><label>H<input type="number" step="0.01" value={(selectedObj.size[2]*1000).toFixed(1)} onChange={e=>updateSelected({size:[selectedObj.size[0],selectedObj.size[1],Number(e.target.value)/1000]})}/></label></div>
          <small>Dimensions in mm</small>
          <label>Material<select value={selectedObj.material} onChange={e=>updateSelected({material:e.target.value,color:defaultColorFor(e.target.value)})}>{Object.keys(MATERIAL_COLORS).map(m=><option key={m}>{m}</option>)}</select></label>
          <label>Color<input type="color" value={selectedObj.color} onChange={e=>updateSelected({color:e.target.value})}/></label>
          {selectedObj.type==="laptop"&&<label>Screen angle (°)<input type="number" min="70" max="170" value={selectedObj.screenAngle??110} onChange={e=>updateSelected({screenAngle:Number(e.target.value)})}/></label>}
          <div className="swatches">{COLORS.map(c=><button key={c} style={{background:c}} onClick={()=>updateSelected({color:c})}/>)}</div>
          <button className="danger" onClick={()=>{changeScene(s=>s.filter(o=>o.id!==selectedObj.id));setSelected(null)}}>Delete object</button>
        </div>:<p className="muted">Select an object to edit dimensions, material and color.</p>}
        <hr/><h3>Spatial scene</h3><div className="scene-stats"><span>Objects <b>{scene.length}</b></span><span>Relations <b>{scene.reduce((a,o)=>a+o.relations.length,0)}</b></span></div>
        <p className="muted">Everything stays in browser memory until you explicitly save/export a file.</p>
      </aside>
    </main>
  </div>
}

createRoot(document.getElementById("root")).render(<App />);
