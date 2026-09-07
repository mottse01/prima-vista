import { useEffect, useRef } from 'react';
import * as THREE from 'three';
import { createStage, prefersReducedMotion } from '../core/stage.js';

// A real navigable room. Every highlighted object has a world-space hit target.
// No continuous physics, model downloads, post-processing, or pointer lock.
export default function AdventureScene({ location, room, onInteract, onTarget, view, paused, onUnavailable }) {
  const mount = useRef(null);
  const live = useRef({ room, onInteract, onTarget, view, paused, onUnavailable });
  useEffect(() => { live.current = { room, onInteract, onTarget, view, paused, onUnavailable }; });
  useEffect(() => {
    const host = mount.current;
    const camera = new THREE.PerspectiveCamera(66, 1, .08, 90);
    const stage = createStage(host, {
      camera, alpha: false, maxPixelRatio: 1.5, powerPreference: 'low-power',
    });
    if (!stage) { live.current.onUnavailable(); return undefined; }
    const { renderer } = stage;
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.62;
    const scene = new THREE.Scene();
    scene.background = new THREE.Color(location.sky);
    scene.fog = new THREE.FogExp2(location.sky, .019);
    camera.position.set(0, 1.65, 6.2);
    const geometry = [], materials = [], textures = [], targets = [], labels = [];
    const color = new THREE.Color(location.color);
    const material = (c, opts = {}) => { const m = new THREE.MeshStandardMaterial({ color: c, roughness: .66, metalness: .25, ...opts }); materials.push(m); return m; };
    const steel = material('#465259'), dark = material('#101c24'), trim = material('#a1aba7'), pale = material('#dfdfcf');
    const warm = material('#ccaa6b', { emissive: '#ccaa6b', emissiveIntensity: .75 });
    const glow = material(location.color, { emissive: color, emissiveIntensity: 1.1 });
    function box(w, h, d, x, y, z, mat, parent = scene) {
      const g = new THREE.BoxGeometry(w, h, d); geometry.push(g);
      const mesh = new THREE.Mesh(g, mat); mesh.castShadow = true; mesh.receiveShadow = true; mesh.position.set(x, y, z); parent.add(mesh); return mesh;
    }
    function cylinder(r, h, x, y, z, mat, parent = scene) {
      const g = new THREE.CylinderGeometry(r, r, h, 24); geometry.push(g);
      const mesh = new THREE.Mesh(g, mat); mesh.castShadow = true; mesh.receiveShadow = true; mesh.position.set(x, y, z); parent.add(mesh); return mesh;
    }
    function textPanel(lines, width, height, x, y, z, options = {}) {
      const canvas = document.createElement('canvas'); canvas.width = 1024; canvas.height = 512;
      const ctx = canvas.getContext('2d'); ctx.fillStyle = options.background || '#152730'; ctx.fillRect(0, 0, 1024, 512);
      ctx.strokeStyle = location.color; ctx.lineWidth = 5; ctx.strokeRect(20, 20, 984, 472);
      ctx.textAlign = 'center';
      lines.forEach((line, i) => { ctx.fillStyle = i === 0 ? location.color : '#eef4eb'; ctx.font = `${i === 0 ? 500 : 600} ${i === 0 ? 34 : 60}px sans-serif`; ctx.fillText(line, 512, 108 + i * 96); });
      const texture = new THREE.CanvasTexture(canvas); texture.colorSpace = THREE.SRGBColorSpace; textures.push(texture);
      const mat = new THREE.MeshBasicMaterial({ map: texture }); materials.push(mat);
      const g = new THREE.PlaneGeometry(width, height); geometry.push(g);
      const mesh = new THREE.Mesh(g, mat); mesh.position.set(x, y, z); scene.add(mesh); return mesh;
    }
    function target(mesh, id, label) { mesh.userData = { id, label }; targets.push(mesh); return mesh; }
    scene.add(new THREE.HemisphereLight('#b5d1e4', '#243039', 3.1));
    const light = new THREE.PointLight(color, 90, 18, 2); light.position.set(0, 4.2, 0); scene.add(light);
    const windowLight = new THREE.DirectionalLight('#b7d6ed', 2.1); windowLight.position.set(0, 5, -8); windowLight.castShadow = true; windowLight.shadow.mapSize.set(1024,1024); Object.assign(windowLight.shadow.camera, { left: -10, right: 10, top: 10, bottom: -10, near: .1, far: 35 }); windowLight.shadow.bias = -.001; scene.add(windowLight);
    // Walkable deck, structural ribs, overhead practical lighting.
    box(15, .25, 17, 0, -.15, 0, dark);
    box(15, .2, 17, 0, 5.8, 0, steel);
    box(.3, 6, 17, -7.5, 2.8, 0, steel); box(.3, 6, 17, 7.5, 2.8, 0, steel);
    for (let z = -7; z <= 8; z += 2) {
      box(14.8, .025, .025, 0, .01, z, trim);
      box(.14, 5.7, .2, -7.2, 2.85, z, trim); box(.14, 5.7, .2, 7.2, 2.85, z, trim);
      box(13.8, .1, .15, 0, 5.5, z, dark);
      box(2.6, .04, .13, -3.7, 5.38, z, glow); box(2.6, .04, .13, 3.7, 5.38, z, glow);
    }
    for (let x = -6; x <= 6; x += 3) box(.024, .025, 17, x, .012, 0, trim);
    // Observation window and a softly lit world beyond it.
    box(15, 1.1, .35, 0, .5, -8, steel); box(15, .5, .4, 0, 5.55, -8, steel);
    for (let x = -7; x <= 7; x += 3.5) box(.16, 4.8, .4, x, 3, -8, trim);
    const exteriorTexture = new THREE.TextureLoader().load('/expedition.webp'); exteriorTexture.colorSpace = THREE.SRGBColorSpace; textures.push(exteriorTexture);
    const extMat = new THREE.MeshBasicMaterial({ map: exteriorTexture, color: location.type === 'garden' ? '#e7b79d' : '#cbd9ed' }); materials.push(extMat);
    const eg = new THREE.PlaneGeometry(48, 26); geometry.push(eg);
    const outside = new THREE.Mesh(eg, extMat); outside.position.set(0, 6, -26); scene.add(outside);
    // A guidance portrait and one-key rhythm desk frame the central piano.
    box(2.6, .16, .85, -4.3, 1.05, -2.7, steel);
    box(.35, 1, .55, -4.3, .5, -2.7, dark);
    const portraitTexture = new THREE.TextureLoader().load('/lyra.webp'); portraitTexture.colorSpace = THREE.SRGBColorSpace; textures.push(portraitTexture);
    const portraitMaterial = new THREE.MeshBasicMaterial({ map: portraitTexture }); materials.push(portraitMaterial);
    const portraitGeometry = new THREE.PlaneGeometry(2.25, 2.25); geometry.push(portraitGeometry);
    const portrait = new THREE.Mesh(portraitGeometry, portraitMaterial); portrait.position.set(-4.3,2.55,-2.65); scene.add(portrait); target(portrait,'mentor','Meet Lyra · reading guidance');
    box(2.42,2.42,.12,-4.3,2.55,-2.74,trim);
    target(textPanel(['LYRA', 'READING GUIDE'],2.25,.55,-4.3,1.08,-2.45),'mentor','Meet Lyra · reading guidance');
    box(2.8,1.15,.65,4.3,.58,-2.7, dark);
    target(textPanel(['RHYTHM READING','ONE NOTE. STEADY PULSE.'],2.8,1.4,4.3,2.8,-2.65),'rhythm','Read a one-note rhythm');
    target(box(1.8,.1,.65,4.3,1.21,-2.3,pale),'rhythm','Begin rhythm study');
    // The piano console is an instrument in the room, with a real score on use.
    box(3.2, .24, 1.15, 0, 1.12, -3.8, steel);
    box(.24, 1.12, .8, -1.2, .56, -3.8, dark); box(.24, 1.12, .8, 1.2, .56, -3.8, dark);
    const console = target(box(2.7, .75, .15, 0, 1.85, -4.13, dark), 'piano', 'Use the piano console');
    const screen = textPanel(['FRESH SIGHT-READING', 'PIANO STUDIO'], 2.55, .7, 0, 1.85, -4.04); target(screen, 'piano', 'Use the piano console');
    for (let i = 0; i < 21; i++) { target(box(.12, .07, .7, -1.3 + i * .13, 1.29, -3.55, pale), 'piano', 'Use the piano console'); if (![2,6].includes(i % 7)) box(.065, .11, .4, -1.24 + i * .13, 1.37, -3.75, dark); }
    // Rear airlock: actual sliding panels respond to all three repaired systems.
    box(15, 6, .3, 0, 2.8, 8.5, steel);
    box(4.1, 4.6, .55, 0, 2.3, 8.1, dark);
    const doorLeft = target(box(1.75, 4, .18, -.88, 2, 7.76, trim), 'exit', 'Inspect the airlock');
    const doorRight = target(box(1.75, 4, .18, .88, 2, 7.76, trim), 'exit', 'Inspect the airlock');
    const exitScreen = textPanel(['AIRLOCK', 'NEXT STATION'], 2.6, .85, 0, 4.55, 7.73); exitScreen.rotation.y = Math.PI; target(exitScreen, 'exit', 'Travel to the next station');
    const exitButton = target(box(.42, .75, .18, 2.65, 1.55, 7.8, glow), 'exit', 'Use the airlock');
    // Different architectural uses of the same small scene vocabulary.
    const animated = [];
    if (location.type === 'garden') {
      const green = material('#3b8766');
      for (const x of [-6.1, 6.1]) for (let z = -5; z <= 5; z += 2.5) {
        box(1.2, .6, 1.4, x, .3, z, pale);
        for (let i = 0; i < 3; i++) { const stalk = cylinder(.06, 1.2, x + (i - 1) * .32, 1.2, z, green); animated.push(stalk); const leaf = box(.6, .09, .24, x + (i - 1) * .32, 1.5 + i * .16, z, green); leaf.rotation.z = (i - 1) * .45; }
        box(.08, .08, 1.4, x, 2.3, z, warm);
      }
    } else if (location.type === 'archive') {
      for (const x of [-6.3, 6.3]) for (let z = -5; z <= 5; z += 2.5) {
        box(.9, 3.4, 1.3, x, 1.7, z, dark);
        for (let i = 0; i < 8; i++) { box(1, .1, 1.32, x, .35 + i * .4, z, steel); box(1.04, .05, .4, x, .42 + i * .4, z, glow); }
      }
    } else if (location.type === 'greenhouse') {
      // Growing frames stacked toward a light source, and nothing on the floor,
      // so the room reads taller than the garden it grew out of.
      const green = material('#4f9f76');
      for (const x of [-6.2, 6.2]) for (let z = -5; z <= 5; z += 2.5) {
        for (let tier = 0; tier < 3; tier++) {
          box(1.5, .07, 1.4, x, .8 + tier * 1.35, z, pale);
          box(1.4, .1, .12, x, .95 + tier * 1.35, z + .62, glow);
          for (let i = 0; i < 3; i++) { const leaf = box(.44, .07, .2, x + (i - 1) * .4, 1 + tier * 1.35, z, green); leaf.rotation.z = (i - 1) * .5; animated.push(leaf); }
        }
        cylinder(.09, 4.4, x - .78, 2.2, z, steel); cylinder(.09, 4.4, x + .78, 2.2, z, steel);
      }
    } else if (location.type === 'workshop') {
      // Benches, pipework and hanging lamps: somewhere things get repaired.
      for (const x of [-6.2, 6.2]) for (let z = -5; z <= 5; z += 2.5) {
        box(1.6, .12, 1.5, x, 1.05, z, trim);
        box(.14, 1, .14, x - .6, .5, z, steel); box(.14, 1, .14, x + .6, .5, z, steel);
        box(1.4, .5, .1, x, 1.9, z, dark); box(1.2, .06, .06, x, 1.72, z, warm);
        const lamp = cylinder(.22, .16, x, 3.6, z, warm); animated.push(lamp);
        cylinder(.05, 1.5, x, 4.4, z, steel);
      }
      for (let z = -6; z <= 6; z += 4) cylinder(.13, 14.6, 0, 5.1, z, steel).rotation.z = Math.PI / 2;
    } else if (location.type === 'shelter') {
      // Low, close and warm: crates, bedrolls and one lantern each.
      for (const x of [-6, 6]) for (let z = -5; z <= 5; z += 2.5) {
        box(1.5, 1.1, 1.4, x, .55, z, dark);
        box(1.55, .1, 1.45, x, 1.14, z, trim);
        const lantern = box(.3, .42, .3, x, 1.55, z, warm); animated.push(lantern);
        box(1.2, .16, 1.2, x, .06, z + 1.4, pale);
      }
      box(15, .35, 17, 0, 4.6, 0, dark);
    } else if (location.type === 'relay') {
      // Dishes turned outward, listening for something a long way off.
      for (const x of [-6.4, 6.4]) for (let z = -4.5; z <= 4.5; z += 3) {
        cylinder(.14, 2.4, x, 1.2, z, steel);
        const dish = new THREE.Group(); dish.position.set(x, 2.6, z); scene.add(dish);
        const face = cylinder(1.05, .12, 0, 0, 0, pale, dish); face.rotation.z = x < 0 ? -.6 : .6;
        cylinder(.06, .9, 0, .5, 0, trim, dish);
        box(.22, .22, .22, 0, .95, 0, glow, dish);
        animated.push(dish);
      }
    } else {
      const telescope = new THREE.Group(); telescope.position.set(0, 2.9, -6.6); scene.add(telescope);
      const tube = cylinder(.38, 2.7, 0, 0, 0, pale, telescope); tube.rotation.x = .75;
      cylinder(.18, 2.3, 0, -1.4, 0, steel, telescope);
      cylinder(1.1, .2, 0, -2.68, 0, dark, telescope); animated.push(telescope);
      for (const x of [-6, 6]) { box(.8, 2.1, .8, x, 1.05, 3.8, dark); box(.9, .16, .9, x, 2.2, 3.8, warm); }
    }
    const receiver = cylinder(.26, 1.25, 4.3, 2.3, -3.6, glow);
    const raycaster = new THREE.Raycaster(), pointer = new THREE.Vector2();
    let yaw = 0, pitch = -.035, dragging = null, moved = false, targetId = null, lastView = null;
    const keys = new Set();
    const shots = { room: [0, 1.65, 6.2, 0, -.035], power: [-4.3, 1.7, -.1, 0, -.05], signal: [4.3, 1.7, -.1, 0, -.05], piano: [0, 1.65, -.8, 0, -.05], exit: [0, 1.65, 4.8, Math.PI, 0] };
    const moveTo = (id) => { const shot = shots[id] || shots.room; camera.position.set(...shot.slice(0,3)); yaw = shot[3]; pitch = shot[4]; };
    const updateCamera = () => { camera.rotation.order = 'YXZ'; camera.rotation.set(pitch, yaw, 0); camera.updateMatrixWorld(); };
    function pick(clientX, clientY) { const rect = renderer.domElement.getBoundingClientRect(); pointer.set((clientX - rect.left) / rect.width * 2 - 1, -(clientY - rect.top) / rect.height * 2 + 1); raycaster.setFromCamera(pointer, camera); return raycaster.intersectObjects(targets, false)[0]?.object; }
    function down(e) { if (live.current.paused) return; dragging = { x: e.clientX, y: e.clientY, startX: e.clientX, startY: e.clientY }; moved = false; renderer.domElement.setPointerCapture(e.pointerId); }
    function move(e) { if (!dragging || live.current.paused) return; if (Math.hypot(e.clientX - dragging.startX, e.clientY - dragging.startY) > 6) moved = true; if (moved) { yaw -= (e.clientX - dragging.x) * .004; pitch = THREE.MathUtils.clamp(pitch - (e.clientY - dragging.y) * .003, -.7, .7); } dragging.x = e.clientX; dragging.y = e.clientY; }
    function up(e) { if (dragging && !moved && !live.current.paused) { updateCamera(); const hit = pick(e.clientX,e.clientY); if (hit) live.current.onInteract(hit.userData.id); } dragging = null; }
    function keydown(e) { if (live.current.paused || /INPUT|TEXTAREA|SELECT/.test(e.target.tagName)) return; const key = e.key.toLowerCase(); if (['w','a','s','d','arrowleft','arrowright','arrowup','arrowdown','e'].includes(key)) { e.preventDefault(); keys.add(key); if (key === 'e' && targetId && !e.repeat) live.current.onInteract(targetId); } }
    const keyup = (e) => keys.delete(e.key.toLowerCase());
    const blur = () => { keys.clear(); dragging = null; };
    renderer.domElement.addEventListener('pointerdown', down); renderer.domElement.addEventListener('pointermove', move); renderer.domElement.addEventListener('pointerup', up); renderer.domElement.addEventListener('pointercancel', blur);
    window.addEventListener('keydown', keydown); window.addEventListener('keyup', keyup); window.addEventListener('blur', blur);
    const reduced = prefersReducedMotion();
    const draw = (dt, now) => {
      const state = live.current;
      if (state.view !== lastView) { moveTo(state.view?.id); lastView = state.view; }
      if (!state.paused) {
        if (keys.has('arrowleft')) yaw += dt; if (keys.has('arrowright')) yaw -= dt;
        const forward = Number(keys.has('w') || keys.has('arrowup')) - Number(keys.has('s') || keys.has('arrowdown'));
        const side = Number(keys.has('d')) - Number(keys.has('a'));
        camera.position.x = THREE.MathUtils.clamp(camera.position.x + (-Math.sin(yaw)*forward + Math.cos(yaw)*side)*dt*3, -5.7, 5.7);
        camera.position.z = THREE.MathUtils.clamp(camera.position.z + (-Math.cos(yaw)*forward - Math.sin(yaw)*side)*dt*3, -.5, 6.5);
      } else keys.clear();
      updateCamera();
      light.intensity = state.room.power ? 160 : 65;
      receiver.rotation.z = state.room.signal ? .35 : 0;
      console.material.emissive.set(state.room.music ? location.color : '#000000');
      const complete = state.room.power && state.room.signal && state.room.music;
      const desired = complete ? 2.25 : .88;
      doorLeft.position.x = THREE.MathUtils.lerp(doorLeft.position.x, -desired, reduced ? 1 : .06); doorRight.position.x = THREE.MathUtils.lerp(doorRight.position.x, desired, reduced ? 1 : .06);
      exitButton.material = complete ? glow : warm;
      if (state.room.power && !reduced && !state.paused) for (const object of animated) object.rotation.y = Math.sin(now * .0002) * .08;
      if (!state.paused) { raycaster.setFromCamera(new THREE.Vector2(0,0),camera); const hit = raycaster.intersectObjects(targets,false)[0]?.object; if ((hit?.userData.id || null) !== targetId) { targetId = hit?.userData.id || null; state.onTarget(hit ? { id: targetId, label: hit.userData.label } : null); } }
      // A page the browser has stopped drawing, or a paused room, still needs
      // one frame that matches the current size and state.
      if (!document.hidden && !state.paused) renderer.render(scene, camera);
      else if (stage.stale) { renderer.render(scene, camera); stage.settle(); }
    };
    stage.run(draw);
    return () => { window.removeEventListener('keydown',keydown); window.removeEventListener('keyup',keyup); window.removeEventListener('blur',blur); stage.track(...geometry, ...materials, ...textures); stage.dispose(); labels.length = 0; };
  }, [location]);
  return <div className="pv-world-canvas" ref={mount} aria-label="Explorable space station. Drag to look. Use W A S D to walk, arrows to turn and walk, or the station controls." role="img" />;
}
