import { loadProvidersConfig } from "./config.js";
/** Test-only generators. Production routes deliberately omit these sample artifacts. */
export function sampleProvidersConfig(root:string) {
  const config=loadProvidersConfig(root);
  for(const id of ["mock.image","mock.mesh","mock.video"])config.providers[id]={enabled:true,kind:"mock",cost:{usd:0}};
  config.capabilities["image"]={order:["mock.image"]};
  config.capabilities["to3D"]={order:["mock.mesh"]};
  config.capabilities["video"]={order:["local.blender","local.ffmpeg","mock.video"]};
  return config;
}
