import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import * as THREE from 'three';
import {
  SCENE_RADIUS, bodyRadius, journeyState, orbitPosition, orbitRadius,
} from '../core/journey.js';
import { skyState } from '../core/constellation.js';
import { createStage, prefersReducedMotion, supportsWebGL } from '../core/stage.js';
import { isOpen, lockReason, missionState } from '../core/missions.js';

// The journey, flown.
//
// Ten levels are ten places, so the level picker is the solar system itself:
// drag to look around, scroll to travel outward, and click a body to practise
// there. Pull far enough back and the Sun becomes one star among the reading
// constellations, which is the same map the Progress tab draws flat.
//
// Everything is built from primitives at load time — there are no models or
// textures to download — and the whole scene is disposed when the tab changes.

const INNER_ZOOM = 26;
const OUTER_ZOOM = 520;
// The reading constellations sit well beyond anywhere the camera can travel,
// so pulling back looks *at* them rather than flying through them.
const GALAXY_FADE_IN = 190;
const GALAXY_RADIUS = 920;

const CRAFT_TRAVEL_SECONDS = 1.8;

// ---------------------------------------------------------------------------
// Scene construction
// ---------------------------------------------------------------------------

/** A soft round sprite, drawn once and shared by every glow in the scene. */
function glowTexture() {
  const size = 128;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const context = canvas.getContext('2d');
  const gradient = context.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  gradient.addColorStop(0, 'rgba(255,255,255,1)');
  gradient.addColorStop(0.25, 'rgba(255,255,255,0.55)');
  gradient.addColorStop(0.55, 'rgba(255,255,255,0.14)');
  gradient.addColorStop(1, 'rgba(255,255,255,0)');
  context.fillStyle = gradient;
  context.fillRect(0, 0, size, size);
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}

