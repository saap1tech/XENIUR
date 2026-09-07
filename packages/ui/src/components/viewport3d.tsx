import { Suspense, useEffect, useState } from "react";
import type { LeafSceneNode } from "@xeniur/core";
import type { SceneBindings } from "../bindings.js";

type Node = Extract<LeafSceneNode, { component: "Viewport3D" }>;

/**
 * Meshes are displayed locally with Three.js — there is no reason to pay a cloud service
 * to look at a model you already have.
 *
 * The WebGL canvas is mounted in an effect so the component is safe to render on the
 * server and in tests, where it produces its wrapper and nothing else.
 */
export function Viewport3D({ node, bindings }: { node: Node; bindings: SceneBindings }) {
  const [mounted, setMounted] = useState(false);
  useEffect(() => { setMounted(true); }, []);

  const rep = bindings.representations[node.representationId];
  const src = rep?.blobHash ? bindings.blobUrl(rep.blobHash) : null;

  return (
    <div className="xr-viewport" style={{ background: node.background }} data-representation={node.representationId}>
      {mounted && src
        ? <Suspense fallback={<div className="xr-viewport__loading">Loading mesh…</div>}>
            <MeshCanvas src={src} />
          </Suspense>
        : <div className="xr-viewport__placeholder">{rep ? rep.format.toUpperCase() : "no mesh"}</div>}
    </div>
  );
}

/** Split out so the Three.js runtime is only reached once the component is really live. */
function MeshCanvas({ src }: { src: string }) {
  const [Impl, setImpl] = useState<null | ((p: { src: string }) => JSX.Element)>(null);
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const [{ Canvas }, three, loaderMod] = await Promise.all([
        import("@react-three/fiber"),
        import("three"),
        import("three/examples/jsm/loaders/GLTFLoader.js"),
      ]);
      if (cancelled) return;
      const Component = ({ src: url }: { src: string }) => {
        const [scene, setScene] = useState<import("three").Group | null>(null);
        useEffect(() => {
          const loader = new loaderMod.GLTFLoader();
          loader.load(url, (gltf) => setScene(gltf.scene), undefined, () => setScene(null));
        }, [url]);
        return (
          <Canvas camera={{ position: [4, 3, 5], fov: 45 }}>
            <ambientLight intensity={0.7} />
            <directionalLight position={[5, 8, 5]} intensity={1.1} />
            <gridHelper args={[10, 10, 0x333333, 0x222222]} />
            {scene && <primitive object={scene} />}
            <axesHelper args={[Math.max(1, new three.Vector3().length() || 1)]} />
          </Canvas>
        );
      };
      setImpl(() => Component);
    })();
    return () => { cancelled = true; };
  }, []);
  return Impl ? <Impl src={src} /> : <div className="xr-viewport__loading">Preparing viewport…</div>;
}
