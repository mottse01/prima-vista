import { useEffect, useRef } from 'react';
import * as THREE from 'three';
import { createStage, prefersReducedMotion } from '../core/stage.js';
import { backdropFor, SHARED_VIEW } from '../core/adventure.js';

// The station as a diorama: a small room you look into and turn, rather than
// one you stand inside and walk around.
//
// It used to be first person — a crosshair, W A S D, and `E` to interact. That
// is shooter grammar, and none of the games this design takes its manners from
// use it: Moss and Monument Valley both put you outside a small world you can
// turn in your hands. It is also friction between a reader and the music, and
// walking to a console teaches nobody to read. So: drag to turn, tap the thing
// you want. Less code than the controller it replaces, far better on a phone,
// and legible to somebody who has never played a game.
//
// Nothing here needs a model download, post-processing or pointer lock.

/**
 * Where the camera sits for each station: a point to look at, how far back to
 * stand, and from what angle. Moving between them is a slow arc rather than a
 * cut, because seeing the room turn is what tells you the two views are the
 * same place.
 */
const FRAMES = {
  // Three-quarters and slightly above, so the room reads as a made object
  // rather than as a corridor pointed down. Straight on, the airlock at the
  // near end fills the middle of the picture and everything worth looking at
  // hides behind it.
  room: { focus: [0, 1.7, 0.4], distance: 33, azimuth: 0.52, elevation: 0.42 },
  power: { focus: [-4.3, 1.85, -2.6], distance: 13, azimuth: -0.5, elevation: 0.2 },
  signal: { focus: [4.3, 1.9, -2.6], distance: 13, azimuth: 0.5, elevation: 0.2 },
  piano: { focus: [0, 1.45, -3.8], distance: 12.5, azimuth: 0.1, elevation: 0.24 },
  exit: { focus: [0, 2.1, 5.4], distance: 20, azimuth: 0.85, elevation: 0.3 },
};
const ELEVATION_RANGE = [0.06, 0.9];
const DISTANCE_RANGE = [8, 46];
/** Above this the overhead ribs start getting in the way, so they fade out. */
const ROOF_CLEARS_AT = 0.24;
/** How much of the way to the target framing each frame closes. */
const EASE = 0.075;

const shortestTurn = (from, to) => from + Math.atan2(Math.sin(to - from), Math.cos(to - from));

