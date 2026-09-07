"""
XENIUR headless Blender worker.

Runs as:  blender --background --python blender/xeniur_worker.py -- <job.json>

Deterministic geometry work belongs here rather than at a cloud 3D API: scaling,
cleanup, modifiers, materials, camera setup and GLB/STL export are all things a local
Blender does exactly and for free. A generative 3D provider should only ever be asked
to imagine geometry that does not exist yet.

The job file is JSON: {"op": ..., "output": "/path/out.glb", ...}. Results are printed
as a single line prefixed XENIUR_RESULT: so the caller can parse it out of Blender's
very chatty stdout.
"""
import json
import math
import sys
import os

import bpy


def argv_job():
    if "--" not in sys.argv:
        raise SystemExit("usage: blender --background --python xeniur_worker.py -- <job.json>")
    path = sys.argv[sys.argv.index("--") + 1]
    with open(path) as fh:
        return json.load(fh)


def reset_scene():
    bpy.ops.wm.read_factory_settings(use_empty=True)


def import_any(path):
    ext = os.path.splitext(path)[1].lower()
    if ext == ".glb" or ext == ".gltf":
        bpy.ops.import_scene.gltf(filepath=path)
    elif ext == ".stl":
        # Blender 4.2+ ships a new STL importer; fall back to the legacy operator.
        if hasattr(bpy.ops.wm, "stl_import"):
            bpy.ops.wm.stl_import(filepath=path)
        else:
            bpy.ops.import_mesh.stl(filepath=path)
    elif ext == ".obj":
        bpy.ops.wm.obj_import(filepath=path)
    else:
        raise SystemExit(f"unsupported input format: {ext}")
    return [o for o in bpy.context.scene.objects if o.type == "MESH"]


def export_any(path):
    ext = os.path.splitext(path)[1].lower()
    os.makedirs(os.path.dirname(path), exist_ok=True)
    if ext == ".glb":
        bpy.ops.export_scene.gltf(filepath=path, export_format="GLB")
    elif ext == ".gltf":
        bpy.ops.export_scene.gltf(filepath=path, export_format="GLTF_SEPARATE")
    elif ext == ".stl":
        # STL carries geometry only, which is exactly what a slicer wants.
        if hasattr(bpy.ops.wm, "stl_export"):
            bpy.ops.wm.stl_export(filepath=path)
        else:
            bpy.ops.export_mesh.stl(filepath=path)
    else:
        raise SystemExit(f"unsupported output format: {ext}")


def select_only(objs):
    bpy.ops.object.select_all(action="DESELECT")
    for o in objs:
        o.select_set(True)
    if objs:
        bpy.context.view_layer.objects.active = objs[0]


def join_meshes(name):
    meshes = [o for o in bpy.context.scene.objects if o.type == "MESH"]
    if len(meshes) > 1:
        select_only(meshes)
        bpy.ops.object.join()
    obj = bpy.context.view_layer.objects.active or (meshes[0] if meshes else None)
    if obj is not None:
        obj.name = name
    return obj


def build_rocket(params):
    """
    A procedural stand-in for generated geometry: body, nose cone and fins.

    This is what the mock 3D provider produces, so the viewport and the STL export are
    exercising a real mesh rather than a placeholder file. It is deterministic and
    obviously synthetic — it is never passed off as model output.
    """
    body_r = float(params.get("bodyRadius", 0.5))
    body_h = float(params.get("bodyHeight", 2.4))
    fin_count = int(params.get("fins", 4))
    fin_span = float(params.get("finSpan", 0.7))

    bpy.ops.mesh.primitive_cylinder_add(radius=body_r, depth=body_h, vertices=48, location=(0, 0, 0))
    body = bpy.context.active_object
    body.name = "body"

    bpy.ops.mesh.primitive_cone_add(
        radius1=body_r, radius2=0.0, depth=body_h * 0.45, vertices=48,
        location=(0, 0, body_h / 2 + body_h * 0.225),
    )
    bpy.context.active_object.name = "nose"

    for i in range(max(0, fin_count)):
        angle = (2 * math.pi / max(1, fin_count)) * i
        bpy.ops.mesh.primitive_cube_add(size=1.0, location=(
            math.cos(angle) * (body_r + fin_span / 2),
            math.sin(angle) * (body_r + fin_span / 2),
            -body_h / 2 + 0.3,
        ))
        fin = bpy.context.active_object
        fin.name = f"fin_{i}"
        fin.scale = (fin_span, 0.06, 0.6)
        fin.rotation_euler = (0, 0, angle)

    obj = join_meshes(params.get("name", "rocket"))
    bpy.ops.object.transform_apply(location=False, rotation=True, scale=True)
    return obj


