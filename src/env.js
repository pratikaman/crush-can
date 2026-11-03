import * as THREE from 'three';

// A product-photography studio rendered into a PMREM: tall strip softboxes give
// the long vertical highlights you see on real can shots; the room is tinted
// with the flavour colour so the metal picks up the backdrop.
export function makeStudioEnv(renderer, tintHex) {
  const scene = new THREE.Scene();
  const tint = new THREE.Color(tintHex);
  scene.background = tint.clone().multiplyScalar(0.35);

  const room = new THREE.Mesh(
    new THREE.SphereGeometry(40, 32, 16),
    new THREE.ShaderMaterial({
      side: THREE.BackSide,
      uniforms: { top: { value: tint.clone().multiplyScalar(0.55) }, bottom: { value: tint.clone().multiplyScalar(0.12) } },
      vertexShader: 'varying vec3 vP; void main(){ vP = position; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }',
      fragmentShader: 'uniform vec3 top; uniform vec3 bottom; varying vec3 vP; void main(){ float t = smoothstep(-25.0, 30.0, vP.y); gl_FragColor = vec4(mix(bottom, top, t), 1.0); }',
    }),
  );
  scene.add(room);

  const panel = (w, h, intensity, color, pos, target = new THREE.Vector3(0, 0, 0)) => {
    const m = new THREE.Mesh(
      new THREE.PlaneGeometry(w, h),
      new THREE.MeshBasicMaterial({ color: new THREE.Color(color).multiplyScalar(intensity), side: THREE.DoubleSide }),
    );
    m.position.copy(pos);
    m.lookAt(target);
    scene.add(m);
    return m;
  };
  // key strip, front-left
  panel(1.6, 16, 9, '#fff6ea', new THREE.Vector3(-7, 1, 6.5));
  // fill strip, front-right
  panel(1.0, 16, 4.5, '#ffffff', new THREE.Vector3(7.5, 1, 5));
  // rim strips behind
  panel(2.2, 16, 5, '#ffffff', new THREE.Vector3(8, 1, -6));
  panel(1.2, 16, 3, '#ffffff', new THREE.Vector3(-8.5, 1, -5));
  // overhead softbox
  panel(9, 9, 2.4, '#ffffff', new THREE.Vector3(0, 12, 0));
  // coloured bounce from the floor / backdrop
  panel(30, 30, 0.7, tint.clone().lerp(new THREE.Color('#ffffff'), 0.15), new THREE.Vector3(0, -9, 0));
  panel(18, 10, 0.9, tint.clone().lerp(new THREE.Color('#ffffff'), 0.25), new THREE.Vector3(0, 0, 14));

  const pmrem = new THREE.PMREMGenerator(renderer);
  const rt = pmrem.fromScene(scene, 0.0, 0.1, 100);
  pmrem.dispose();
  scene.traverse((o) => { if (o.geometry) o.geometry.dispose(); if (o.material) o.material.dispose(); });
  return rt.texture;
}
