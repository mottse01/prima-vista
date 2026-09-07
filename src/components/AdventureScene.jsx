import { useEffect, useRef } from 'react';
import * as THREE from 'three';
import { NOTE_NAMES } from '../core/adventure.js';

// A real navigable room. Every highlighted object has a world-space hit target.
// No continuous physics, model downloads, post-processing, or pointer lock.
export default function AdventureScene({ location, room, switches, onInteract, onTarget, view, paused, onUnavailable }) {
  const mount = useRef(null);
  const live = useRef({ room, switches, onInteract, onTarget, view, paused, onUnavailable });
  useEffect(() => { live.current = { room, switches, onInteract, onTarget, view, paused, onUnavailable }; });
  useEffect(() => {
    const host = mount.current;
    delete host.dataset.rendered;
    let renderer;
    try { renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false, powerPreference: 'low-power' }); }
    catch { live.current.onUnavailable(); return undefined; }
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.5));
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.3;
    host.appendChild(renderer.domElement);
    const scene = new THREE.Scene();
    scene.background = new THREE.Color(location.sky);
    scene.fog = new THREE.FogExp2(location.sky, .019);
    const camera = new THREE.PerspectiveCamera(66, 1, .08, 90);
    camera.position.set(0, 1.65, 6.2);
    const geometry = [], materials = [], textures = [], targets = [], labels = [];
    const color = new THREE.Color(location.color);
    const material = (c, opts = {}) => { const m = new THREE.MeshStandardMaterial({ color: c, roughness: .66, metalness: .25, ...opts }); materials.push(m); return m; };
    const steel = material('#33404b'), dark = material('#141e28'), trim = material('#77848a'), pale = material('#b2b7ad');
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
      if (options.staff) {
        ctx.strokeStyle = '#ecf2e9'; ctx.lineWidth = 3;
        for (let i = 0; i < 5; i++) { ctx.beginPath(); ctx.moveTo(190, 230 + i * 26); ctx.lineTo(850, 230 + i * 26); ctx.stroke(); }
        ctx.font = '80px serif'; ctx.fillText('𝄞', 225, 329);
        const positions = { 60: 360, 62: 347, 64: 334, 65: 321, 67: 308 };
        location.clue.forEach((note, i) => { const nx = 370 + i * 175, ny = positions[note]; ctx.fillStyle = '#f0f5eb'; ctx.beginPath(); ctx.ellipse(nx, ny, 19, 13, -.2, 0, Math.PI * 2); ctx.fill(); ctx.fillRect(nx + 16, ny - 80, 3, 80); if (note === 60) { ctx.fillRect(nx - 28, ny - 1, 56, 3); } });
      }
      const texture = new THREE.CanvasTexture(canvas); texture.colorSpace = THREE.SRGBColorSpace; textures.push(texture);
      const mat = new THREE.MeshBasicMaterial({ map: texture }); materials.push(mat);
      const g = new THREE.PlaneGeometry(width, height); geometry.push(g);
      const mesh = new THREE.Mesh(g, mat); mesh.position.set(x, y, z); scene.add(mesh); return mesh;
    }
    function target(mesh, id, label) { mesh.userData = { id, label }; targets.push(mesh); return mesh; }
    scene.add(new THREE.HemisphereLight('#b5d1e4', '#182027', 2.4));
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
    for (let x = -6; x <= 6; x += 2) box(.024, .025, 17, x, .012, 0, trim);
    // Observation window and a softly lit world beyond it.
    box(15, 1.1, .35, 0, .5, -8, steel); box(15, .5, .4, 0, 5.55, -8, steel);
    for (let x = -7; x <= 7; x += 3.5) box(.16, 4.8, .4, x, 3, -8, trim);
    const exteriorTexture = new THREE.TextureLoader().load('/expedition.webp'); exteriorTexture.colorSpace = THREE.SRGBColorSpace; textures.push(exteriorTexture);
    const extMat = new THREE.MeshBasicMaterial({ map: exteriorTexture, color: location.type === 'garden' ? '#e7b79d' : '#cbd9ed' }); materials.push(extMat);
    const eg = new THREE.PlaneGeometry(48, 26); geometry.push(eg);
    const outside = new THREE.Mesh(eg, extMat); outside.position.set(0, 6, -26); scene.add(outside);
    // Power routing board: three physical switches, three target indicators.
    box(2.8, 1.5, .6, -4.3, 1.3, -2.7, dark);
    textPanel(['POWER ROUTING', 'MATCH THE UPPER LIGHTS'], 2.8, 1.4, -4.3, 3.25, -2.71);
    const switchMeshes = [], switchMats = [];
    for (let i = 0; i < 3; i++) {
      const x = -5.15 + i * .85;
      const goalMat = material(location.power[i] ? location.color : '#22262b', { emissive: location.power[i] ? color : '#000000', emissiveIntensity: 1 });
      box(.32, .18, .06, x, 2.08, -2.3, goalMat);
      const sm = material('#614c32', { emissive: '#b16e2c', emissiveIntensity: .4 }); switchMats.push(sm);
      target(box(.52, .36, .22, x, 1.55, -2.25, sm), `power-${i}`, `Power switch ${i + 1}`);
      const lever = box(.08, .45, .09, x, 1.58, -2.04, pale); switchMeshes.push(lever); target(lever, `power-${i}`, `Power switch ${i + 1}`);
    }
    // Receiver clue is conventional notation printed on a physical screen.
    box(2.8, 1.5, .65, 4.3, 1.25, -2.7, dark);
    textPanel(['RECEIVER SIGNATURE'], 2.8, 1.4, 4.3, 3.25, -2.7, { staff: true });
    const noteMeshes = [];
    [60, 62, 64, 65, 67].forEach((note, i) => {
      const x = 3.26 + i * .52;
      const key = target(box(.42, .32, .28, x, 1.57, -2.18, pale), `note-${note}`, `Play ${NOTE_NAMES[note]}`); noteMeshes.push(key);
      textPanel([NOTE_NAMES[note]], .4, .2, x, 1.22, -2.32);
    });
    // The piano console is an instrument in the room, with a real score on use.
    box(3.2, .24, 1.15, 0, 1.12, -3.8, steel);
    box(.24, 1.12, .8, -1.2, .56, -3.8, dark); box(.24, 1.12, .8, 1.2, .56, -3.8, dark);
    const console = target(box(2.7, .75, .15, 0, 1.85, -4.13, dark), 'piano', 'Use the piano console');
    const screen = textPanel(['HARMONIC RELAY', 'PIANO CONSOLE'], 2.55, .7, 0, 1.85, -4.04); target(screen, 'piano', 'Use the piano console');
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
    } else {
      const telescope = new THREE.Group(); telescope.position.set(0, 2.9, -6.6); scene.add(telescope);
      const tube = cylinder(.38, 2.7, 0, 0, 0, pale, telescope); tube.rotation.x = .75;
      cylinder(.18, 2.3, 0, -1.4, 0, steel, telescope);
      cylinder(1.1, .2, 0, -2.68, 0, dark, telescope); animated.push(telescope);
      for (const x of [-6, 6]) { box(.8, 2.1, .8, x, 1.05, 3.8, dark); box(.9, .16, .9, x, 2.2, 3.8, warm); }
    }
    const receiver = cylinder(.26, 1.25, 4.3, 2.3, -3.6, glow);
    const raycaster = new THREE.Raycaster(), pointer = new THREE.Vector2();
    let yaw = 0, pitch = -.035, previous = performance.now(), frame, dragging = null, moved = false, targetId = null, lastView = null;
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
    const resize = new ResizeObserver(() => { const w = host.clientWidth, h = host.clientHeight; renderer.setSize(w,h); camera.aspect = w / Math.max(1,h); camera.updateProjectionMatrix(); }); resize.observe(host);
    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    const draw = (now) => {
      frame = requestAnimationFrame(draw);
      const dt = Math.min((now - previous) / 1000, .05); previous = now;
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
      for (let i = 0; i < 3; i++) { switchMats[i].color.set(state.switches[i] ? location.color : '#51422c'); switchMats[i].emissive.set(state.switches[i] ? location.color : '#22180c'); switchMeshes[i].rotation.x = state.switches[i] ? -.5 : .5; }
      light.intensity = state.room.power ? 160 : 65;
      receiver.rotation.z = state.room.signal ? .35 : 0;
      console.material.emissive.set(state.room.music ? location.color : '#000000');
      const complete = state.room.power && state.room.signal && state.room.music;
      const desired = complete ? 2.25 : .88;
      doorLeft.position.x = THREE.MathUtils.lerp(doorLeft.position.x, -desired, reduced ? 1 : .06); doorRight.position.x = THREE.MathUtils.lerp(doorRight.position.x, desired, reduced ? 1 : .06);
      exitButton.material = complete ? glow : warm;
      if (state.room.power && !reduced && !state.paused) for (const object of animated) object.rotation.y = Math.sin(now * .0002) * .08;
      if (!state.paused) { raycaster.setFromCamera(new THREE.Vector2(0,0),camera); const hit = raycaster.intersectObjects(targets,false)[0]?.object; if ((hit?.userData.id || null) !== targetId) { targetId = hit?.userData.id || null; state.onTarget(hit ? { id: targetId, label: hit.userData.label } : null); } }
      if (!document.hidden && !state.paused) renderer.render(scene,camera);
      else if (!host.dataset.rendered) { renderer.render(scene,camera); host.dataset.rendered = 'true'; }
    };
    frame = requestAnimationFrame(draw);
    return () => { cancelAnimationFrame(frame); resize.disconnect(); window.removeEventListener('keydown',keydown); window.removeEventListener('keyup',keyup); window.removeEventListener('blur',blur); geometry.forEach(g=>g.dispose()); materials.forEach(m=>m.dispose()); textures.forEach(t=>t.dispose()); renderer.dispose(); renderer.domElement.remove(); labels.length = 0; noteMeshes.length = 0; };
  }, [location]);
  return <div className="pv-world-canvas" ref={mount} aria-label="Explorable space station. Drag to look. Use W A S D to walk, arrows to turn and walk, or the station controls." role="img" />;
}