def apply_material(obj, params):
    colour = params.get("color")
    if not obj or not colour:
        return
    mat = bpy.data.materials.new(name="xeniur_material")
    mat.use_nodes = True
    bsdf = mat.node_tree.nodes.get("Principled BSDF")
    if bsdf:
        r, g, b = (float(c) for c in colour[:3])
        bsdf.inputs["Base Color"].default_value = (r, g, b, 1.0)
        if "metallic" in params:
            bsdf.inputs["Metallic"].default_value = float(params["metallic"])
        if "roughness" in params:
            bsdf.inputs["Roughness"].default_value = float(params["roughness"])
    obj.data.materials.clear()
    obj.data.materials.append(mat)


def process(obj, params):
    """Deterministic cleanup: merge doubles, recalc normals, optional scale and smoothing."""
    if obj is None:
        return
    select_only([obj])

    bpy.ops.object.mode_set(mode="EDIT")
    bpy.ops.mesh.select_all(action="SELECT")
    bpy.ops.mesh.remove_doubles(threshold=float(params.get("mergeDistance", 0.0001)))
    bpy.ops.mesh.normals_make_consistent(inside=False)
    bpy.ops.object.mode_set(mode="OBJECT")

    if params.get("shadeSmooth"):
        bpy.ops.object.shade_smooth()

    scale = params.get("scale")
    if scale:
        s = float(scale)
        obj.scale = (s, s, s)
        bpy.ops.object.transform_apply(location=False, rotation=False, scale=True)

    target = params.get("targetHeight")
    if target:
        current = max(obj.dimensions.z, 1e-6)
        factor = float(target) / current
        obj.scale = (factor, factor, factor)
        bpy.ops.object.transform_apply(location=False, rotation=False, scale=True)

    if params.get("centerOrigin", True):
        bpy.ops.object.origin_set(type="ORIGIN_GEOMETRY", center="BOUNDS")
        obj.location = (0, 0, 0)


def stats(obj):
    if obj is None:
        return {"vertices": 0, "polygons": 0, "dimensions": [0, 0, 0]}
    return {
        "vertices": len(obj.data.vertices),
        "polygons": len(obj.data.polygons),
        "dimensions": [round(d, 6) for d in obj.dimensions],
    }


def camera_rig(obj, params):
    """Frames the object and lights it. Deterministic, so a rebuild renders identically."""
    import mathutils

    size = max(obj.dimensions) or 1.0
    distance = size * float(params.get("cameraDistance", 2.6))

    bpy.ops.object.camera_add(location=(distance * 0.75, -distance, distance * 0.55))
    cam = bpy.context.active_object
    bpy.context.scene.camera = cam
    direction = obj.location - cam.location
    cam.rotation_euler = direction.to_track_quat("-Z", "Y").to_euler()

    bpy.ops.object.light_add(type="SUN", location=(distance, -distance, distance * 1.6))
    bpy.context.active_object.data.energy = float(params.get("keyLight", 4.0))
    bpy.ops.object.light_add(type="AREA", location=(-distance, distance * 0.4, distance * 0.6))
    bpy.context.active_object.data.energy = float(params.get("fillLight", 120.0))

    world = bpy.data.worlds.new("xeniur")
    bpy.context.scene.world = world
    world.use_nodes = True
    bg = world.node_tree.nodes.get("Background")
    if bg:
        bg.inputs[0].default_value = (0.05, 0.055, 0.07, 1.0)
    return cam


