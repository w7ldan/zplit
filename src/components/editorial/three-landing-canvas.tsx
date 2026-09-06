"use client";

import { useEffect, useRef } from "react";
import * as THREE from "three";
import { clamp01, damp, sampleCameraPath, type CameraCue } from "./landing-camera-path";

type SceneObjects = {
  hero: THREE.Group;
  heroLayers: THREE.Object3D[];
  model: THREE.Group;
  shares: THREE.Object3D[];
  repayment: THREE.Object3D;
  balance: THREE.Object3D;
  scope: THREE.Group;
  scopeNodes: THREE.Object3D[];
  collaboration: THREE.Group;
  ledgerPlane: THREE.Object3D;
  chatPlane: THREE.Object3D;
  proof: THREE.Group;
  receipt: THREE.Mesh;
  history: THREE.Group;
  archive: THREE.InstancedMesh;
  searchRecords: THREE.Object3D[];
  finale: THREE.Group;
  finaleOpen: THREE.Object3D;
  finaleSettled: THREE.Object3D;
  hoverables: THREE.Object3D[];
};

const sceneNames = ["hero", "model", "scopes", "journey", "collaboration", "proof", "private-share", "history", "finale"] as const;
type SceneName = (typeof sceneNames)[number];

const worldZ: Record<SceneName, number> = {
  hero: 0,
  model: -17,
  scopes: -34,
  journey: -42,
  collaboration: -53,
  proof: -69,
  "private-share": -78,
  history: -91,
  finale: -111,
};

function labelTexture(text: string, background: string, foreground: string) {
  const canvas = document.createElement("canvas");
  canvas.width = 768;
  canvas.height = 384;
  const context = canvas.getContext("2d");
  if (!context) throw new Error("Canvas labels are unavailable.");
  context.fillStyle = background;
  context.fillRect(0, 0, canvas.width, canvas.height);
  context.strokeStyle = foreground;
  context.lineWidth = 8;
  context.strokeRect(8, 8, canvas.width - 16, canvas.height - 16);
  context.fillStyle = foreground;
  context.font = "700 44px Arial";
  context.letterSpacing = "3px";
  context.fillText(text.toUpperCase(), 42, 76);
  context.lineWidth = 2;
  for (let y = 120; y < 350; y += 44) {
    context.globalAlpha = 0.22;
    context.fillRect(42, y, 684, 2);
  }
  context.globalAlpha = 1;
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.anisotropy = 4;
  return texture;
}

function paperSlab(
  width: number,
  height: number,
  depth: number,
  color: string,
  ink: string,
  label?: string,
) {
  const group = new THREE.Group();
  const material = new THREE.MeshStandardMaterial({ color, roughness: 0.92, metalness: 0 });
  const body = new THREE.Mesh(new THREE.BoxGeometry(width, height, depth), material);
  body.castShadow = true;
  body.receiveShadow = true;
  group.add(body);
  const edges = new THREE.LineSegments(
    new THREE.EdgesGeometry(body.geometry),
    new THREE.LineBasicMaterial({ color: ink, transparent: true, opacity: 0.72 }),
  );
  group.add(edges);
  if (label) {
    const face = new THREE.Mesh(
      new THREE.PlaneGeometry(width * 0.92, height * 0.82),
      new THREE.MeshBasicMaterial({ map: labelTexture(label, color, ink), toneMapped: false }),
    );
    face.position.z = depth / 2 + 0.006;
    group.add(face);
  }
  return group;
}

function connector(points: THREE.Vector3[], color: string) {
  return new THREE.Line(
    new THREE.BufferGeometry().setFromPoints(points),
    new THREE.LineBasicMaterial({ color, transparent: true, opacity: 0.72 }),
  );
}

function marker(color: string, ink: string) {
  const group = new THREE.Group();
  const disk = new THREE.Mesh(
    new THREE.CylinderGeometry(0.48, 0.48, 0.16, 32),
    new THREE.MeshStandardMaterial({ color, roughness: 0.85, metalness: 0 }),
  );
  disk.rotation.x = Math.PI / 2;
  disk.castShadow = true;
  group.add(disk);
  group.add(new THREE.LineSegments(new THREE.EdgesGeometry(disk.geometry), new THREE.LineBasicMaterial({ color: ink })));
  return group;
}

