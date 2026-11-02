#!/usr/bin/env python3
"""Build the bundled real-world 3D model library.

Downloads openly licensed STEP / STL / GLB sources listed in ``models.config.json``,
normalises them (metres, glTF Y-up, centred on X/Z, resting on y = 0, longest
horizontal side along X where requested), names recolourable parts, shrinks
textures and writes:

    public/models3d/<id>.glb
    public/models3d/catalog.json

Usage:
    pip install -r tools/requirements.txt
    python tools/build_models.py            # all models
    python tools/build_models.py arduino_uno chair_simple
"""
from __future__ import annotations

import json
import sys
import tempfile
import urllib.request
from pathlib import Path

import numpy as np
import trimesh
from trimesh.visual.material import PBRMaterial

ROOT = Path(__file__).resolve().parent.parent
CACHE = ROOT / "tools" / ".cache"
OUT = ROOT / "public" / "models3d"
CONFIG = ROOT / "tools" / "models.config.json"

# (x, y, z) -> (x, z, -y): converts a Z-up source into glTF's Y-up convention.
Z_UP_TO_Y_UP = np.array(
    [[1, 0, 0, 0], [0, 0, 1, 0], [0, -1, 0, 0], [0, 0, 0, 1]], dtype=float
)
METAL_HINTS = ("pin", "lead", "leg", "metal", "chapa", "usb", "xtal", "crystal")


def fetch(url: str) -> Path:
    CACHE.mkdir(parents=True, exist_ok=True)
    dest = CACHE / url.rsplit("/", 1)[-1].replace("%20", "_")
    if not dest.exists():
        print(f"  downloading {url}")
        req = urllib.request.Request(url, headers={"User-Agent": "cadvoice-build/1.0"})
        with urllib.request.urlopen(req, timeout=180) as r:
            dest.write_bytes(r.read())
    return dest


def load_geometries(cfg: dict, path: Path) -> list[tuple[str, trimesh.Trimesh]]:
    """Return a flat list of (name, mesh) with all node transforms baked in (metres)."""
    suffix = path.suffix.lower()
    if suffix in (".step", ".stp"):
        import cascadio  # OpenCascade bindings

        tmp = Path(tempfile.mkdtemp()) / "converted.glb"
        cascadio.step_to_glb(str(path), str(tmp), 0.05, 0.3)
        scene = trimesh.load(str(tmp))
    elif suffix == ".stl":
        mesh = trimesh.load(str(path), force="mesh")
        if cfg.get("scale_unit", "m") == "mm":
            mesh.apply_scale(0.001)
        scene = trimesh.Scene({"body": mesh})
    else:
        scene = trimesh.load(str(path))

    out: list[tuple[str, trimesh.Trimesh]] = []
    for node in scene.graph.nodes_geometry:
        transform, gname = scene.graph[node]
        geom = scene.geometry[gname]
        if not isinstance(geom, trimesh.Trimesh) or len(geom.faces) == 0:
            continue  # skip sketch paths / empty geometry
        geom = geom.copy()
        geom.apply_transform(transform)
        out.append((gname, geom))
    return out


def shrink_textures(material, max_px: int) -> None:
    for attr in (
        "baseColorTexture",
        "normalTexture",
        "metallicRoughnessTexture",
        "occlusionTexture",
        "emissiveTexture",
    ):
        img = getattr(material, attr, None)
        if img is not None and max(img.size) > max_px:
            img = img.copy()
            img.thumbnail((max_px, max_px))
            setattr(material, attr, img)


def hex_to_rgba(h: str) -> list[int]:
    h = h.lstrip("#")
    return [int(h[i : i + 2], 16) for i in (0, 2, 4)] + [255]


