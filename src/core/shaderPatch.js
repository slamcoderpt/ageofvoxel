// Composable onBeforeCompile patches. Several pieces may want to patch the
// same material (fog of war, team colour, hit flash, ...); this keeps them
// from overwriting each other.
//
//   addShaderPatch(material, 'fow', (shader) => { ... })

export function addShaderPatch(material, key, fn) {
  if (!material.userData.patches) {
    material.userData.patches = new Map();
    material.onBeforeCompile = (shader, renderer) => {
      for (const p of material.userData.patches.values()) p(shader, renderer);
    };
    material.customProgramCacheKey = () => [...material.userData.patches.keys()].join('|');
  }
  material.userData.patches.set(key, fn);
  material.needsUpdate = true;
  return material;
}

// Helpers for common injection points.
export function injectVertex(shader, after, code) {
  shader.vertexShader = shader.vertexShader.replace(after, `${after}\n${code}`);
}
export function injectFragment(shader, after, code) {
  shader.fragmentShader = shader.fragmentShader.replace(after, `${after}\n${code}`);
}
export function prependVertex(shader, code) { shader.vertexShader = `${code}\n${shader.vertexShader}`; }
export function prependFragment(shader, code) { shader.fragmentShader = `${code}\n${shader.fragmentShader}`; }