function bentReceipt(color: string, ink: string) {
  const geometry = new THREE.PlaneGeometry(3.2, 6.5, 18, 30);
  const position = geometry.attributes.position;
  for (let index = 0; index < position.count; index += 1) {
    const x = position.getX(index);
    const y = position.getY(index);
    position.setZ(index, Math.pow(Math.abs(x) / 1.6, 2) * 0.36 + Math.sin((y + 3.2) * 1.7) * 0.035);
  }
  geometry.computeVertexNormals();
  const receipt = new THREE.Mesh(
    geometry,
    new THREE.MeshStandardMaterial({
      map: labelTexture("receipt / attached", color, ink),
      color,
      roughness: 0.95,
      metalness: 0,
      side: THREE.DoubleSide,
    }),
  );
  receipt.castShadow = true;
  return receipt;
}

function buildWorld(colors: { paper: string; surface: string; ink: string; blue: string; mint: string; amber: string }) {
  const root = new THREE.Group();

  const hero = new THREE.Group();
  hero.position.set(3.5, 0.2, worldZ.hero);
  const heroLayers = [
    paperSlab(8.2, 5.5, 0.22, colors.blue, colors.ink, "balance plane"),
    paperSlab(7.8, 5.2, 0.2, colors.paper, colors.ink, "receipt / proof"),
    paperSlab(9.2, 6, 0.3, colors.surface, colors.ink, "expense / dinner"),
    paperSlab(4.2, 2.2, 0.2, colors.amber, colors.ink, "open / 42.500"),
  ];
  heroLayers.forEach((layer, index) => {
    layer.position.set(index === 3 ? 3.7 : 0, index === 3 ? -2.5 : 0, -index * 0.6);
    layer.rotation.z = (index - 1.5) * 0.025;
    hero.add(layer);
  });
  const heroMarkers = [marker(colors.mint, colors.ink), marker(colors.amber, colors.ink), marker(colors.blue, colors.ink)];
  heroMarkers.forEach((item, index) => {
    item.position.set(-3 + index * 3, -2.4, 1.1 + index * 0.12);
    hero.add(item);
  });
  root.add(hero);

  const model = new THREE.Group();
  model.position.set(0, 0, worldZ.model);
  const expense = paperSlab(6.4, 4.2, 0.28, colors.surface, colors.ink, "expense / 295.000");
  expense.position.set(0, 1.5, 0);
  expense.rotation.x = -0.08;
  model.add(expense);
  const shares = ["Rani / 126.500", "Dimas / 42.500", "You / remainder"].map((text, index) => {
    const share = paperSlab(3.5, 2.1, 0.2, index === 1 ? colors.amber : colors.paper, colors.ink, text);
    share.position.set((index - 1) * 4.2, -1.8 + Math.abs(index - 1) * 0.3, -2.3);
    model.add(share);
    model.add(connector([new THREE.Vector3(0, 0.2, -0.2), new THREE.Vector3(share.position.x, share.position.y + 1.1, -2.1)], colors.ink));
    return share;
  });
  const repayment = paperSlab(3.2, 1.35, 0.22, colors.mint, colors.ink, "repayment / 126.500");
  repayment.position.set(-6.7, 1.4, 1.4);
  repayment.rotation.z = -0.08;
  model.add(repayment);
  const balance = paperSlab(3.5, 1.7, 0.26, colors.amber, colors.ink, "remaining / 42.500");
  balance.position.set(5.1, 2.5, 1.6);
  model.add(balance);
  root.add(model);

  const scope = new THREE.Group();
  scope.position.set(0, 0, worldZ.scopes);
  const scopeLedger = paperSlab(7, 4.5, 0.28, colors.surface, colors.ink, "shared financial language");
  scope.add(scopeLedger);
  const scopeNodes = [marker(colors.blue, colors.ink), marker(colors.mint, colors.ink), marker(colors.amber, colors.ink), marker(colors.paper, colors.ink), marker(colors.blue, colors.ink)];
  scopeNodes.forEach((node, index) => {
    node.position.set((index - 2) * 2, -3, 0.8);
    scope.add(node);
  });
  root.add(scope);

  const collaboration = new THREE.Group();
  collaboration.position.set(0, 0, worldZ.collaboration);
  const ledgerPlane = paperSlab(7.2, 5, 0.28, colors.surface, colors.ink, "group / ledger");
  ledgerPlane.position.set(-3.7, -0.3, 0);
  ledgerPlane.rotation.y = 0.15;
  collaboration.add(ledgerPlane);
  const chatPlane = paperSlab(5.5, 6.4, 0.24, colors.blue, colors.ink, "group chat / context");
  chatPlane.position.set(4.3, 0.6, -3.2);
  chatPlane.rotation.y = -0.2;
  collaboration.add(chatPlane);
  for (let index = 0; index < 3; index += 1) {
    collaboration.add(connector([
      new THREE.Vector3(-0.1, 1.2 - index * 1.2, -0.2),
      new THREE.Vector3(1.4, 1.2 - index * 1.2, -1.6),
    ], colors.ink));
  }
  root.add(collaboration);

  const proof = new THREE.Group();
  proof.position.set(1.5, 0, worldZ.proof);
  const proofExpense = paperSlab(8, 5.5, 0.34, colors.surface, colors.ink, "expense / proof attached");
  proof.add(proofExpense);
  const receipt = bentReceipt(colors.paper, colors.ink);
  receipt.position.set(3.6, -0.2, -1);
  receipt.rotation.set(-0.08, -0.12, 0.08);
  receipt.userData.hoverable = true;
  proof.add(receipt);
  root.add(proof);

  const history = new THREE.Group();
  history.position.set(0, 0, worldZ.history);
  const archiveGeometry = new THREE.BoxGeometry(6.8, 4.4, 0.12);
  const archiveMaterial = new THREE.MeshStandardMaterial({ color: colors.paper, roughness: 0.95, metalness: 0 });
  const archive = new THREE.InstancedMesh(archiveGeometry, archiveMaterial, 28);
  const matrix = new THREE.Matrix4();
  for (let index = 0; index < 28; index += 1) {
    const side = index % 2 === 0 ? -1 : 1;
    matrix.compose(
      new THREE.Vector3(side * (3.8 + (index % 4) * 0.35), (index % 5 - 2) * 0.55, -index * 1.05),
      new THREE.Quaternion().setFromEuler(new THREE.Euler(0, side * -0.24, side * 0.018)),
      new THREE.Vector3(1, 1, 1),
    );
    archive.setMatrixAt(index, matrix);
  }
  archive.instanceMatrix.needsUpdate = true;
  history.add(archive);
  const searchRecords = ["dinner / bandung", "taxi / bandung"].map((text, index) => {
    const record = paperSlab(5.4, 3.2, 0.22, index === 0 ? colors.blue : colors.mint, colors.ink, text);
    record.position.set(index === 0 ? -2.8 : 2.8, index === 0 ? 1 : -1.2, 2);
    history.add(record);
    return record;
  });
  root.add(history);

  const finale = new THREE.Group();
  finale.position.set(2.3, 0, worldZ.finale);
  for (let index = 0; index < 9; index += 1) {
    const sheet = paperSlab(8.2, 5.2, 0.16, index % 3 === 0 ? colors.blue : colors.paper, colors.ink);
    sheet.position.set((index % 3 - 1) * 0.22, (index % 2) * 0.16, -index * 0.34);
    sheet.rotation.z = (index % 2 ? 1 : -1) * 0.012;
    finale.add(sheet);
  }
  const finaleSettled = paperSlab(3.5, 2, 0.18, colors.mint, colors.ink, "Rani / Rp0 / settled");
  finaleSettled.position.set(-2.3, -2, 1.4);
  finale.add(finaleSettled);
  const finaleOpen = paperSlab(3.5, 2, 0.3, colors.amber, colors.ink, "Dimas / 42.500 / open");
  finaleOpen.position.set(2.3, -1.6, 2.2);
  finale.add(finaleOpen);
  root.add(finale);

  return {
    root,
    objects: {
      hero,
      heroLayers,
      model,
      shares,
      repayment,
      balance,
      scope,
      scopeNodes,
      collaboration,
      ledgerPlane,
      chatPlane,
      proof,
      receipt,
      history,
      archive,
      searchRecords,
      finale,
      finaleOpen,
      finaleSettled,
      hoverables: [receipt, ...heroMarkers],
    } satisfies SceneObjects,
  };
}