def setup_render(params):
    s = bpy.context.scene
    s.render.resolution_x = int(params.get("width", 1024))
    s.render.resolution_y = int(params.get("height", 1024))
    s.render.image_settings.file_format = "PNG"
    s.render.film_transparent = bool(params.get("transparent", False))
    # EEVEE renders headlessly here and is far faster than Cycles for a preview.
    engine = params.get("engine", "BLENDER_EEVEE")
    available = bpy.types.RenderSettings.bl_rna.properties["engine"].enum_items.keys()
    s.render.engine = engine if engine in available else "BLENDER_WORKBENCH"
    return s


def render_still(obj, params, output):
    scene = setup_render(params)
    camera_rig(obj, params)
    scene.render.filepath = output
    bpy.ops.render.render(write_still=True)
    return {"engine": scene.render.engine}


def render_turntable(obj, params, out_dir):
    """One full revolution, as numbered frames. FFmpeg assembles them afterwards."""
    import math

    frames = int(params.get("frames", 36))
    scene = setup_render(params)
    cam = camera_rig(obj, params)

    pivot = bpy.data.objects.new("turntable_pivot", None)
    bpy.context.collection.objects.link(pivot)
    pivot.location = obj.location
    cam.parent = pivot

    os.makedirs(out_dir, exist_ok=True)
    for i in range(frames):
        pivot.rotation_euler = (0, 0, (2 * math.pi / frames) * i)
        bpy.context.view_layer.update()
        scene.render.filepath = os.path.join(out_dir, "frame_%04d" % i)
        bpy.ops.render.render(write_still=True)
    return {"frames": frames, "engine": scene.render.engine, "dir": out_dir}


def solidify(obj, params):
    """
    Turns a set of overlapping parts into one printable solid.

    Merging vertices and filling boundary loops is not enough when parts intersect: a fin
    pushed through a body leaves interior surfaces that are perfectly closed and still
    unprintable. A voxel remesh rebuilds the surface from the volume, which is what
    actually yields a watertight manifold — the thing a slicer needs.
    """
    select_only([obj])

    size = max(obj.dimensions) or 1.0
    voxel = float(params.get("voxelSize", size / float(params.get("voxelDetail", 180))))

    remesh = obj.modifiers.new(name="xeniur_solidify", type="REMESH")
    remesh.mode = "VOXEL"
    remesh.voxel_size = max(voxel, 1e-5)
    remesh.use_smooth_shade = bool(params.get("shadeSmooth", False))
    bpy.ops.object.modifier_apply(modifier=remesh.name)

    bpy.ops.object.mode_set(mode="EDIT")
    bpy.ops.mesh.select_all(action="SELECT")
    bpy.ops.mesh.remove_doubles(threshold=float(params.get("mergeDistance", 0.0005)))
    bpy.ops.mesh.normals_make_consistent(inside=False)
    bpy.ops.object.mode_set(mode="OBJECT")


def main():
    job = argv_job()
    op = job.get("op")
    params = job.get("params", {})
    output = job["output"]

    reset_scene()

    if op == "generate_mesh":
        obj = build_rocket(params)
    elif op in ("process", "export", "render", "turntable", "solidify"):
        import_any(job["input"])
        obj = join_meshes(params.get("name", "object"))
    else:
        raise SystemExit("unknown op: %s" % op)

    extra = {}
    if op == "solidify":
        solidify(obj, params)
        process(obj, params)
        apply_material(obj, params)
        export_any(output)
    elif op == "render":
        extra = render_still(obj, params, output)
    elif op == "turntable":
        extra = render_turntable(obj, params, output)
    else:
        if op in ("generate_mesh", "process"):
            process(obj, params)
            apply_material(obj, params)
        export_any(output)

    result = {"ok": True, "op": op, "output": output,
              "blenderVersion": bpy.app.version_string, **stats(obj), **extra}
    print("XENIUR_RESULT:" + json.dumps(result))


if __name__ == "__main__":
    main()