def build(cfg: dict) -> dict:
    print(f"* {cfg['id']}")
    path = fetch(cfg["src"])
    parts = load_geometries(cfg, path)
    if not parts:
        raise RuntimeError(f"{cfg['id']}: no mesh geometry found")

    rot = np.eye(4) if cfg.get("up", "z") == "y" else Z_UP_TO_Y_UP
    for _, g in parts:
        g.apply_transform(rot)

    # Optionally lay the longest horizontal side along X (boards, chips, ...).
    allv = np.vstack([g.vertices for _, g in parts])
    ext = allv.max(0) - allv.min(0)
    if cfg.get("align", True) and ext[2] > ext[0] * 1.05:
        r90 = trimesh.transformations.rotation_matrix(np.pi / 2, [0, 1, 0])
        for _, g in parts:
            g.apply_transform(r90)
        allv = np.vstack([g.vertices for _, g in parts])
    if cfg.get("yaw"):
        ry = trimesh.transformations.rotation_matrix(np.radians(cfg["yaw"]), [0, 1, 0])
        for _, g in parts:
            g.apply_transform(ry)
        allv = np.vstack([g.vertices for _, g in parts])

    lo, hi = allv.min(0), allv.max(0)
    shift = np.array([-(lo[0] + hi[0]) / 2, -lo[1], -(lo[2] + hi[2]) / 2])
    for _, g in parts:
        g.apply_translation(shift)
    size = hi - lo  # x = width, y = height, z = depth (glTF space)

    rename = cfg.get("rename", {})
    scene = trimesh.Scene()
    names: list[str] = []
    for i, (gname, g) in enumerate(parts):
        name = rename.get(gname, gname)
        if name in names:
            name = f"{name}_{i}"
        names.append(name)
        mat = getattr(g.visual, "material", None)
        textured = isinstance(mat, PBRMaterial) and getattr(mat, "baseColorTexture", None) is not None
        if textured:
            shrink_textures(mat, int(cfg.get("texture_max", 512)))
        else:
            base = (
                list(map(int, mat.baseColorFactor[:4]))
                if isinstance(mat, PBRMaterial) and mat.baseColorFactor is not None
                else [150, 150, 150, 255]
            )
            if cfg.get("tint") and len(parts) == 1:
                base = hex_to_rgba(cfg["tint"])
            is_metal = any(h in name.lower() for h in METAL_HINTS) or cfg.get("material") == "metal"
            g.visual = trimesh.visual.TextureVisuals(
                material=PBRMaterial(
                    name=name,
                    baseColorFactor=base,
                    metallicFactor=0.85 if is_metal else 0.05,
                    roughnessFactor=0.35 if is_metal else 0.6,
                    doubleSided=True,
                )
            )
        g.merge_vertices()
        scene.add_geometry(g, node_name=name, geom_name=name)

    OUT.mkdir(parents=True, exist_ok=True)
    data = scene.export(file_type="glb")
    (OUT / f"{cfg['id']}.glb").write_bytes(data)
    tris = int(sum(len(g.faces) for _, g in parts))
    print(f"  -> {cfg['id']}.glb  {len(data)/1e6:.2f} MB  {tris} tris  size(mm)={np.round(size*1000,1).tolist()}")
    return {
        "id": cfg["id"],
        "name": cfg["name"],
        "type": cfg["type"],
        "category": cfg["category"],
        "file": f"{cfg['id']}.glb",
        "size": [round(float(size[0]), 5), round(float(size[2]), 5), round(float(size[1]), 5)],  # W, D, H
        "material": cfg.get("material", "default"),
        "parts": names,
        "triangles": tris,
        "bytes": len(data),
        "license": cfg["license"],
        "author": cfg["author"],
        "source": cfg["page"],
    }


def main(argv: list[str]) -> int:
    cfgs = json.loads(CONFIG.read_text())["models"]
    wanted = set(argv)
    catalog_path = OUT / "catalog.json"
    existing = {}
    if wanted and catalog_path.exists():
        existing = {m["id"]: m for m in json.loads(catalog_path.read_text())["models"]}
    entries = []
    for cfg in cfgs:
        if wanted and cfg["id"] not in wanted:
            if cfg["id"] in existing:
                entries.append(existing[cfg["id"]])
            continue
        entries.append(build(cfg))
    OUT.mkdir(parents=True, exist_ok=True)
    catalog_path.write_text(json.dumps({"version": 1, "models": entries}, indent=2) + "\n")
    print(f"catalog.json written with {len(entries)} models")
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