function readColors() {
  const style = getComputedStyle(document.documentElement);
  const value = (name: string, fallback: string) => style.getPropertyValue(name).trim() || fallback;
  return {
    paper: value("--paper", "#f4f1ea"),
    surface: value("--surface", "#fffefa"),
    ink: value("--ink", "#111315"),
    blue: value("--pastel-blue", "#c7e4f6"),
    mint: value("--mint", "#d7eadf"),
    amber: value("--amber", "#f1d394"),
  };
}

function progressFor(name: SceneName) {
  const element = document.querySelector<HTMLElement>(`[data-spatial-scene="${name}"]`);
  if (!element) return 0;
  const bounds = element.getBoundingClientRect();
  return clamp01((window.innerHeight * 0.78 - bounds.top) / Math.max(window.innerHeight + bounds.height * 0.5, 1));
}

function buildCameraCues(mobile: boolean): CameraCue[] {
  const pageTravel = Math.max(document.documentElement.scrollHeight - window.innerHeight, 1);
  return sceneNames.map((name) => {
    const element = document.querySelector<HTMLElement>(`[data-spatial-scene="${name}"]`);
    const progress = element ? clamp01((element.offsetTop + element.offsetHeight * 0.42 - window.innerHeight * 0.5) / pageTravel) : 0;
    const z = worldZ[name];
    const xByScene: Record<string, number> = { hero: 1.8, model: -1.4, scopes: 2.4, journey: -1.5, collaboration: 0, proof: -1.6, "private-share": 1.8, history: 0, finale: 0 };
    const yByScene: Record<string, number> = { hero: 0.4, model: 0, scopes: 1, journey: -0.6, collaboration: 0.5, proof: 0, "private-share": -0.4, history: 0.3, finale: 1.2 };
    const depth = mobile ? 14 : 11;
    return {
      progress,
      position: [(xByScene[name] ?? 0) * (mobile ? 0.45 : 1), yByScene[name] ?? 0, z + depth],
      target: [name === "collaboration" ? 0.8 : 0, 0, z],
    };
  });
}

