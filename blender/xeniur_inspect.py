"""
XENIUR mesh inspection.

    blender --background --python blender/xeniur_inspect.py -- <mesh file>

Measures everything the mesh validators could ask about in one pass, because starting
Blender costs far more than any individual measurement. Reports numbers only — whether
50,000 polygons is too many is a readiness profile's decision, not this script's.

Prints one line: XENIUR_INSPECT:{...}
"""
import json
import os
import sys

import bpy
import bmesh


def argv_path():
    if "--" not in sys.argv:
        raise SystemExit("usage: blender --background --python xeniur_inspect.py -- <mesh>")
    return sys.argv[sys.argv.index("--") + 1]


def import_any(path):
    ext = os.path.splitext(path)[1].lower()
    if ext in (".glb", ".gltf"):
        bpy.ops.import_scene.gltf(filepath=path)
    elif ext == ".stl":
        if hasattr(bpy.ops.wm, "stl_import"):
            bpy.ops.wm.stl_import(filepath=path)
        else:
            bpy.ops.import_mesh.stl(filepath=path)
    elif ext == ".obj":
        bpy.ops.wm.obj_import(filepath=path)
    else:
        raise SystemExit("unsupported format: %s" % ext)


def joined_mesh():
    meshes = [o for o in bpy.context.scene.objects if o.type == "MESH"]
    if not meshes:
        return None
    if len(meshes) > 1:
        bpy.ops.object.select_all(action="DESELECT")
        for o in meshes:
            o.select_set(True)
        bpy.context.view_layer.objects.active = meshes[0]
        bpy.ops.object.join()
    return bpy.context.view_layer.objects.active or meshes[0]


def measure(obj):
    bm = bmesh.new()
    bm.from_mesh(obj.data)

    # An edge joined by exactly one face is a boundary (a hole); more than two is
    # non-manifold. Both matter, and they are different problems.
    boundary = sum(1 for e in bm.edges if len(e.link_faces) == 1)
    non_manifold = sum(1 for e in bm.edges if len(e.link_faces) > 2)
    ngons = sum(1 for f in bm.faces if len(f.verts) > 4)
    triangles = sum(len(f.verts) - 2 for f in bm.faces)

    try:
        volume = bm.calc_volume(signed=False)
    except Exception:
        volume = 0.0

    report = {
        "vertices": len(bm.verts),
        "polygons": len(bm.faces),
        "triangles": triangles,
        "nonManifoldEdges": non_manifold,
        "boundaryEdges": boundary,
        "ngons": ngons,
        "dimensions": [round(d, 6) for d in obj.dimensions],
        "volume": round(volume, 6),
    }
    bm.free()
    return report


def main():
    path = argv_path()
    bpy.ops.wm.read_factory_settings(use_empty=True)
    import_any(path)

    obj = joined_mesh()
    if obj is None:
        print("XENIUR_INSPECT:" + json.dumps({
            "vertices": 0, "polygons": 0, "triangles": 0, "nonManifoldEdges": 0,
            "boundaryEdges": 0, "ngons": 0, "dimensions": [0, 0, 0], "volume": 0.0,
        }))
        return

    print("XENIUR_INSPECT:" + json.dumps(measure(obj)))


if __name__ == "__main__":
    main()