function buildStarfield() {
  const count = 3200;
  const positions = new Float32Array(count * 3);
  const colours = new Float32Array(count * 3);
  const sizes = new Float32Array(count);
  const colour = new THREE.Color();
  for (let index = 0; index < count; index++) {
    // Uniform over the sphere, not over latitude: acos of a uniform variable.
    const theta = Math.random() * Math.PI * 2;
    const phi = Math.acos(2 * Math.random() - 1);
    const radius = 700 + Math.random() * 500;
    positions[index * 3] = radius * Math.sin(phi) * Math.cos(theta);
    positions[index * 3 + 1] = radius * Math.cos(phi);
    positions[index * 3 + 2] = radius * Math.sin(phi) * Math.sin(theta);
    // Real starlight runs blue-white to amber; a faint bias makes the field
    // read as a sky rather than as noise.
    colour.setHSL(0.08 + Math.random() * 0.55, 0.35, 0.6 + Math.random() * 0.4);
    colours[index * 3] = colour.r;
    colours[index * 3 + 1] = colour.g;
    colours[index * 3 + 2] = colour.b;
    sizes[index] = 1.2 + Math.random() * 2.6;
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geometry.setAttribute('color', new THREE.BufferAttribute(colours, 3));
  geometry.setAttribute('size', new THREE.BufferAttribute(sizes, 1));
  const material = new THREE.PointsMaterial({
    size: 1.7,
    vertexColors: true,
    sizeAttenuation: false,
    transparent: true,
    opacity: 0.62,
    depthWrite: false,
  });
  return new THREE.Points(geometry, material);
}

function buildSun(texture) {
  const group = new THREE.Group();
  const core = new THREE.Mesh(
    new THREE.SphereGeometry(2.4, 48, 32),
    new THREE.MeshBasicMaterial({ color: 0xffd9a0 }),
  );
  group.add(core);

  for (const [scale, opacity] of [[9, 0.55], [18, 0.24], [40, 0.09]]) {
    const sprite = new THREE.Sprite(new THREE.SpriteMaterial({
      map: texture,
      color: 0xffc873,
      transparent: true,
      opacity,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    }));
    sprite.scale.setScalar(scale);
    group.add(sprite);
  }
  const light = new THREE.PointLight(0xfff0d8, 900, 0, 2);
  group.add(light);
  return group;
}

function buildOrbit(radius, colour) {
  const points = [];
  for (let index = 0; index <= 220; index++) {
    const angle = (index / 220) * Math.PI * 2;
    points.push(new THREE.Vector3(Math.cos(angle) * radius, 0, Math.sin(angle) * radius));
  }
  const geometry = new THREE.BufferGeometry().setFromPoints(points);
  const material = new THREE.LineBasicMaterial({
    color: colour, transparent: true, opacity: 0.2, depthWrite: false,
  });
  return new THREE.Line(geometry, material);
}

/** The belt as what it is: a lot of small bodies on slightly tilted orbits. */
function buildBelt(innerAu, outerAu, count, colour, spread) {
  const inner = orbitRadius(innerAu);
  const outer = orbitRadius(outerAu);
  const positions = new Float32Array(count * 3);
  for (let index = 0; index < count; index++) {
    const angle = Math.random() * Math.PI * 2;
    const radius = inner + Math.random() * (outer - inner);
    positions[index * 3] = Math.cos(angle) * radius;
    positions[index * 3 + 1] = (Math.random() - 0.5) * spread;
    positions[index * 3 + 2] = Math.sin(angle) * radius;
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  return new THREE.Points(geometry, new THREE.PointsMaterial({
    color: colour, size: 1.3, sizeAttenuation: false, transparent: true, opacity: 0.32, depthWrite: false,
  }));
}

/** The boundary drawn as a shell of particles, because it is not a surface. */
function buildHeliopause(radius) {
  const count = 2600;
  const positions = new Float32Array(count * 3);
  for (let index = 0; index < count; index++) {
    const theta = Math.random() * Math.PI * 2;
    const phi = Math.acos(2 * Math.random() - 1);
    // Squashed along the direction of travel, the way the real one is.
    const r = radius * (0.97 + Math.random() * 0.06);
    positions[index * 3] = r * Math.sin(phi) * Math.cos(theta) * 1.06;
    positions[index * 3 + 1] = r * Math.cos(phi) * 0.72;
    positions[index * 3 + 2] = r * Math.sin(phi) * Math.sin(theta);
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  return new THREE.Points(geometry, new THREE.PointsMaterial({
    color: 0x6ee0d0, size: 1.5, sizeAttenuation: false, transparent: true, opacity: 0.34, depthWrite: false,
  }));
}

/** A small craft: capsule, two panels, and a light of its own. */
function buildCraft(texture) {
  const group = new THREE.Group();
  group.scale.setScalar(2.1);
  const body = new THREE.Mesh(
    new THREE.CapsuleGeometry(0.16, 0.34, 6, 12),
    new THREE.MeshStandardMaterial({ color: 0xe8eef8, roughness: 0.4, metalness: 0.5 }),
  );
  body.rotation.z = Math.PI / 2;
  group.add(body);

  const panelGeometry = new THREE.BoxGeometry(0.5, 0.02, 0.26);
  const panelMaterial = new THREE.MeshStandardMaterial({
    color: 0x2f6fb0, roughness: 0.35, metalness: 0.6, emissive: 0x0d2a44, emissiveIntensity: 0.6,
  });
  for (const offset of [-0.42, 0.42]) {
    const panel = new THREE.Mesh(panelGeometry, panelMaterial);
    panel.position.z = offset;
    group.add(panel);
  }

  // A beacon, so a craft two pixels long is still somewhere you can find.
  const halo = new THREE.Sprite(new THREE.SpriteMaterial({
    map: texture, color: 0x8ff0e0, transparent: true, opacity: 0.55,
    blending: THREE.AdditiveBlending, depthWrite: false,
  }));
  halo.scale.setScalar(3.4);
  group.add(halo);
  group.userData.halo = halo;
  return group;
}

/**
 * The reading constellations, placed out past the heliopause.
 *
 * Each one takes a direction of its own on a distant sphere; a star's own
 * position inside the group comes from the same coordinates the flat map uses,
 * so the shape you learn in Progress is the shape you find out here.
 */
function buildGalaxy(sky, texture) {
  const group = new THREE.Group();
  const anchors = [];
  const bases = [
    new THREE.Vector3(-0.7, 0.35, -0.62),
    new THREE.Vector3(0.78, 0.2, -0.58),
    new THREE.Vector3(0.6, -0.3, 0.74),
    new THREE.Vector3(-0.66, -0.22, 0.72),
  ];

  sky.forEach((constellation, index) => {
    const centre = bases[index % bases.length].clone().normalize().multiplyScalar(GALAXY_RADIUS);
    const up = new THREE.Vector3(0, 1, 0);
    const right = new THREE.Vector3().crossVectors(up, centre).normalize();
    const local = new THREE.Vector3().crossVectors(centre, right).normalize();
    const scale = 130;

    const place = (star) => centre.clone()
      .add(right.clone().multiplyScalar((star.x - 50) / 50 * scale))
      .add(local.clone().multiplyScalar((50 - star.y) / 50 * scale));

    anchors.push({
      id: constellation.id,
      name: constellation.name,
      meaning: constellation.meaning,
      litCount: constellation.litCount,
      total: constellation.stars.length,
      position: centre.clone(),
    });
    const colour = new THREE.Color().setHSL(constellation.hue / 360, 0.55, 0.7);
    for (const [from, to] of constellation.lines) {
      const a = constellation.stars[from];
      const b = constellation.stars[to];
      const line = new THREE.Line(
        new THREE.BufferGeometry().setFromPoints([place(a), place(b)]),
        new THREE.LineBasicMaterial({
          color: colour,
          transparent: true,
          opacity: a.lit && b.lit ? 0.62 : 0.22,
          depthWrite: false,
        }),
      );
      group.add(line);
    }

    for (const star of constellation.stars) {
      const sprite = new THREE.Sprite(new THREE.SpriteMaterial({
        map: texture,
        color: star.lit ? 0xffd79a : 0x93a4c4,
        transparent: true,
        opacity: star.lit ? 0.95 : 0.5,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
      }));
      sprite.position.copy(place(star));
      sprite.scale.setScalar(star.lit ? 52 + star.brightness * 30 : 34);
      group.add(sprite);
    }
  });

  group.visible = false;
  return { group, anchors };
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export default function SolarSystem({ profile, onPick }) {
  const mountRef = useRef(null);
  const engineRef = useRef(null);
  // Labels are positioned imperatively every frame. Routing sixty updates a
  // second through React state would re-render the whole panel each frame for
  // nothing but a transform.
  const labelRefs = useRef(new Map());
  const constellationRefs = useRef(new Map());
  const [hovered, setHovered] = useState(null);
  const [zoom, setZoom] = useState(0.28);
  const [webgl] = useState(supportsWebGL);

  const waypoints = useMemo(() => journeyState(profile).map((waypoint) => {
    const mission = missionState(profile, waypoint.level);
    // A place is lit when its objectives are done, which is a richer and more
    // honest signal than "the level was promoted at some point".
    return {
      ...waypoint,
      mission,
      reached: mission.cleared || waypoint.reached,
      open: isOpen(profile, waypoint.level),
      locked: !isOpen(profile, waypoint.level),
      reason: lockReason(profile, waypoint.level),
    };
  }), [profile]);
  const sky = useMemo(() => skyState(profile), [profile]);
  const level = profile?.level || 1;

  const pick = useCallback((value) => onPick?.(value), [onPick]);

  useEffect(() => {
    const mount = mountRef.current;
    if (!webgl || !mount) return undefined;

    const reduced = prefersReducedMotion();
    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(48, 1, 0.1, 4000);
    const stage = createStage(mount, { camera, clearColor: 0x000000, className: 'sr-orrery-canvas' });
    if (!stage) return undefined;
    const { renderer } = stage;

    const texture = glowTexture();
    const disposables = [texture];

    scene.add(new THREE.AmbientLight(0x6f86b8, 0.55));
    const starfield = buildStarfield();
    scene.add(starfield);
    const sun = buildSun(texture);
    scene.add(sun);

    const orbits = new THREE.Group();
    scene.add(orbits);
    const bodies = new THREE.Group();
    scene.add(bodies);

    const pickable = [];
    const bodyRecords = [];

    for (const waypoint of waypoints) {
      const distance = orbitRadius(waypoint.au);
      if (waypoint.period) {
        const orbit = buildOrbit(distance, new THREE.Color(waypoint.colour));
        orbits.add(orbit);
        disposables.push(orbit.geometry, orbit.material);
      }

      const group = new THREE.Group();
      let mesh = null;

      if (waypoint.kind === 'field') {
        const belt = buildBelt(30, 50, 2400, new THREE.Color(waypoint.colour), 2.2);
        scene.add(belt);
        disposables.push(belt.geometry, belt.material);
      } else if (waypoint.kind === 'boundary') {
        const shell = buildHeliopause(distance);
        scene.add(shell);
        disposables.push(shell.geometry, shell.material);
      } else {
        const size = bodyRadius(waypoint.radius);
        mesh = new THREE.Mesh(
          new THREE.SphereGeometry(size, 40, 28),
          new THREE.MeshStandardMaterial({
            color: new THREE.Color(waypoint.colour),
            roughness: 0.86,
            metalness: 0.05,
            emissive: new THREE.Color(waypoint.colour).multiplyScalar(0.22),
          }),
        );
        mesh.userData.level = waypoint.level;
        group.add(mesh);
        disposables.push(mesh.geometry, mesh.material);

        // Pluto is a pixel and a half across at this scale. An invisible
        // sphere around every body gives the pointer something to hit.
        const target = new THREE.Mesh(
          new THREE.SphereGeometry(Math.max(size * 2.4, 1.5), 12, 8),
          new THREE.MeshBasicMaterial({ visible: false }),
        );
        target.userData.level = waypoint.level;
        group.add(target);
        pickable.push(target);
        disposables.push(target.geometry, target.material);

        const sheen = new THREE.Sprite(new THREE.SpriteMaterial({
          map: texture,
          color: new THREE.Color(waypoint.colour),
          transparent: true,
          opacity: 0.28,
          blending: THREE.AdditiveBlending,
          depthWrite: false,
        }));
        sheen.scale.setScalar(size * 2.9);
        group.add(sheen);
        group.userData.sheen = sheen;
        disposables.push(sheen.material);

        if (waypoint.ring) {
          const [inner, outer] = waypoint.ring;
          const ring = new THREE.Mesh(
            new THREE.RingGeometry(size * inner, size * outer, 96),
            new THREE.MeshBasicMaterial({
              color: new THREE.Color(waypoint.colour),
              transparent: true,
              opacity: 0.28,
              side: THREE.DoubleSide,
              depthWrite: false,
            }),
          );
          // Tilted hard enough to read as a ring rather than as a disc seen
          // face on, and set on the body's own axis where it has one.
          ring.rotation.x = Math.PI / 2 - 0.52;
          if (waypoint.tilt) ring.rotation.y = waypoint.tilt;
          group.add(ring);
          disposables.push(ring.geometry, ring.material);
        }

        // A halo marks where the reader has actually been. It is set from the
        // profile below rather than here, so travelling does not rebuild the
        // scene.
        const halo = new THREE.Sprite(new THREE.SpriteMaterial({
          map: texture,
          color: 0x8ff0e0,
          transparent: true,
          opacity: 0,
          blending: THREE.AdditiveBlending,
          depthWrite: false,
        }));
        halo.scale.setScalar(size * 7);
        group.add(halo);
        group.userData.halo = halo;
        disposables.push(halo.material);
      }

      bodies.add(group);
      bodyRecords.push({ waypoint, group, mesh });
    }

    const { group: galaxy, anchors } = buildGalaxy(sky, texture);
    scene.add(galaxy);

    const craft = buildCraft(texture);
    scene.add(craft);
    craft.traverse((child) => {
      if (child.geometry) disposables.push(child.geometry);
      if (child.material) disposables.push(child.material);
    });

    // --- camera state -----------------------------------------------------
    const framing = (waypoint) => THREE.MathUtils.clamp(
      orbitRadius(waypoint.au) * 2.6 + 16, INNER_ZOOM, OUTER_ZOOM,
    );
    const opening = framing(waypoints.find((item) => item.level === level) || waypoints[0]);
    const view = {
      theta: -0.9,
      phi: 0.86,
      distance: opening * 1.35,
      targetDistance: opening,
      target: new THREE.Vector3(),
    };

    const raycaster = new THREE.Raycaster();
    const pointer = new THREE.Vector2();
    let dragging = false;
    let dragged = false;
    let lastX = 0;
    let lastY = 0;


    const onPointerDown = (event) => {
      dragging = true;
      dragged = false;
      lastX = event.clientX;
      lastY = event.clientY;
      renderer.domElement.setPointerCapture?.(event.pointerId);
    };
    const onPointerMove = (event) => {
      const rect = renderer.domElement.getBoundingClientRect();
      pointer.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
      pointer.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;
      if (!dragging) return;
      const dx = event.clientX - lastX;
      const dy = event.clientY - lastY;
      if (Math.abs(dx) + Math.abs(dy) > 3) dragged = true;
      lastX = event.clientX;
      lastY = event.clientY;
      view.theta -= dx * 0.005;
      view.phi = Math.max(0.18, Math.min(Math.PI - 0.18, view.phi - dy * 0.005));
    };
    const onPointerUp = (event) => {
      if (dragging && !dragged) {
        raycaster.setFromCamera(pointer, camera);
        const hit = raycaster.intersectObjects(pickable, false)[0];
        if (hit?.object?.userData?.level) pick(hit.object.userData.level);
      }
      dragging = false;
      renderer.domElement.releasePointerCapture?.(event.pointerId);
    };
    const onWheel = (event) => {
      event.preventDefault();
      const factor = Math.exp(event.deltaY * 0.0012);
      view.targetDistance = Math.max(INNER_ZOOM, Math.min(OUTER_ZOOM, view.targetDistance * factor));
    };

    const element = renderer.domElement;
    element.addEventListener('pointerdown', onPointerDown);
    element.addEventListener('pointermove', onPointerMove);
    element.addEventListener('pointerup', onPointerUp);
    element.addEventListener('pointerleave', () => { dragging = false; });
    element.addEventListener('wheel', onWheel, { passive: false });

    // --- animation --------------------------------------------------------
    let elapsed = 0;
    const projected = new THREE.Vector3();
    const travel = { from: null, to: null, t: 1 };
    const state = {
      level,
      reached: new Set(waypoints.filter((item) => item.reached).map((item) => item.level)),
      visited: new Set(waypoints.filter((item) => item.visited).map((item) => item.level)),
      locked: new Set(waypoints.filter((item) => item.locked).map((item) => item.level)),
      hovered: null,
    };

    const positionOf = (waypoint) => {
      const [x, y, z] = orbitPosition(waypoint, elapsed);
      return new THREE.Vector3(x, y, z);
    };

    const render = (delta) => {
      if (!reduced) elapsed += delta;

      for (const record of bodyRecords) {
        const position = positionOf(record.waypoint);
        record.group.position.copy(position);
        if (record.mesh && !reduced) record.mesh.rotation.y += delta * 0.35;
        const halo = record.group.userData.halo;
        if (halo) {
          const isCurrent = record.waypoint.level === state.level;
          const wanted = isCurrent
            ? 0.5 + Math.sin(elapsed * 2.2) * 0.16
            : state.reached.has(record.waypoint.level) ? 0.3
              : state.visited.has(record.waypoint.level) ? 0.14 : 0;
          halo.material.opacity += (wanted - halo.material.opacity) * 0.12;
          halo.material.color.set(isCurrent ? 0x8ff0e0 : state.reached.has(record.waypoint.level) ? 0xffd79a : 0x7f8da6);
        }
        if (record.mesh) {
          const emphasise = state.hovered === record.waypoint.level;
          const target = emphasise ? 1.22 : 1;
          record.mesh.scale.lerp(new THREE.Vector3(target, target, target), 0.16);
          // A destination that is not open yet is out there but unlit: no
          // sheen of its own, and only the Sun to show it.
          const locked = state.locked.has(record.waypoint.level);
          record.mesh.material.emissiveIntensity = locked ? 0.15 : 1;
          const sheen = record.group.userData.sheen;
          if (sheen) {
            const wanted = locked ? 0.04 : 0.28;
            sheen.material.opacity += (wanted - sheen.material.opacity) * 0.1;
          }
        }
      }

      // The craft rides its current waypoint, and arcs across when the reader
      // travels to a new one.
      const destination = bodyRecords.find((record) => record.waypoint.level === state.level);
      if (destination) {
        const home = destination.group.position;
        if (travel.t < 1 && travel.from) {
          travel.t = Math.min(1, travel.t + delta / CRAFT_TRAVEL_SECONDS);
          const eased = travel.t < 0.5
            ? 2 * travel.t * travel.t
            : 1 - ((-2 * travel.t + 2) ** 2) / 2;
          craft.position.lerpVectors(travel.from, home, eased);
          // Lift out of the ecliptic on the way, so the hop reads as a hop.
          craft.position.y += Math.sin(eased * Math.PI) * 5.5;
        } else {
          const offset = bodyRadius(destination.waypoint.radius) + 1.1;
          craft.position.set(
            home.x + Math.cos(elapsed * 0.9) * offset,
            home.y + 0.5 + Math.sin(elapsed * 1.3) * 0.16,
            home.z + Math.sin(elapsed * 0.9) * offset,
          );
        }
        craft.lookAt(home);
        craft.rotateY(Math.PI / 2);
        const beacon = craft.userData.halo;
        if (beacon) beacon.material.opacity = 0.42 + Math.sin(elapsed * 3.1) * 0.16;
      }

      if (!reduced && !dragging) view.theta += delta * 0.018;
      view.distance += (view.targetDistance - view.distance) * 0.08;

      const sinPhi = Math.sin(view.phi);
      camera.position.set(
        view.target.x + view.distance * sinPhi * Math.cos(view.theta),
        view.target.y + view.distance * Math.cos(view.phi),
        view.target.z + view.distance * sinPhi * Math.sin(view.theta),
      );
      camera.lookAt(view.target);

      // Far enough out, the orbits stop meaning anything and the reading
      // constellations take over.
      const outward = THREE.MathUtils.clamp(
        (view.distance - GALAXY_FADE_IN) / (OUTER_ZOOM - GALAXY_FADE_IN), 0, 1,
      );
      galaxy.visible = outward > 0.01;
      galaxy.traverse((child) => {
        if (child.material && 'opacity' in child.material) {
          const base = child.material.userData.baseOpacity ?? child.material.opacity;
          child.material.userData.baseOpacity = base;
          child.material.opacity = base * outward;
        }
      });
      orbits.traverse((child) => {
        if (child.material) child.material.opacity = 0.2 * (1 - outward * 0.92);
      });
      craft.visible = outward < 0.6;

      renderer.render(scene, camera);

      // Labels are real buttons in the DOM, projected onto the bodies. That
      // keeps the type crisp and keeps the scene operable from a keyboard.
      const width = mount.clientWidth;
      const height = mount.clientHeight;
      const placed = [];
      // Bodies bunch together near the Sun, so labels are laid out by
      // importance — where you are, then where you have been, then the rest —
      // and one that would land on top of another is dropped rather than
      // stacked. Its body is still clickable.
      const ordered = [...bodyRecords].sort((a, b) => {
        const rank = (record) => (record.waypoint.level === state.level ? 0
          : state.hovered === record.waypoint.level ? 1
            : state.reached.has(record.waypoint.level) ? 2 : 3);
        return rank(a) - rank(b);
      });
      for (const record of ordered) {
        const label = labelRefs.current.get(record.waypoint.level);
        if (!label) continue;
        projected.copy(record.group.position).project(camera);
        const x = (projected.x * 0.5 + 0.5) * width;
        const y = (-projected.y * 0.5 + 0.5) * height;
        const behind = projected.z >= 1;
        const crowded = placed.some((point) => (
          Math.abs(point.x - x) < 108 && Math.abs(point.y - y) < 22
        ));
        const hidden = behind || outward > 0.75 || crowded;
        if (!hidden) placed.push({ x, y });
        label.style.transform = `translate3d(${x}px, ${y}px, 0)`;
        label.classList.toggle('is-hidden', hidden);
      }

      for (const anchor of anchors) {
        const label = constellationRefs.current.get(anchor.id);
        if (!label) continue;
        projected.copy(anchor.position).project(camera);
        label.style.transform = `translate3d(${(projected.x * 0.5 + 0.5) * width}px, ${(-projected.y * 0.5 + 0.5) * height}px, 0)`;
        label.classList.toggle('is-hidden', projected.z >= 1 || outward < 0.3);
      }
    };

    // Browsers already stop serving animation frames to a hidden page, so
    // there is nothing to pause by hand — and pausing by hand risks leaving
    // two loops running when the page comes back.
    stage.run(render);

    engineRef.current = {
      travelTo(nextLevel) {
        const record = bodyRecords.find((item) => item.waypoint.level === nextLevel);
        if (!record || nextLevel === state.level) return;
        travel.from = craft.position.clone();
        travel.t = 0;
        state.level = nextLevel;
        // Ease the view out far enough to hold both ends of the hop.
        view.targetDistance = framing(record.waypoint);
      },
      setProgress(reached, visited, locked) {
        state.reached = new Set(reached);
        state.visited = new Set(visited);
        state.locked = new Set(locked);
      },
      setHovered(value) { state.hovered = value; },
      setZoom(value) {
        view.targetDistance = INNER_ZOOM + (OUTER_ZOOM - INNER_ZOOM) * value ** 2.1;
      },
    };

    return () => {
      element.removeEventListener('pointerdown', onPointerDown);
      element.removeEventListener('pointermove', onPointerMove);
      element.removeEventListener('pointerup', onPointerUp);
      element.removeEventListener('wheel', onWheel);
      stage.track(...disposables);
      stage.dispose();
      engineRef.current = null;
    };
    // The scene is built from the shape of the journey, not from the reader's
    // position in it: travelling and lighting up are pushed in through the
    // engine handle rather than by tearing the whole thing down.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [webgl]);

  useEffect(() => { engineRef.current?.travelTo(level); }, [level]);
  useEffect(() => {
    engineRef.current?.setProgress(
      waypoints.filter((item) => item.reached).map((item) => item.level),
      waypoints.filter((item) => item.visited).map((item) => item.level),
      waypoints.filter((item) => item.locked).map((item) => item.level),
    );
  }, [waypoints]);
  useEffect(() => { engineRef.current?.setHovered(hovered); }, [hovered]);
  useEffect(() => { engineRef.current?.setZoom(zoom); }, [zoom]);

  const current = waypoints.find((item) => item.level === level) || waypoints[0];
  const shown = (hovered ? waypoints.find((item) => item.level === hovered) : null) || current;
  const looking = shown.level !== level;

  if (!webgl) {
    return (
      <p className="sr-hint sr-orrery-fallback">
        This browser cannot draw the solar system, so the level list below is the map.
      </p>
    );
  }

  return (
    <section className="sr-orrery" aria-label="The solar system, as the reading path">
      <div className="sr-orrery-stage" ref={mountRef}>
        {waypoints.map((waypoint) => (
          <button
            key={waypoint.level}
            type="button"
            ref={(node) => {
              if (node) labelRefs.current.set(waypoint.level, node);
              else labelRefs.current.delete(waypoint.level);
            }}
            className={`sr-orrery-label is-hidden${waypoint.level === level ? ' is-current' : ''}${waypoint.reached ? ' is-reached' : ''}${waypoint.locked ? ' is-locked' : ''}`}
            aria-describedby={waypoint.locked ? 'sr-orrery-lock' : undefined}
            onClick={() => pick(waypoint.level)}
            onMouseEnter={() => setHovered(waypoint.level)}
            onMouseLeave={() => setHovered(null)}
            onFocus={() => setHovered(waypoint.level)}
            onBlur={() => setHovered(null)}
          >
            <span className="sr-orrery-dot" aria-hidden="true" />
            <span className="sr-orrery-name">{waypoint.name}</span>
            <span className="sr-orrery-level">{waypoint.locked ? 'Closed' : `Level ${waypoint.level}`}</span>
          </button>
        ))}
        {sky.map((constellation) => (
          <span
            key={constellation.id}
            className="sr-orrery-constellation is-hidden"
            ref={(node) => {
              if (node) constellationRefs.current.set(constellation.id, node);
              else constellationRefs.current.delete(constellation.id);
            }}
          >
            <b>{constellation.name}</b>
            <em>{constellation.litCount}/{constellation.stars.length} lit</em>
          </span>
        ))}
      </div>

      <div className="sr-orrery-hud">
        <div className="sr-orrery-readout">
          <span className="sr-eyebrow">
            {looking ? 'Looking at' : 'You are at'} · Level {shown.level}
            {shown.locked
              ? <em className="sr-orrery-flag is-locked">Closed</em>
              : shown.mission.cleared && <em className="sr-orrery-flag">Cleared</em>}
          </span>
          <strong>{shown.name}</strong>
          <p>{shown.fact}</p>
          <p className="sr-orrery-distance">
            {shown.au} AU from the Sun
            {shown.period ? ` · one orbit every ${shown.period} years` : ''}
          </p>
          <p className="sr-orrery-objectives" id="sr-orrery-lock">
            {shown.locked
              ? `Not open yet — ${shown.reason}`
              : shown.mission.cleared
                ? 'Every objective here is complete.'
                : `${shown.mission.done} of ${shown.mission.total} objectives · next: ${shown.mission.objectives.find((item) => !item.done)?.title}`}
          </p>
          {looking && !shown.locked && (
            <button type="button" className="sr-btn sr-btn--small sr-orrery-travel" onClick={() => pick(shown.level)}>
              Travel to {shown.name}
            </button>
          )}
        </div>
        <label className="sr-orrery-zoom">
          <span>Inner system</span>
          <input
            type="range" min="0" max="1" step="0.01" value={zoom}
            onChange={(event) => setZoom(Number(event.target.value))}
            aria-label="Travel outward from the inner system to the reading constellations"
          />
          <span>Galaxy</span>
        </label>
      </div>
    </section>
  );
}