function animateWorld(
  objects: SceneObjects,
  pointer: THREE.Vector2,
  progressByScene: Record<SceneName, number>,
  scopeIndex: number,
  receiptFocused: boolean,
  elapsed: number,
  delta: number,
) {
  const heroProgress = progressByScene.hero;
  objects.hero.rotation.y = pointer.x * 0.08;
  objects.hero.rotation.x = pointer.y * -0.045;
  objects.heroLayers.forEach((layer, index) => {
    if (index < 3) {
      layer.position.x = (index - 1) * heroProgress * 1.75;
      layer.position.y = (1 - index) * heroProgress * 0.55;
      layer.position.z = -index * 0.6 + heroProgress * index * 1.35;
    }
  });

  const modelProgress = progressByScene.model;
  objects.shares.forEach((share, index) => {
    share.position.z = -2.3 + (1 - modelProgress) * -4;
    share.position.x = (index - 1) * (1.2 + modelProgress * 3);
  });
  objects.repayment.position.x = -6.7 + modelProgress * 5.2;
  objects.repayment.position.z = 1.4 - modelProgress * 2.8;
  objects.balance.position.y = 1 + modelProgress * 1.5;
  objects.balance.rotation.y = modelProgress * -0.12;

  const scopeProgress = progressByScene.scopes;
  const spread = [1.35, 2.35, 1.75][scopeIndex];
  objects.scopeNodes.forEach((node, index) => {
    const angle = scopeIndex === 0 ? (index - 2) * 0.24 : index / objects.scopeNodes.length * Math.PI * 2;
    const targetX = scopeIndex === 0 ? (index - 2) * spread : Math.cos(angle) * spread * 2;
    const targetY = scopeIndex === 2 ? Math.floor(index / 2) * 1.7 - 2.8 : Math.sin(angle) * spread;
    node.position.x = damp(node.position.x, targetX, 7, delta);
    node.position.y = damp(node.position.y, targetY, 7, delta);
    node.position.z = scopeIndex === 1 && index === 4 ? -2.8 : 0.8 + scopeProgress;
  });
  objects.scope.rotation.y = (scopeIndex - 1) * 0.08;

  const collaborationProgress = progressByScene.collaboration;
  objects.ledgerPlane.position.z = collaborationProgress * 1.3;
  objects.chatPlane.position.z = -4.8 + collaborationProgress * 2.2 - pointer.x * 0.7;
  objects.chatPlane.position.x = 4.3 + pointer.x * 0.5;

  const proofProgress = progressByScene.proof;
  const receiptPull = receiptFocused ? 1 : proofProgress;
  objects.receipt.position.x = 3.6 + receiptPull * 2.4;
  objects.receipt.position.z = -1 + receiptPull * 3.1;
  objects.receipt.rotation.y = -0.12 - receiptPull * 0.2 + pointer.x * 0.035;
  objects.receipt.rotation.x = -0.08 + pointer.y * 0.025;
  const hovered = Boolean(objects.receipt.userData.hovered);
  objects.receipt.scale.setScalar(damp(objects.receipt.scale.x, hovered ? 1.06 : 1, 10, delta));

  const historyProgress = progressByScene.history;
  objects.history.position.x = Math.sin(historyProgress * Math.PI) * -1.4;
  objects.archive.position.z = historyProgress * 7;
  objects.searchRecords.forEach((record, index) => {
    record.position.z = 2 + historyProgress * (5 + index);
  });

  const finaleProgress = progressByScene.finale;
  objects.finale.rotation.y = (1 - finaleProgress) * 0.18;
  objects.finaleSettled.position.z = 1.4 - finaleProgress * 1.05;
  objects.finaleOpen.position.z = 2.2 + finaleProgress * 1.4;
  objects.finaleOpen.position.y = -1.6 + Math.sin(elapsed * 0.7) * 0.035;
}

