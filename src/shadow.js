import * as THREE from 'three';
import { HorizontalBlurShader } from 'three/examples/jsm/shaders/HorizontalBlurShader.js';
import { VerticalBlurShader } from 'three/examples/jsm/shaders/VerticalBlurShader.js';

// Contact shadow (after three.js webgl_shadow_contact): render the scene's depth
// from below into a texture, blur it, lay it on the floor. Works on a transparent
// canvas, so the CSS backdrop shows through and gets darkened.
export class ContactShadow {
  constructor(renderer, { size = 22, res = 512, height = 14, darkness = 1.6, blur = 2.6, opacity = 0.9 } = {}) {
    this.renderer = renderer;
    this.blurAmount = blur;
    this.group = new THREE.Group();
    this.rt = new THREE.WebGLRenderTarget(res, res);
    this.rt.texture.generateMipmaps = false;
    this.rtBlur = new THREE.WebGLRenderTarget(res, res);
    this.rtBlur.texture.generateMipmaps = false;

    const planeGeo = new THREE.PlaneGeometry(size, size).rotateX(Math.PI / 2);
    this.material = new THREE.MeshBasicMaterial({ map: this.rt.texture, transparent: true, depthWrite: false, opacity });
    this.color = new THREE.Color('#000000');
    this.material.onBeforeCompile = (sh) => {
      sh.uniforms.shadowColor = { value: this.color };
      sh.fragmentShader = 'uniform vec3 shadowColor;\n' + sh.fragmentShader.replace(
        '#include <map_fragment>',
        '#include <map_fragment>\n diffuseColor = vec4(shadowColor, diffuseColor.a * opacity);',
      );
    };
    this.plane = new THREE.Mesh(planeGeo, this.material);
    this.plane.renderOrder = 1;
    this.plane.scale.y = -1;
    this.group.add(this.plane);

    this.blurPlane = new THREE.Mesh(planeGeo);
    this.blurPlane.visible = false;
    this.group.add(this.blurPlane);

    this.camera = new THREE.OrthographicCamera(-size / 2, size / 2, size / 2, -size / 2, 0, height);
    this.camera.rotation.x = Math.PI / 2;
    this.group.add(this.camera);

    this.depthMaterial = new THREE.MeshDepthMaterial();
    this.depthMaterial.userData.darkness = { value: darkness };
    this.depthMaterial.onBeforeCompile = (sh) => {
      sh.uniforms.darkness = this.depthMaterial.userData.darkness;
      sh.fragmentShader = 'uniform float darkness;\n' + sh.fragmentShader.replace(
        'gl_FragColor = vec4( vec3( 1.0 - fragCoordZ ), opacity );',
        'gl_FragColor = vec4( vec3( 0.0 ), pow(1.0 - fragCoordZ, 1.6) * darkness );',
      );
    };
    this.depthMaterial.depthTest = false;
    this.depthMaterial.depthWrite = false;

    this.hBlur = new THREE.ShaderMaterial(HorizontalBlurShader);
    this.hBlur.depthTest = false;
    this.vBlur = new THREE.ShaderMaterial(VerticalBlurShader);
    this.vBlur.depthTest = false;
  }

  blur(amount) {
    const r = this.renderer;
    this.blurPlane.visible = true;
    this.blurPlane.material = this.hBlur;
    this.hBlur.uniforms.tDiffuse.value = this.rt.texture;
    this.hBlur.uniforms.h.value = amount / 256;
    r.setRenderTarget(this.rtBlur);
    r.render(this.blurPlane, this.camera);
    this.blurPlane.material = this.vBlur;
    this.vBlur.uniforms.tDiffuse.value = this.rtBlur.texture;
    this.vBlur.uniforms.v.value = amount / 256;
    r.setRenderTarget(this.rt);
    r.render(this.blurPlane, this.camera);
    this.blurPlane.visible = false;
  }

  update(scene, hide = []) {
    const r = this.renderer;
    const bg = scene.background;
    scene.background = null;
    this.plane.visible = false;
    hide.forEach((o) => (o.visible = false));
    scene.overrideMaterial = this.depthMaterial;
    const clearAlpha = r.getClearAlpha();
    const clearColor = r.getClearColor(new THREE.Color());
    r.setClearColor(0x000000, 0);
    r.setRenderTarget(this.rt);
    r.clear();
    r.render(scene, this.camera);
    scene.overrideMaterial = null;
    this.blur(this.blurAmount);
    this.blur(this.blurAmount * 0.4);
    r.setRenderTarget(null);
    r.setClearColor(clearColor, clearAlpha);
    scene.background = bg;
    this.plane.visible = true;
    hide.forEach((o) => (o.visible = true));
  }
}