export default function AdventureScene({ location, room, onInteract, onTarget, view, paused, onUnavailable }) {
  const mount = useRef(null);
  const live = useRef({ room, onInteract, onTarget, view, paused, onUnavailable });
  useEffect(() => { live.current = { room, onInteract, onTarget, view, paused, onUnavailable }; });
  useEffect(() => {
    const host = mount.current;
    const camera = new THREE.PerspectiveCamera(44, 1, .1, 160);
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
    scene.fog = new THREE.FogExp2(location.sky, .0085);
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
    // Interactive things get a material of their own so that lighting one on
    // hover does not light every plinth in the room that shares its colour.
    const BLACK = new THREE.Color('#000000');
    const groups = new Map();
    function target(mesh, id, label) {
      mesh.userData = { id, label };
      if (mesh.material && !mesh.userData.owned) {
        mesh.material = mesh.material.clone();
        mesh.userData.owned = true;
        materials.push(mesh.material);
      }
      targets.push(mesh);
      const group = groups.get(id) || { materials: new Set() };
      group.materials.add(mesh.material);
      groups.set(id, group);
      return mesh;
    }
    /** Light the thing under the pointer, and nothing else. */
    function highlight(id) {
      for (const [key, group] of groups) {
        const lit = key === id;
        for (const mat of group.materials) {
          if (mat.emissive) {
            mat.emissive.copy(lit ? color : BLACK);
            mat.emissiveIntensity = lit ? 0.55 : 1;
          } else if (mat.map) {
            // A textured panel has no emissive channel, so it brightens instead.
            mat.color.setScalar(lit ? 1.45 : 1);
          }
        }
      }
    }
    scene.add(new THREE.HemisphereLight('#b5d1e4', '#243039', 3.1));
    // A diorama is lit as an object on a table as well as a place you look
    // into, so there is a soft key on it from the viewer's own side.
    const keyLight = new THREE.DirectionalLight('#dceaf5', 1.15); keyLight.position.set(6, 11, 16); scene.add(keyLight);
    const light = new THREE.PointLight(color, 90, 18, 2); light.position.set(0, 4.2, 0); scene.add(light);
    const windowLight = new THREE.DirectionalLight('#b7d6ed', 2.1); windowLight.position.set(0, 5, -8); windowLight.castShadow = true; windowLight.shadow.mapSize.set(1024,1024); Object.assign(windowLight.shadow.camera, { left: -10, right: 10, top: 10, bottom: -10, near: .1, far: 35 }); windowLight.shadow.bias = -.001; scene.add(windowLight);
    // Deck, structural ribs, overhead practical lighting. There is no ceiling
    // slab: a diorama is a room with the lid off, and that is what makes it
    // possible to look into one at all.
    box(15, .25, 17, 0, -.15, 0, dark);
    // The shell pieces are the walls that would otherwise stand between the
    // camera and everything worth seeing. Each one steps out of the way when
    // the room is turned so that it is in front.
    const shell = [];
    const facing = (mesh, axis, at, side) => { shell.push({ mesh, axis, at, side }); return mesh; };
    facing(box(.3, 6, 17, -7.5, 2.8, 0, steel), 'x', -7.5, -1);
    facing(box(.3, 6, 17, 7.5, 2.8, 0, steel), 'x', 7.5, 1);
    // The ribs overhead fade rather than vanish, because a hard cut on a slow
    // camera move reads as a glitch.
    const roofMat = dark.clone(); roofMat.transparent = true; materials.push(roofMat);
    const roof = [];
    for (let z = -7; z <= 8; z += 2) {
      box(14.8, .025, .025, 0, .01, z, trim);
      facing(box(.14, 5.7, .2, -7.2, 2.85, z, trim), 'x', -7.2, -1);
      facing(box(.14, 5.7, .2, 7.2, 2.85, z, trim), 'x', 7.2, 1);
      roof.push(box(13.8, .1, .15, 0, 5.5, z, roofMat));
      roof.push(box(2.6, .04, .13, -3.7, 5.38, z, glow), box(2.6, .04, .13, 3.7, 5.38, z, glow));
    }
    for (let x = -6; x <= 6; x += 3) box(.024, .025, 17, x, .012, 0, trim);
    // Observation window and a softly lit world beyond it.
    box(15, 1.1, .35, 0, .5, -8, steel); box(15, .5, .4, 0, 5.55, -8, steel);
    for (let x = -7; x <= 7; x += 3.5) box(.16, 4.8, .4, x, 3, -8, trim);
    // Each place's own view, falling back to the shared one so a half-finished
    // set of pictures still leaves every station with something outside it.
    const exteriorTexture = new THREE.TextureLoader().load(
      backdropFor(location), undefined, undefined,
      () => { exteriorTexture.image = null; new THREE.TextureLoader().load(SHARED_VIEW, (fallback) => { extMat.map = fallback; extMat.needsUpdate = true; textures.push(fallback); stage.invalidate(); }); },
    );
    exteriorTexture.colorSpace = THREE.SRGBColorSpace; textures.push(exteriorTexture);
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
    facing(box(15, 6, .3, 0, 2.8, 8.5, steel), 'z', 8.5, 1);
    facing(box(4.1, 4.6, .55, 0, 2.3, 8.1, dark), 'z', 8.1, 1);
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
    // Where the camera is, and where it is going. Dragging writes into the
    // second; every frame the first closes some of the gap, so a drag during a
    // move blends with it rather than fighting it.
    const at = { ...FRAMES.room, focus: new THREE.Vector3(...FRAMES.room.focus) };
    const to = { ...at, focus: at.focus.clone() };
    let dragging = null, moved = false, targetId = null, lastView = null;
    const order = ['power', 'signal', 'piano', 'exit'];

    const frame = (id) => {
      const shot = FRAMES[id] || FRAMES.room;
      to.focus.set(...shot.focus);
      to.distance = shot.distance;
      to.elevation = shot.elevation;
      to.azimuth = shortestTurn(to.azimuth, shot.azimuth);
    };
    const place = () => {
      const flat = Math.cos(at.elevation) * at.distance;
      camera.position.set(
        at.focus.x + Math.sin(at.azimuth) * flat,
        at.focus.y + Math.sin(at.elevation) * at.distance,
        at.focus.z + Math.cos(at.azimuth) * flat,
      );
      camera.lookAt(at.focus);
      camera.updateMatrixWorld();
    };
    place();

    function pick(clientX, clientY) {
      const rect = renderer.domElement.getBoundingClientRect();
      pointer.set((clientX - rect.left) / rect.width * 2 - 1, -(clientY - rect.top) / rect.height * 2 + 1);
      raycaster.setFromCamera(pointer, camera);
      return raycaster.intersectObjects(targets, false)[0]?.object;
    }
    const look = (hit) => {
      const id = hit?.userData.id || null;
      if (id === targetId) return;
      targetId = id;
      highlight(id);
      live.current.onTarget(hit ? { id, label: hit.userData.label } : null);
    };
    function down(e) {
      if (live.current.paused) return;
      dragging = { x: e.clientX, y: e.clientY, startX: e.clientX, startY: e.clientY };
      moved = false;
      renderer.domElement.setPointerCapture(e.pointerId);
    }
    function move(e) {
      if (live.current.paused) return;
      if (!dragging) { look(pick(e.clientX, e.clientY)); return; }
      if (Math.hypot(e.clientX - dragging.startX, e.clientY - dragging.startY) > 6) moved = true;
      if (moved) {
        to.azimuth -= (e.clientX - dragging.x) * .006;
        to.elevation = THREE.MathUtils.clamp(to.elevation + (e.clientY - dragging.y) * .004, ...ELEVATION_RANGE);
      }
      dragging.x = e.clientX; dragging.y = e.clientY;
    }
    function up(e) {
      // A tap is a tap on the thing you tapped. No crosshair to line up, and
      // nothing to walk to first.
      if (dragging && !moved && !live.current.paused) {
        const hit = pick(e.clientX, e.clientY);
        if (hit) live.current.onInteract(hit.userData.id);
      }
      dragging = null;
    }
    function wheel(e) {
      if (live.current.paused) return;
      e.preventDefault();
      to.distance = THREE.MathUtils.clamp(to.distance + e.deltaY * .02, ...DISTANCE_RANGE);
    }
    // Arrows step between the stations rather than walking. For somebody
    // reading this with a keyboard that is a better deal than the free look it
    // replaces: every station is reachable in at most four presses, and the
    // one you are on is the one that lights up.
    function keydown(e) {
      if (live.current.paused || /INPUT|TEXTAREA|SELECT/.test(e.target.tagName)) return;
      const key = e.key.toLowerCase();
      if (key === 'arrowleft' || key === 'arrowright') {
        e.preventDefault();
        const step = key === 'arrowright' ? 1 : -1;
        const index = order.indexOf(targetId);
        const next = order[(index + step + order.length * 2) % order.length];
        const hit = targets.find((mesh) => mesh.userData.id === next);
        look(hit);
        frame(next);
      } else if (key === 'enter' || key === ' ') {
        if (!targetId) return;
        e.preventDefault();
        live.current.onInteract(targetId);
      } else if (key === '+' || key === '=' || key === '-') {
        e.preventDefault();
        to.distance = THREE.MathUtils.clamp(to.distance + (key === '-' ? 3 : -3), ...DISTANCE_RANGE);
      }
    }
    const blur = () => { dragging = null; };
    renderer.domElement.addEventListener('pointerdown', down);
    renderer.domElement.addEventListener('pointermove', move);
    renderer.domElement.addEventListener('pointerup', up);
    renderer.domElement.addEventListener('pointercancel', blur);
    renderer.domElement.addEventListener('pointerleave', () => look(null));
    renderer.domElement.addEventListener('wheel', wheel, { passive: false });
    window.addEventListener('keydown', keydown); window.addEventListener('blur', blur);
    const reduced = prefersReducedMotion();
    const draw = (dt, now) => {
      const state = live.current;
      // The room moved out from under the pointer, so whatever it was over is
      // no longer what it is over. Saying so beats leaving a stale caption
      // sitting on top of something else.
      if (state.view !== lastView) { frame(state.view?.id); lastView = state.view; look(null); }
      // Ease toward the framing rather than cutting to it: watching the room
      // turn is what tells somebody the close-up and the wide shot are the
      // same place.
      const ease = reduced ? 1 : Math.min(1, EASE * dt * 60);
      at.azimuth += (to.azimuth - at.azimuth) * ease;
      at.elevation += (to.elevation - at.elevation) * ease;
      at.distance += (to.distance - at.distance) * ease;
      at.focus.lerp(to.focus, ease);
      place();

      // Anything now standing between the camera and the room steps aside.
      for (const piece of shell) {
        const beyond = (piece.axis === 'x' ? camera.position.x : camera.position.z) * piece.side;
        piece.mesh.visible = beyond < piece.at * piece.side;
      }
      roofMat.opacity = THREE.MathUtils.clamp(1 - (at.elevation - ROOF_CLEARS_AT) * 3.2, 0, 1);
      for (const rib of roof) rib.visible = roofMat.opacity > 0.02;

      light.intensity = state.room.power ? 160 : 65;
      receiver.rotation.z = state.room.signal ? .35 : 0;
      console.material.emissive.set(state.room.music ? location.color : '#000000');
      const complete = state.room.power && state.room.signal && state.room.music;
      const desired = complete ? 2.25 : .88;
      doorLeft.position.x = THREE.MathUtils.lerp(doorLeft.position.x, -desired, reduced ? 1 : .06); doorRight.position.x = THREE.MathUtils.lerp(doorRight.position.x, desired, reduced ? 1 : .06);
      exitButton.material = complete ? glow : warm;
      if (state.room.power && !reduced && !state.paused) for (const object of animated) object.rotation.y = Math.sin(now * .0002) * .08;
      // A page the browser has stopped drawing, or a paused room, still needs
      // one frame that matches the current size and state.
      if (!document.hidden && !state.paused) renderer.render(scene, camera);
      else if (stage.stale) { renderer.render(scene, camera); stage.settle(); }
    };
    stage.run(draw);
    return () => { window.removeEventListener('keydown', keydown); window.removeEventListener('blur', blur); stage.track(...geometry, ...materials, ...textures); stage.dispose(); labels.length = 0; };
  }, [location]);
  return <div className="pv-world-canvas" ref={mount} aria-label="The station, seen from outside. Drag to turn it and tap something to use it, or press the left and right arrows to move between the stations and Enter to use one." role="img" />;
}