export function ThreeLandingCanvas({ onReadyChange }: { onReadyChange: (ready: boolean) => void }) {
  const host = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const target = host.current;
    if (!target) return;
    let renderer: THREE.WebGLRenderer;
    try {
      renderer = new THREE.WebGLRenderer({ alpha: true, antialias: true, powerPreference: "high-performance" });
    } catch {
      onReadyChange(false);
      return;
    }

    const colors = readColors();
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.75));
    renderer.setSize(window.innerWidth, window.innerHeight);
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 0.96;
    renderer.shadowMap.enabled = window.innerWidth >= 768;
    renderer.shadowMap.type = THREE.PCFShadowMap;
    renderer.domElement.setAttribute("aria-hidden", "true");
    renderer.domElement.tabIndex = -1;
    target.append(renderer.domElement);

    const scene = new THREE.Scene();
    scene.fog = new THREE.Fog(colors.paper, 15, 37);
    const camera = new THREE.PerspectiveCamera(38, window.innerWidth / window.innerHeight, 0.1, 48);
    const { root, objects } = buildWorld(colors);
    objects.archive.count = window.innerWidth < 768 ? 14 : 28;
    scene.add(root);
    scene.add(new THREE.HemisphereLight(colors.surface, colors.ink, 2.15));
    const key = new THREE.DirectionalLight(colors.surface, 4.4);
    key.position.set(-7, 11, 9);
    key.castShadow = true;
    key.shadow.mapSize.set(1024, 1024);
    key.shadow.camera.near = 1;
    key.shadow.camera.far = 40;
    scene.add(key);
    const blueFill = new THREE.DirectionalLight(colors.blue, 2.2);
    blueFill.position.set(8, -3, 6);
    scene.add(blueFill);

    const pointerTarget = new THREE.Vector2();
    const pointer = new THREE.Vector2();
    const raycaster = new THREE.Raycaster();
    const lookAt = new THREE.Vector3();
    let scopeIndex = 0;
    let receiptFocused = false;
    let cameraCues = buildCameraCues(window.innerWidth < 768);
    let progressTarget = clamp01(window.scrollY / Math.max(document.documentElement.scrollHeight - window.innerHeight, 1));
    let progress = progressTarget;
    let frame = 0;
    let lastTime = performance.now();
    let visible = document.visibilityState !== "hidden";
    const progressByScene = Object.fromEntries(sceneNames.map((name) => [name, progressFor(name)])) as Record<SceneName, number>;

    const onScroll = () => {
      progressTarget = clamp01(window.scrollY / Math.max(document.documentElement.scrollHeight - window.innerHeight, 1));
      sceneNames.forEach((name) => {
        progressByScene[name] = progressFor(name);
      });
    };
    const onPointerMove = (event: PointerEvent) => {
      if (!window.matchMedia("(hover: hover) and (pointer: fine)").matches) return;
      pointerTarget.set(event.clientX / window.innerWidth * 2 - 1, -(event.clientY / window.innerHeight * 2 - 1));
    };
    const onPointerLeave = () => pointerTarget.set(0, 0);
    const onResize = () => {
      renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.75));
      renderer.setSize(window.innerWidth, window.innerHeight);
      camera.aspect = window.innerWidth / window.innerHeight;
      camera.updateProjectionMatrix();
      cameraCues = buildCameraCues(window.innerWidth < 768);
      objects.archive.count = window.innerWidth < 768 ? 14 : 28;
      onScroll();
    };
    const onVisibility = () => {
      visible = document.visibilityState !== "hidden";
      if (visible && !frame) {
        lastTime = performance.now();
        frame = requestAnimationFrame(renderFrame);
      }
    };
    const onScope = (event: Event) => {
      const id = (event as CustomEvent<string>).detail;
      scopeIndex = id === "groups" ? 1 : id === "organizations" ? 2 : 0;
    };
    const onReceipt = (event: Event) => {
      receiptFocused = Boolean((event as CustomEvent<boolean>).detail);
    };
    const onContextLost = (event: Event) => {
      event.preventDefault();
      visible = false;
      onReadyChange(false);
    };

    function renderFrame(time: number) {
      frame = 0;
      if (!visible) return;
      const delta = Math.min((time - lastTime) / 1000, 0.1);
      lastTime = time;
      progress = damp(progress, progressTarget, 9, delta);
      pointer.x = damp(pointer.x, pointerTarget.x, 7, delta);
      pointer.y = damp(pointer.y, pointerTarget.y, 7, delta);
      const path = sampleCameraPath(cameraCues, progress);
      camera.position.x = damp(camera.position.x, path.position[0] + pointer.x * (window.innerWidth < 768 ? 0 : 0.65), 8, delta);
      camera.position.y = damp(camera.position.y, path.position[1] + pointer.y * 0.38, 8, delta);
      camera.position.z = damp(camera.position.z, path.position[2], 8, delta);
      lookAt.set(path.target[0] + pointer.x * 0.22, path.target[1] + pointer.y * 0.14, path.target[2]);
      camera.lookAt(lookAt);
      raycaster.setFromCamera(pointer, camera);
      const hit = raycaster.intersectObjects(objects.hoverables, true)[0]?.object;
      objects.hoverables.forEach((object) => {
        object.userData.hovered = Boolean(hit && (object === hit || object.children.includes(hit)));
      });
      animateWorld(objects, pointer, progressByScene, scopeIndex, receiptFocused, time / 1000, delta);
      renderer.render(scene, camera);
      frame = requestAnimationFrame(renderFrame);
    }

    window.addEventListener("scroll", onScroll, { passive: true });
    window.addEventListener("resize", onResize, { passive: true });
    window.addEventListener("pointermove", onPointerMove, { passive: true });
    window.addEventListener("pointerleave", onPointerLeave, { passive: true });
    window.addEventListener("zplit:scope", onScope);
    window.addEventListener("zplit:receipt", onReceipt);
    document.addEventListener("visibilitychange", onVisibility);
    renderer.domElement.addEventListener("webglcontextlost", onContextLost);
    camera.position.fromArray(cameraCues[0].position);
    camera.lookAt(...cameraCues[0].target);
    onReadyChange(true);
    frame = requestAnimationFrame(renderFrame);

    return () => {
      visible = false;
      if (frame) cancelAnimationFrame(frame);
      window.removeEventListener("scroll", onScroll);
      window.removeEventListener("resize", onResize);
      window.removeEventListener("pointermove", onPointerMove);
      window.removeEventListener("pointerleave", onPointerLeave);
      window.removeEventListener("zplit:scope", onScope);
      window.removeEventListener("zplit:receipt", onReceipt);
      document.removeEventListener("visibilitychange", onVisibility);
      renderer.domElement.removeEventListener("webglcontextlost", onContextLost);
      scene.traverse((object) => {
        if (object instanceof THREE.Mesh || object instanceof THREE.Line || object instanceof THREE.LineSegments) {
          object.geometry.dispose();
          const materials = Array.isArray(object.material) ? object.material : [object.material];
          materials.forEach((material) => {
            if ("map" in material && material.map instanceof THREE.Texture) material.map.dispose();
            material.dispose();
          });
        }
      });
      renderer.dispose();
      renderer.forceContextLoss();
      renderer.domElement.remove();
      onReadyChange(false);
    };
  }, [onReadyChange]);

  return <div className="landing-webgl" ref={host} aria-hidden="true" data-three-landing-canvas />;
}
