"""
Exports whatever is in an already-open .blend to GLB.

    blender --background <file.blend> --python blender/xeniur_open.py -- <out.glb>

Blender is running with the file loaded, so this only has to export. Prints one line:
XENIUR_OPEN:{"ok": true, "output": "...", "objects": n}
"""
import json
import os
import sys

import bpy


def main():
    if "--" not in sys.argv:
        raise SystemExit("usage: blender --background <file> --python xeniur_open.py -- <out.glb>")
    out = sys.argv[sys.argv.index("--") + 1]
    os.makedirs(os.path.dirname(out), exist_ok=True)

    meshes = [o for o in bpy.context.scene.objects if o.type == "MESH"]
    if not meshes:
        print("XENIUR_OPEN:" + json.dumps({"ok": False, "output": out, "objects": 0,
                                           "error": "the file contains no mesh"}))
        return

    bpy.ops.export_scene.gltf(filepath=out, export_format="GLB")
    print("XENIUR_OPEN:" + json.dumps({
        "ok": os.path.exists(out), "output": out, "objects": len(meshes),
        "blenderVersion": bpy.app.version_string,
    }))


if __name__ == "__main__":
    main()
