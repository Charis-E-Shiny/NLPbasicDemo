// Real, openly licensed 3D models (see public/models3d/catalog.json for licences).
// Each model is scaled uniformly to fit inside the object's box, centred on its origin, and
// rotated from glTF Y-up to CADVoice's Z-up scene.
import * as THREE from "three";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import { REAL_MODEL_FOR_TYPE } from "./realModelMap.js";

export { REAL_MODEL_FOR_TYPE };

const templates = new Map();
let loading = null;

export function loadRealModels(base) {
  if (!loading) {
    loading = (async () => {
      const catalog = await (await fetch(base + "catalog.json")).json();
      const loader = new GLTFLoader();
      await Promise.all(catalog.models.map(async (m) => {
        try {
          const gltf = await loader.loadAsync(base + m.file);
          templates.set(m.id, gltf.scene);
        } catch (error) {
          console.warn(`model ${m.id} failed to load: ${error.message}`);
        }
      }));
      return templates.size;
    })();
  }
  return loading;
}

export function hasRealModel(type) {
  const id = REAL_MODEL_FOR_TYPE[type];
  return Boolean(id && templates.get(id));
}

// Returns a Group centred on the origin and sized to obj.size, or null if no real model applies.
export function realAssembly(obj) {
  const id = REAL_MODEL_FOR_TYPE[obj.type];
  const template = id && templates.get(id);
  if (!template) return null;
  const holder = new THREE.Group();
  const inner = template.clone(true);
  inner.traverse((node) => {
    if (node.isMesh) {
      node.material = node.material.clone();
      // boards keep their real PCB/component colours; other parts take the object colour
      if (obj.color && obj.material !== "pcb" && node.material.color) node.material.color.set(obj.color);
    }
  });
  inner.rotation.x = Math.PI / 2; // glTF Y-up -> Z-up
  holder.add(inner);
  holder.updateMatrixWorld(true);
  const box = new THREE.Box3().setFromObject(holder);
  const size = box.getSize(new THREE.Vector3());
  const center = box.getCenter(new THREE.Vector3());
  const [w, d, h] = obj.size;
  const scale = Math.min(
    size.x > 0 ? w / size.x : 1,
    size.y > 0 ? d / size.y : 1,
    size.z > 0 ? h / size.z : 1,
  );
  holder.scale.setScalar(scale);
  holder.position.copy(center).multiplyScalar(-scale);
  return holder;
}
