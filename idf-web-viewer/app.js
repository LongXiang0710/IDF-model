/* global THREE, SKEY_CATALOG */
(() => {
  'use strict';

  const TYPE_MAP = {
    35: ['弯头', 'elbow'], 36: ['弯头', 'elbow'],
    40: ['分支连接', 'branch'], 41: ['支管座', 'branch'], 42: ['分支连接', 'branch'],
    45: ['三通/支管', 'branch'], 46: ['三通/支管', 'branch'], 47: ['三通/支管', 'branch'], 50: ['阀门', 'valve'], 55: ['异径管', 'reducer'],
    90: ['仪表/端点', 'instrument'], 95: ['特殊管件', 'misc'], 96: ['特殊管件', 'misc'], 100: ['直管', 'pipe'], 105: ['法兰', 'flange'], 107: ['法兰', 'flange'],
    110: ['焊口/法兰', 'flange'], 115: ['注释/连接', 'flange'], 120: ['端部连接', 'flange'],
    125: ['管帽', 'misc'], 127: ['活接头', 'misc'], 130: ['阀门', 'valve'], 136: ['过滤器', 'misc'], 137: ['过滤器', 'misc'],
    150: ['特殊元件', 'valve'], 250: ['工程连接记录', 'misc']
  };
  const COLORS = { pipe: 0x008f99, elbow: 0xe36f00, branch: 0x7a49d6, reducer: 0xdc3f69, valve: 0xb18400, flange: 0x256fe3, instrument: 0x168a57, misc: 0x60747c };
  const state = {
    pipelines: [], components: [], nodes: [], view: 'solid', filters: new Set(Object.keys(COLORS)), selectedPipeline: null,
    selectedComponent: null, selectedObject: null, isolatedComponent: null, hiddenComponents: new Set(), translucentComponents: new Set()
  };
  const el = id => document.getElementById(id);

  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0xffffff);
  scene.fog = new THREE.FogExp2(0xffffff, 0.0025);
  const camera = new THREE.PerspectiveCamera(44, 1, 0.01, 10000);
  camera.position.set(70, 65, 85);
  const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
  renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
  renderer.outputEncoding = THREE.sRGBEncoding;
  renderer.domElement.setAttribute('aria-label', 'IDF 管道三维模型视图');
  el('viewport').appendChild(renderer.domElement);
  const controls = new THREE.OrbitControls(camera, renderer.domElement);
  controls.enableDamping = true;
  controls.dampingFactor = .08;
  controls.screenSpacePanning = true;
  controls.autoRotateSpeed = .8;
  controls.minDistance = 0;
  controls.maxDistance = Infinity;
  controls.zoomSpeed = 1.2;
  controls.enableZoom = false;
  controls.addEventListener('change', updateCameraClipping);
  const ambient = new THREE.HemisphereLight(0xffffff, 0xd8e0e3, 1.25);
  scene.add(ambient);
  const keyLight = new THREE.DirectionalLight(0xffffff, .85); keyLight.position.set(50, 100, 80); scene.add(keyLight);
  const modelGroup = new THREE.Group(); scene.add(modelGroup);
  const axis = new THREE.AxesHelper(18); scene.add(axis);
  const grid = new THREE.GridHelper(200, 40, 0xcbd4d8, 0xe7ecee); grid.material.opacity = .8; grid.material.transparent = true; scene.add(grid);
  const raycaster = new THREE.Raycaster();
  raycaster.params.Line.threshold = .75;
  const pointer = new THREE.Vector2();
  let selectionHelper = null;
  let zoomAnchor = null;
  let wheelZoomAnchor = null;
  let wheelZoomTimer = null;
  let normalized = { center: new THREE.Vector3(), scale: 1 };

  function classify(code, skey) {
    const rawKey = (skey || '').trim().toUpperCase();
    const key = rawKey === '—' ? '' : rawKey;
    const info = SKEY_CATALOG.lookup(key);
    if (info) return [info.name, info.category, info];
    if (key.startsWith('EL')) return ['弯头', 'elbow'];
    if (key.includes('FL')) return ['法兰', 'flange'];
    if (key.includes('RC') || key.includes('RE')) return ['异径管', 'reducer'];
    if (key && !['FLOW', 'IDFL', 'BW'].includes(key) && code !== 100) return ['管件', 'valve'];
    return TYPE_MAP[code] || ['管件', 'valve'];
  }

  function parseIdf(text, filename) {
    const lines = text.replace(/\r/g, '').split('\n');
    const unit = lines.some(line => /^\s*-207\s+MM\b/.test(line)) ? 'MM' : 'UNKNOWN';
    let lineName = filename.replace(/\.idf$/i, '');
    const nameIndex = lines.findIndex(line => /^\s*-600\s+/.test(line));
    if (nameIndex >= 0) {
      const parts = [lines[nameIndex].replace(/^\s*-600\s+/, '').trim()];
      for (let i = nameIndex + 1; i < Math.min(nameIndex + 4, lines.length) && /^\s*-1\s+/.test(lines[i]); i++) parts.push(lines[i].replace(/^\s*-1\s+/, '').trim());
      lineName = parts.join('');
    }
    const readRecord = (index, code) => {
      const values = [lines[index].replace(new RegExp(`^\\s*${code}\\s*`), '').trim()];
      let end = index;
      while (end + 1 < lines.length && /^\s*-1\s+/.test(lines[end + 1])) {
        end++; values.push(lines[end].replace(/^\s*-1\s+/, '').trim());
      }
      return { value: values.join(''), end };
    };
    const materials = [];
    for (let i = 0; i < lines.length; i++) {
      if (!/^\s*-20\s+/.test(lines[i])) continue;
      const codeRecord = readRecord(i, -20); i = codeRecord.end;
      if (i + 1 < lines.length && /^\s*-21\s+/.test(lines[i + 1])) {
        const descRecord = readRecord(i + 1, -21); i = descRecord.end;
        materials.push({ code: codeRecord.value, description: descRecord.value });
      }
    }
    const components = [];
    let currentSpec = '未提供', lastComponent = null;
    lines.forEach((line, lineIndex) => {
      if (/^\s*-26\s+/.test(line)) { currentSpec = readRecord(lineIndex, -26).value || currentSpec; return; }
      if (/^\s*-39\s+/.test(line) && lastComponent) { lastComponent.materialRef = readRecord(lineIndex, -39).value; return; }
      if (/^\s*-37\s+/.test(line) && lastComponent) { lastComponent.rawDescription = readRecord(lineIndex, -37).value; return; }
      if (!line.includes(',')) return;
      const head = line.split(',')[0].trim();
      const tokens = head.split(/\s+/);
      if (tokens.length < 9 || !tokens.slice(0, 9).every(v => /^-?\d+$/.test(v))) return;
      const nums = tokens.slice(0, 9).map(Number);
      const [code, x1, y1, z1, x2, y2, z2, diameter, sequence] = nums;
      if (code <= 0 || code === 149 || code === 300 || code === 999) return;
      const tail = line.split(',').slice(1).map(v => v.trim());
      const skey = tail[2] || '';
      const [label, category, skeyInfo] = classify(code, skey);
      const hasEnd = x2 !== 0 || y2 !== 0 || z2 !== 0;
      const start = [x1, y1, z1], end = hasEnd ? [x2, y2, z2] : [x1, y1, z1];
      if (!start.some(Number.isFinite) || !end.some(Number.isFinite)) return;
      lastComponent = { id: `${filename}:${lineIndex}`, code, label, category, skeyInfo: skeyInfo || null, start, end, diameter, sequence, skey: skey || '—', line: lineIndex + 1, filename, pipingClass: currentSpec, materialRef: '未提供', rawDescription: '' };
      components.push(lastComponent);
    });
    assignNominalSpecifications(components);
    components.forEach(c => applyMaterialInfo(c, materials));
    return { id: filename, filename, name: lineName, unit, components };
  }

  function materialKeywords(c) {
    if (c.code === 110) return ['GASKET'];
    if (c.code === 115) return ['BOLT', 'NUT'];
    const skey = c.skey || '';
    if (skey === 'FLBL') return ['BLIND FLANGE'];
    if (skey === 'FLWN') return ['WELDING NECK FLANGE', 'WELD NECK FLANGE'];
    if (skey === 'FLSW') return ['SOCKET WELD FLANGE', 'SW FLANGE'];
    if (skey.startsWith('EL')) return ['ELBOW'];
    if (skey.startsWith('TE')) return ['TEE'];
    if (skey.startsWith('SK')) return ['SOCKOLET', 'SOCKET OUTLET'];
    if (skey.startsWith('WT')) return ['WELDOLET', 'WELD OUTLET'];
    if (/^(RC|RE|RN)/.test(skey)) return ['REDUCER'];
    if (skey.startsWith('VT')) return ['GATE VALVE'];
    if (skey.startsWith('VC')) return ['CHECK VALVE'];
    if (skey.startsWith('VG')) return ['GLOBE VALVE'];
    if (skey.startsWith('VY')) return ['BUTTERFLY VALVE'];
    if (c.category === 'pipe') return [' PIPE', 'PIPE,'];
    if (c.category === 'flange') return ['FLANGE'];
    if (c.category === 'valve') return ['VALVE'];
    return [];
  }

  function assignNominalSpecifications(components) {
    const pointMap = new Map();
    const keyOf = point => point.join('|');
    const spatial = c => [...c.start, ...c.end].some(value => Number.isFinite(value) && Math.abs(value) > 1e-6);
    components.filter(c => spatial(c) && c.diameter > 0).forEach(c => {
      const keys = new Set([keyOf(c.start), keyOf(c.end)]);
      keys.forEach(key => { if (!pointMap.has(key)) pointMap.set(key, []); pointMap.get(key).push(c); });
    });
    const diameterAt = (component, point) => {
      const connected = (pointMap.get(keyOf(point)) || []).filter(other => other.id !== component.id && other.diameter > 0);
      const preferred = connected.filter(other => other.category === 'pipe');
      const candidates = (preferred.length ? preferred : connected).map(other => Math.abs(other.diameter));
      if (!candidates.length) return Math.abs(component.diameter) || 0;
      const counts = new Map(); candidates.forEach(value => counts.set(value, (counts.get(value) || 0) + 1));
      return [...counts].sort((a, b) => b[1] - a[1] || b[0] - a[0])[0][0];
    };
    components.forEach(c => {
      const own = Math.abs(c.diameter) || 0;
      if (c.category === 'reducer') {
        c.startDiameter = own;
        c.endDiameter = spatial(c) ? diameterAt(c, c.end) : own;
      } else if (c.category === 'branch' && keyOf(c.start) !== keyOf(c.end)) {
        c.startDiameter = spatial(c) ? diameterAt(c, c.start) : own;
        c.endDiameter = own;
      } else {
        c.startDiameter = own;
        c.endDiameter = own;
      }
      const sizes = [c.startDiameter, c.endDiameter].filter(Boolean);
      const largest = sizes.length ? Math.max(...sizes) : 0;
      const smallest = sizes.length ? Math.min(...sizes) : 0;
      c.isReducing = c.category === 'reducer' && Boolean(largest && smallest && largest !== smallest);
      const hasMultipleSizes = ['reducer', 'branch'].includes(c.category) && largest && smallest && largest !== smallest;
      c.specification = hasMultipleSizes ? `DN${largest}×${smallest}` : `DN${own || largest || '—'}`;
      c.specificationSource = c.isReducing ? '起点记录口径 × 终点连接口径' : (hasMultipleSizes ? '主管口径 × 支管口径' : 'IDF 公称直径');
    });
  }

  function applyMaterialInfo(c, materials) {
    const dn = new RegExp(`\\bDN\\s*0*${Math.abs(c.diameter)}(?!\\d)`, 'i');
    const keywords = materialKeywords(c);
    let best = null, bestScore = -1;
    materials.forEach(entry => {
      const description = entry.description.toUpperCase();
      let score = dn.test(description) ? 8 : 0;
      if (keywords.some(keyword => description.includes(keyword))) score += 7;
      if (score > bestScore) { best = entry; bestScore = score; }
    });
    const info = c.skeyInfo || SKEY_CATALOG.lookup(c.skey);
    c.materialCode = bestScore >= 7 ? best.code : (c.materialRef || '未提供');
    c.materialDescription = c.rawDescription || (bestScore >= 7 ? best.description : `${info?.name || c.label}，${c.specification || `DN${c.diameter}`}`);
    c.materialMatch = bestScore >= 15 ? 'DN + 类型匹配' : bestScore >= 7 ? '类型匹配' : 'IDF 元件属性';
  }

  function hasSpatialGeometry(c) {
    const coordinates = [...c.start, ...c.end];
    return coordinates.every(Number.isFinite) && coordinates.some(value => Math.abs(value) > 1e-6);
  }

  function rebuildTopology() {
    const visible = state.selectedPipeline ? state.pipelines.filter(p => p.id === state.selectedPipeline) : state.pipelines;
    state.components = visible.flatMap(p => p.components);
    const map = new Map();
    state.components.filter(hasSpatialGeometry).forEach(c => {
      [c.start, c.end].forEach(point => {
        const key = point.join('|');
        if (!map.has(key)) map.set(key, { id: key, point, degree: 0 });
        map.get(key).degree++;
      });
    });
    state.nodes = [...map.values()];
  }

  function clearGroup() {
    while (modelGroup.children.length) {
      const obj = modelGroup.children.pop();
      obj.traverse(child => { if (child.geometry) child.geometry.dispose(); if (child.material) child.material.dispose(); });
    }
  }

  function computeNormalization() {
    const box = new THREE.Box3();
    const projectComponents = state.pipelines.flatMap(p => p.components);
    projectComponents.filter(hasSpatialGeometry).forEach(c => { box.expandByPoint(new THREE.Vector3(...c.start)); box.expandByPoint(new THREE.Vector3(...c.end)); });
    if (box.isEmpty()) return { center: new THREE.Vector3(), scale: 1 };
    const size = box.getSize(new THREE.Vector3());
    return { center: box.getCenter(new THREE.Vector3()), scale: 120 / Math.max(size.x, size.y, size.z, 1) };
  }

  function worldPoint(point) {
    const p = new THREE.Vector3(point[0], point[2], -point[1]);
    const c = new THREE.Vector3(normalized.center.x, normalized.center.z, -normalized.center.y);
    return p.sub(c).multiplyScalar(normalized.scale);
  }

  function makeCylinder(a, b, radius, material) {
    const dir = new THREE.Vector3().subVectors(b, a); const len = dir.length();
    if (len < .001) return null;
    const mesh = new THREE.Mesh(new THREE.CylinderGeometry(radius, radius, len, 10, 1, false), material);
    mesh.position.copy(a).add(b).multiplyScalar(.5);
    mesh.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir.normalize());
    return mesh;
  }

  function alignGroup(group, a, b) {
    const dir = new THREE.Vector3().subVectors(b, a);
    group.position.copy(a).add(b).multiplyScalar(.5);
    if (dir.lengthSq() > 1e-8) group.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir.normalize());
    return group;
  }

  function mesh(geometry, material, position) {
    const result = new THREE.Mesh(geometry, material);
    if (position) result.position.set(...position);
    return result;
  }

  function makeElbow(a, b, radius, material) {
    const chord = new THREE.Vector3().subVectors(b, a);
    if (chord.length() < .001) return mesh(new THREE.SphereGeometry(radius * 1.25, 12, 8), material, a.toArray());
    let normal = new THREE.Vector3().crossVectors(chord, new THREE.Vector3(0, 1, 0));
    if (normal.lengthSq() < .001) normal.crossVectors(chord, new THREE.Vector3(1, 0, 0));
    normal.normalize().multiplyScalar(Math.min(chord.length() * .22, radius * 2.5));
    const control = a.clone().add(b).multiplyScalar(.5).add(normal);
    return mesh(new THREE.TubeGeometry(new THREE.QuadraticBezierCurve3(a, control, b), 8, radius, 8, false), material);
  }

  function makeReducer(a, b, radius, material, eccentric = false) {
    const dir = new THREE.Vector3().subVectors(b, a); const len = Math.max(dir.length(), radius * 2);
    const group = alignGroup(new THREE.Group(), a, b);
    const body = mesh(new THREE.CylinderGeometry(radius * .62, radius * 1.18, len, 12, 1, false), material);
    if (eccentric) body.position.x = radius * .25;
    group.add(body); return group;
  }

  function makeFlange(a, b, radius, material, skey) {
    const len = Math.max(a.distanceTo(b), radius * 1.5); const group = alignGroup(new THREE.Group(), a, b);
    group.add(mesh(new THREE.CylinderGeometry(radius * .72, radius * .72, len, 10), material));
    const disc = () => mesh(new THREE.CylinderGeometry(radius * 1.55, radius * 1.55, Math.max(.18, radius * .35), 14), material);
    const d1 = disc(); d1.position.y = -len * .42; group.add(d1);
    const d2 = disc(); d2.position.y = len * .42; group.add(d2);
    if (skey === 'FLBL') { const cap = disc(); cap.scale.y = 1.8; group.add(cap); }
    return group;
  }

  function makeBranch(a, b, radius, material, skey) {
    const len = Math.max(a.distanceTo(b), radius * 2); const group = alignGroup(new THREE.Group(), a, b);
    group.add(mesh(new THREE.CylinderGeometry(radius, radius, len, 9), material));
    const neck = mesh(new THREE.CylinderGeometry(radius * .65, radius * .8, radius * 3.2, 9), material, [radius * 1.6, 0, 0]);
    neck.rotation.z = Math.PI / 2; group.add(neck);
    const bead = mesh(new THREE.TorusGeometry(radius * .86, Math.max(.08, radius * .16), 5, 10), material, [radius * 3.05, 0, 0]);
    bead.rotation.y = Math.PI / 2; group.add(bead);
    if (skey === 'TERF') { const pad = mesh(new THREE.CylinderGeometry(radius * 1.5, radius * 1.5, radius * .25, 12), material); pad.rotation.z = Math.PI / 2; pad.position.x = radius * .25; group.add(pad); }
    return group;
  }

  function makeValve(a, b, radius, material, skey) {
    const len = Math.max(a.distanceTo(b), radius * 3.4); const group = alignGroup(new THREE.Group(), a, b);
    group.add(mesh(new THREE.CylinderGeometry(radius * .62, radius * .62, len, 9), material));
    if (skey.startsWith('VY')) {
      group.add(mesh(new THREE.CylinderGeometry(radius * 1.45, radius * 1.45, radius * .55, 16), material));
      const plate = mesh(new THREE.BoxGeometry(radius * 2.35, radius * .25, radius * .18), material); group.add(plate);
    } else if (skey.startsWith('VC')) {
      const body = mesh(new THREE.CylinderGeometry(radius * 1.35, radius * 1.05, len * .45, 10), material); group.add(body);
      const arrow = mesh(new THREE.ConeGeometry(radius * .6, radius * 1.2, 8), material, [0, len * .05, 0]); group.add(arrow);
    } else {
      const lower = mesh(new THREE.ConeGeometry(radius * 1.35, len * .42, 8), material, [0, -len * .2, 0]); group.add(lower);
      const upper = mesh(new THREE.ConeGeometry(radius * 1.35, len * .42, 8), material, [0, len * .2, 0]); upper.rotation.z = Math.PI; group.add(upper);
    }
    const stem = mesh(new THREE.CylinderGeometry(radius * .15, radius * .15, radius * 3, 7), material, [radius * 1.5, 0, 0]); stem.rotation.z = Math.PI / 2; group.add(stem);
    const wheel = mesh(new THREE.TorusGeometry(radius * 1.05, Math.max(.06, radius * .13), 6, 12), material, [radius * 3, 0, 0]); wheel.rotation.y = Math.PI / 2; group.add(wheel);
    return group;
  }

  function makeInstrument(a, b, radius, material) {
    const anchor = a.clone().add(b).multiplyScalar(.5); const group = new THREE.Group(); group.position.copy(anchor);
    const stem = mesh(new THREE.CylinderGeometry(radius * .13, radius * .13, radius * 2.2, 7), material, [0, radius, 0]); group.add(stem);
    const dial = mesh(new THREE.CylinderGeometry(radius * 1.3, radius * 1.3, radius * .3, 16), material, [0, radius * 2.5, 0]); dial.rotation.x = Math.PI / 2; group.add(dial);
    const rim = mesh(new THREE.TorusGeometry(radius * 1.32, Math.max(.06, radius * .12), 6, 16), material, [0, radius * 2.5, radius * .17]); group.add(rim);
    return group;
  }

  function makeMisc(a, b, radius, material, skey) {
    const group = alignGroup(new THREE.Group(), a, b); const len = Math.max(a.distanceTo(b), radius * 1.8);
    group.add(mesh(new THREE.CylinderGeometry(radius, radius, len, 10), material));
    if (skey.startsWith('KA')) group.add(mesh(new THREE.SphereGeometry(radius * 1.25, 10, 7), material, [0, len * .48, 0]));
    else if (skey === 'SB') {
      const ring1 = mesh(new THREE.TorusGeometry(radius * 1.2, radius * .18, 5, 12), material, [-radius * 1.15, 0, 0]); ring1.rotation.x = Math.PI / 2; group.add(ring1);
      const ring2 = mesh(new THREE.TorusGeometry(radius * 1.2, radius * .18, 5, 12), material, [radius * 1.15, 0, 0]); ring2.rotation.x = Math.PI / 2; group.add(ring2);
    } else group.add(mesh(new THREE.SphereGeometry(radius * 1.25, 10, 7), material));
    return group;
  }

  function makeComponentObject(c, material) {
    const a = worldPoint(c.start), b = worldPoint(c.end);
    const radius = Math.max(.16, Math.min(1.4, c.diameter * normalized.scale * .5));
    let object;
    if (c.category === 'elbow') object = makeElbow(a, b, radius, material);
    else if (c.category === 'branch') object = makeBranch(a, b, radius, material, c.skey);
    else if (c.category === 'reducer') object = makeReducer(a, b, radius, material, c.skey.startsWith('RE'));
    else if (c.category === 'valve') object = makeValve(a, b, radius, material, c.skey);
    else if (c.category === 'flange') object = makeFlange(a, b, radius, material, c.skey);
    else if (c.category === 'instrument') object = makeInstrument(a, b, radius, material);
    else if (c.category === 'misc') object = makeMisc(a, b, radius, material, c.skey);
    else object = makeCylinder(a, b, radius, material) || mesh(new THREE.SphereGeometry(radius, 8, 6), material, a.toArray());
    const root = object.isGroup ? object : new THREE.Group().add(object);
    root.userData.component = c;
    root.traverse(child => { child.userData.componentRoot = root; child.userData.component = c; });
    return root;
  }

  function renderOverview() {
    const positions = Object.fromEntries(Object.keys(COLORS).map(key => [key, []]));
    const componentMap = Object.fromEntries(Object.keys(COLORS).map(key => [key, []]));
    state.components.forEach(c => {
      if (!hasSpatialGeometry(c)) return;
      if (!state.filters.has(c.category) || state.hiddenComponents.has(c.id)) return;
      const a = worldPoint(c.start), b = worldPoint(c.end);
      if (a.distanceToSquared(b) < .0001) b.y += .32;
      positions[c.category].push(a.x,a.y,a.z,b.x,b.y,b.z);
      componentMap[c.category].push(c);
    });
    Object.entries(positions).forEach(([category, values]) => {
      if (!values.length) return;
      const geometry = new THREE.BufferGeometry(); geometry.setAttribute('position', new THREE.Float32BufferAttribute(values, 3));
      const lines = new THREE.LineSegments(geometry, new THREE.LineBasicMaterial({ color: COLORS[category], transparent: true, opacity: category === 'pipe' ? .72 : .95 }));
      lines.userData.components = componentMap[category]; modelGroup.add(lines);
    });
    if (state.view === 'topology') {
      const nodeValues = state.nodes.flatMap(n => worldPoint(n.point).toArray());
      const geometry = new THREE.BufferGeometry(); geometry.setAttribute('position', new THREE.Float32BufferAttribute(nodeValues, 3));
      modelGroup.add(new THREE.Points(geometry, new THREE.PointsMaterial({ color: 0x40545c, size: .45, sizeAttenuation: true, transparent: true, opacity: .8 })));
    }
  }

  function renderModel(fit = false) {
    clearGroup();
    if (selectionHelper) { scene.remove(selectionHelper); selectionHelper.geometry?.dispose(); selectionHelper.material?.dispose(); selectionHelper = null; }
    state.selectedObject = null;
    if (!state.components.length) { el('emptyState').classList.remove('hidden'); return; }
    el('emptyState').classList.add('hidden');
    normalized = computeNormalization();
    const materials = {};
    Object.entries(COLORS).forEach(([key, color]) => materials[key] = new THREE.MeshStandardMaterial({ color, roughness: .42, metalness: .25, transparent: true, opacity: .92 }));

    const overview = !state.selectedPipeline && state.components.length > 1200;
    el('lodHint').classList.toggle('show', overview);
    if (overview) {
      renderOverview();
    } else if (state.view === 'solid') {
      state.components.forEach(c => {
        if (!hasSpatialGeometry(c)) return;
        if (!state.filters.has(c.category)) return;
        const material = state.translucentComponents.has(c.id) ? materials[c.category].clone() : materials[c.category];
        if (state.translucentComponents.has(c.id)) material.opacity = .22;
        const object = makeComponentObject(c, material);
        object.visible = !state.hiddenComponents.has(c.id) && (!state.isolatedComponent || state.isolatedComponent === c.id);
        modelGroup.add(object);
        if (state.selectedComponent?.id === c.id) state.selectedObject = object;
      });
    } else {
      state.components.forEach(c => {
        if (!hasSpatialGeometry(c)) return;
        if (!state.filters.has(c.category)) return;
        if (state.hiddenComponents.has(c.id) || (state.isolatedComponent && state.isolatedComponent !== c.id)) return;
        const geometry = new THREE.BufferGeometry().setFromPoints([worldPoint(c.start), worldPoint(c.end)]);
        const line = new THREE.Line(geometry, new THREE.LineBasicMaterial({ color: COLORS[c.category], transparent: true, opacity: state.translucentComponents.has(c.id) ? .2 : .78 }));
        line.userData.component = c; line.userData.componentRoot = line; modelGroup.add(line);
        if (state.selectedComponent?.id === c.id) state.selectedObject = line;
      });
      const nodeMat = new THREE.MeshBasicMaterial({ color: 0x40545c });
      state.nodes.forEach(n => {
        const mesh = new THREE.Mesh(new THREE.SphereGeometry(n.degree > 2 ? .65 : .35, 10, 8), nodeMat);
        mesh.position.copy(worldPoint(n.point)); modelGroup.add(mesh);
      });
    }
    if (state.selectedObject?.visible) showSelectionHelper(state.selectedObject);
    updateStats();
    if (fit) fitCamera();
  }

  function fitCamera() {
    if (!state.components.some(hasSpatialGeometry) || !modelGroup.children.length) return;
    const focusBox = new THREE.Box3().setFromObject(modelGroup); const focusSphere = focusBox.getBoundingSphere(new THREE.Sphere());
    const projectBox = new THREE.Box3();
    state.pipelines.flatMap(p => p.components).filter(hasSpatialGeometry).forEach(c => {
      projectBox.expandByPoint(worldPoint(c.start)); projectBox.expandByPoint(worldPoint(c.end));
    });
    const projectSphere = projectBox.getBoundingSphere(new THREE.Sphere());
    const distance = Math.max(35, projectSphere.radius / Math.sin(THREE.MathUtils.degToRad(camera.fov / 2)) * .75);
    controls.target.copy(focusSphere.center); camera.position.copy(focusSphere.center).add(new THREE.Vector3(distance * .75, distance * .62, distance));
    updateCameraClipping(); controls.update();
  }

  function showSelectionHelper(object) {
    if (selectionHelper) { scene.remove(selectionHelper); selectionHelper.geometry?.dispose(); selectionHelper.material?.dispose(); }
    selectionHelper = new THREE.BoxHelper(object, 0x263238);
    selectionHelper.material.transparent = true; selectionHelper.material.opacity = .75; selectionHelper.material.depthTest = false;
    scene.add(selectionHelper);
  }

  function updateReviewButtons() {
    const disabled = !state.selectedComponent;
    ['hideButton','isolateButton','translucentButton'].forEach(id => { el(id).disabled = disabled; });
    el('focusButton').disabled = !state.selectedObject;
    el('isolateButton').classList.toggle('active', Boolean(state.isolatedComponent));
    el('translucentButton').classList.toggle('active', Boolean(state.selectedComponent && state.translucentComponents.has(state.selectedComponent.id)));
  }

  function clearSelection() {
    state.selectedComponent = null; state.selectedObject = null;
    if (selectionHelper) { scene.remove(selectionHelper); selectionHelper.geometry?.dispose(); selectionHelper.material?.dispose(); selectionHelper = null; }
    el('selectedType').textContent = '—'; el('inspector').innerHTML = '<div><dt>状态</dt><dd>点击模型查看属性</dd></div>';
    updateReviewButtons();
  }

  function selectObject(object, component) {
    state.selectedObject = object; state.selectedComponent = component;
    if (object) showSelectionHelper(object); else if (selectionHelper) { scene.remove(selectionHelper); selectionHelper = null; }
    inspect(component); updateReviewButtons();
  }

  function focusSelection() {
    if (!state.selectedObject) return;
    const box = new THREE.Box3().setFromObject(state.selectedObject); const sphere = box.getBoundingSphere(new THREE.Sphere());
    const distance = Math.max(Number.EPSILON, sphere.radius / Math.sin(THREE.MathUtils.degToRad(camera.fov / 2)) * 1.7);
    const direction = camera.position.clone().sub(sphere.center);
    if (direction.lengthSq() < Number.EPSILON) direction.set(.75, .62, 1);
    direction.normalize(); controls.target.copy(sphere.center); camera.position.copy(sphere.center).add(direction.multiplyScalar(distance)); controls.update();
  }

  function selectedCenter() {
    if (!state.selectedObject?.visible) return null;
    const box = new THREE.Box3().setFromObject(state.selectedObject);
    return box.isEmpty() ? null : box.getCenter(new THREE.Vector3());
  }

  function zoom(factor, anchor = zoomAnchor || selectedCenter() || controls.target) {
    camera.position.sub(anchor).multiplyScalar(factor).add(anchor);
    controls.target.sub(anchor).multiplyScalar(factor).add(anchor);
    updateCameraClipping(); controls.update();
  }

  function finishWheelZoom() {
    if (wheelZoomTimer) clearTimeout(wheelZoomTimer);
    wheelZoomAnchor = null;
    wheelZoomTimer = null;
  }

  function updateCameraClipping() {
    const distance = Math.max(Number.EPSILON, camera.position.distanceTo(controls.target));
    const near = Math.max(Number.EPSILON, distance * .00001);
    const far = Math.max(10000, distance * 100);
    if (camera.near === near && camera.far === far) return;
    camera.near = near;
    camera.far = far;
    camera.updateProjectionMatrix();
  }

  function hideSelection() {
    if (!state.selectedComponent) return; state.hiddenComponents.add(state.selectedComponent.id); state.isolatedComponent = null; clearSelection(); renderModel(false); showToast('已隐藏选中对象');
  }

  function isolateSelection() {
    if (!state.selectedComponent) return; state.isolatedComponent = state.isolatedComponent === state.selectedComponent.id ? null : state.selectedComponent.id; renderModel(true); updateReviewButtons();
    showToast(state.isolatedComponent ? '已隔离选中对象' : '已退出隔离');
  }

  function toggleTranslucent() {
    if (!state.selectedComponent) return; const id = state.selectedComponent.id;
    state.translucentComponents.has(id) ? state.translucentComponents.delete(id) : state.translucentComponents.add(id); renderModel(false); updateReviewButtons();
  }

  function showAllObjects() {
    state.hiddenComponents.clear(); state.translucentComponents.clear(); state.isolatedComponent = null; renderModel(true); updateReviewButtons(); showToast('已恢复全部对象');
  }

  function updateStats() {
    const counts = Object.fromEntries(Object.keys(COLORS).map(key => [key, 0])); let length = 0;
    state.components.forEach(c => { counts[c.category]++; length += Math.hypot(c.end[0]-c.start[0], c.end[1]-c.start[1], c.end[2]-c.start[2]); });
    el('countPipe').textContent = counts.pipe; el('countElbow').textContent = counts.elbow; el('countBranch').textContent = counts.branch; el('countReducer').textContent = counts.reducer;
    el('countValve').textContent = counts.valve; el('countFlange').textContent = counts.flange; el('countInstrument').textContent = counts.instrument; el('countMisc').textContent = counts.misc;
    el('statPipelines').textContent = state.selectedPipeline ? 1 : state.pipelines.length;
    el('statComponents').textContent = state.components.length; el('statNodes').textContent = state.nodes.length;
    el('statLength').textContent = `${(length / 1000).toLocaleString('zh-CN', { maximumFractionDigits: 1 })} m`;
  }

  function updatePipelineList() {
    const list = el('pipelineList'); list.innerHTML = '';
    if (!state.pipelines.length) { list.innerHTML = '<div class="empty-list">尚未载入文件</div>'; return; }
    const all = document.createElement('div'); all.className = `pipeline-item ${state.selectedPipeline === null ? 'active' : ''}`;
    all.innerHTML = `<strong>全部管线</strong><span>${state.pipelines.length} 个文件 · 点击聚合查看</span>`;
    all.onclick = () => selectPipeline(null); list.appendChild(all);
    const query = (el('pipelineSearch')?.value || '').trim().toLowerCase();
    state.pipelines.filter(p => !query || `${p.name} ${p.filename}`.toLowerCase().includes(query)).forEach(p => {
      const item = document.createElement('div'); item.className = `pipeline-item ${state.selectedPipeline === p.id ? 'active' : ''}`;
      item.title = `点击聚焦定位：${p.name}`;
      item.innerHTML = `<strong title="${escapeHtml(p.name)}">${escapeHtml(p.name)}</strong><span>${p.components.length} 个元件 · ${p.unit} · 点击定位</span><em aria-hidden="true">⌖</em>`;
      item.onclick = () => selectPipeline(p.id); list.appendChild(item);
    });
    el('fileCount').textContent = state.pipelines.length;
  }

  function selectPipeline(id) {
    state.selectedPipeline = id; controls.autoRotate = false; el('spinButton').classList.remove('active');
    clearSelection(); updatePipelineList(); rebuildTopology(); renderModel(false); fitCamera();
    const activeItem = el('pipelineList').querySelector('.pipeline-item.active');
    activeItem?.scrollIntoView({ block: 'nearest' });
    const pipeline = id ? state.pipelines.find(p => p.id === id) : null;
    showToast(pipeline ? `已聚焦定位：${pipeline.name}` : '已切换至全部管线总览');
  }
  function escapeHtml(value) { const node = document.createElement('span'); node.textContent = value; return node.innerHTML; }
  function showToast(message) { const toast = el('toast'); toast.textContent = message; toast.classList.add('show'); clearTimeout(showToast.t); showToast.t = setTimeout(() => toast.classList.remove('show'), 2400); }

  async function loadProject() {
    try {
      el('loading').hidden = false;
      const response = await fetch('./pipelines.json?v=8', { cache: 'no-store' }); if (!response.ok) throw new Error('project unavailable');
      const rawProject = await response.text(); const project = JSON.parse(rawProject);
      state.pipelines = project.pipelines;
      state.pipelines.forEach(p => p.components.forEach(c => {
        const [label, category, skeyInfo] = classify(c.code, c.skey);
        c.label = label; c.category = category; c.skeyInfo = skeyInfo || null;
      }));
      state.selectedPipeline = null;
      rebuildTopology(); updatePipelineList(); renderModel(true);
      el('sourceUnit').textContent = project.pipelines[0]?.unit || '—';
      el('resourceFiles').textContent = project.fileCount;
      const skeys = new Set(project.pipelines.flatMap(p => p.components.map(c => c.skey)).filter(k => k && k !== '—'));
      el('resourceKinds').textContent = skeys.size;
      el('resourceSize').textContent = `${(new Blob([rawProject]).size / 1024 / 1024).toFixed(1)} MB`;
      showToast(`已载入 ${project.fileCount} 条管线，共 ${project.componentCount} 个几何元件`);
    } catch { showToast('金陵航煤项目数据载入失败，请检查内置数据文件'); }
    finally { el('loading').hidden = true; }
  }

  function inspect(c) {
    el('selectedType').textContent = c.label;
    const info = c.skeyInfo || SKEY_CATALOG.lookup(c.skey);
    const rows = [
      ['准确名称', info?.name || c.label], ['元件族', info?.family || c.label], ['SKEY', c.skey], ['端部形式', info?.endCondition || '未指定'],
      ['规格', c.specification || `DN${c.diameter}`], ['起点口径', `DN${c.startDiameter || c.diameter}`], ['终点口径', `DN${c.endDiameter || c.diameter}`], ['规格判定', c.specificationSource || 'IDF 公称直径'], ['管道等级', c.pipingClass || '未提供'],
      ['材料描述', c.materialDescription || '未提供'], ['材料代码', c.materialCode || '未提供'], ['IDF 元件引用', c.materialRef || '未提供'], ['材料关联', c.materialMatch || 'IDF 原始属性'],
      ['PCF 类型', info?.pcf || 'N/A'], ['IDF 记录', info?.idfRecord || String(c.code)], ['管线文件', c.filename], ['IDF 行号', c.line], ['类型代码', c.code], ['公称直径', `DN ${c.diameter}`],
      ['起点', c.start.join(', ')], ['终点', c.end.join(', ')], ['长度', `${(Math.hypot(c.end[0]-c.start[0], c.end[1]-c.start[1], c.end[2]-c.start[2]) / 1000).toFixed(3)} m`]
    ];
    el('inspector').innerHTML = rows.map(([k,v]) => `<div><dt>${k}</dt><dd>${escapeHtml(String(v))}</dd></div>`).join('');
  }

  function componentFromHit(hit) {
    if (!hit) return null;
    if (hit.object.userData.component) return hit.object.userData.component;
    const components = hit.object.userData.components;
    return components ? components[Math.floor((hit.index || 0) / 2)] : null;
  }

  function hitTest(event) {
    const rect = renderer.domElement.getBoundingClientRect();
    pointer.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
    pointer.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;
    const cameraDistance = Math.max(Number.EPSILON, camera.position.distanceTo(controls.target));
    const worldPerPixel = 2 * cameraDistance * Math.tan(THREE.MathUtils.degToRad(camera.fov / 2)) / Math.max(1, rect.height);
    const pointerTolerance = Math.max(.002, worldPerPixel * 6);
    raycaster.params.Line.threshold = pointerTolerance;
    raycaster.params.Points.threshold = pointerTolerance;
    raycaster.setFromCamera(pointer, camera);
    const hit = raycaster.intersectObjects(modelGroup.children, true).find(result => componentFromHit(result));
    return hit ? { hit, component: componentFromHit(hit) } : null;
  }

  function showComponentTooltip(event, c) {
    const tooltip = el('componentTooltip'); const host = document.querySelector('.viewport-wrap').getBoundingClientRect();
    const info = c.skeyInfo || SKEY_CATALOG.lookup(c.skey);
    tooltip.innerHTML = `<strong>${escapeHtml(info?.name || c.label)} · DN ${escapeHtml(String(c.diameter))}</strong>` +
      `<div><span>规格</span><b>${escapeHtml(c.specification || `DN${c.diameter}`)}</b></div>` +
      `<div><span>材料描述</span><b>${escapeHtml(c.materialDescription || '未提供')}</b></div>` +
      `<div><span>材料代码</span><b>${escapeHtml(c.materialCode || '未提供')}</b></div>` +
      `<div><span>IDF 行号</span><b>${escapeHtml(c.filename)} : ${c.line}</b></div>`;
    tooltip.classList.add('show'); tooltip.setAttribute('aria-hidden', 'false');
    const left = Math.min(event.clientX - host.left + 14, host.width - Math.min(330, host.width - 28) - 10);
    const top = Math.min(event.clientY - host.top + 14, host.height - tooltip.offsetHeight - 12);
    tooltip.style.left = `${Math.max(8, left)}px`; tooltip.style.top = `${Math.max(70, top)}px`;
  }

  function hideComponentTooltip() { const tooltip = el('componentTooltip'); tooltip.classList.remove('show'); tooltip.setAttribute('aria-hidden', 'true'); }

  function resize() { const host = el('viewport'); camera.aspect = host.clientWidth / host.clientHeight; camera.updateProjectionMatrix(); renderer.setSize(host.clientWidth, host.clientHeight); }
  let fpsFrames = 0, fpsStamp = performance.now();
  function animate(now) {
    requestAnimationFrame(animate); controls.update(); renderer.render(scene, camera); fpsFrames++;
    if (now - fpsStamp > 1000) { el('fps').textContent = `${Math.round(fpsFrames * 1000 / (now - fpsStamp))} FPS`; fpsFrames = 0; fpsStamp = now; }
  }

  el('sampleButton').addEventListener('click', loadProject);
  el('pipelineSearch').addEventListener('input', updatePipelineList);
  document.querySelectorAll('[data-view]').forEach(button => button.addEventListener('click', () => {
    state.view = button.dataset.view; document.querySelectorAll('[data-view]').forEach(b => b.classList.toggle('active', b === button)); renderModel(false);
  }));
  document.querySelectorAll('[data-filter]').forEach(button => button.addEventListener('click', () => {
    const key = button.dataset.filter; state.filters.has(key) ? state.filters.delete(key) : state.filters.add(key); button.classList.toggle('active'); renderModel(false);
  }));
  el('fitButton').addEventListener('click', fitCamera);
  el('zoomInButton').addEventListener('click', () => zoom(.78));
  el('zoomOutButton').addEventListener('click', () => zoom(1.28));
  el('focusButton').addEventListener('click', focusSelection);
  el('spinButton').addEventListener('click', e => { controls.autoRotate = !controls.autoRotate; e.currentTarget.classList.toggle('active', controls.autoRotate); });
  el('fullscreenButton').addEventListener('click', () => document.fullscreenElement ? document.exitFullscreen() : el('viewport').parentElement.requestFullscreen());
  el('axisButton').addEventListener('click', e => { axis.visible = !axis.visible; e.currentTarget.classList.toggle('active', axis.visible); });
  el('hideButton').addEventListener('click', hideSelection);
  el('isolateButton').addEventListener('click', isolateSelection);
  el('translucentButton').addEventListener('click', toggleTranslucent);
  el('showAllButton').addEventListener('click', showAllObjects);
  const workspace = document.querySelector('.workspace');
  el('collapseLeft').addEventListener('click', e => { workspace.classList.toggle('left-collapsed'); e.currentTarget.textContent = workspace.classList.contains('left-collapsed') ? '›' : '‹'; setTimeout(resize, 260); });
  el('collapseRight').addEventListener('click', e => { workspace.classList.toggle('right-collapsed'); e.currentTarget.textContent = workspace.classList.contains('right-collapsed') ? '‹' : '›'; setTimeout(resize, 260); });
  renderer.domElement.addEventListener('pointermove', event => {
    const result = hitTest(event); renderer.domElement.style.cursor = result ? 'pointer' : 'default';
    zoomAnchor = result?.hit?.point?.clone() || null;
    if (result) showComponentTooltip(event, result.component); else hideComponentTooltip();
  });
  renderer.domElement.addEventListener('pointerleave', () => { zoomAnchor = null; hideComponentTooltip(); });
  renderer.domElement.addEventListener('wheel', event => {
    event.preventDefault();
    if (!wheelZoomAnchor) wheelZoomAnchor = (zoomAnchor || selectedCenter() || controls.target).clone();
    const deltaPixels = event.deltaY * (event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? renderer.domElement.clientHeight : 1);
    const factor = Math.exp(THREE.MathUtils.clamp(deltaPixels * .0012, -.35, .35));
    zoom(factor, wheelZoomAnchor);
    clearTimeout(wheelZoomTimer);
    wheelZoomTimer = setTimeout(finishWheelZoom, 180);
  }, { passive: false });
  renderer.domElement.addEventListener('pointerdown', event => {
    finishWheelZoom();
    const result = hitTest(event);
    if (result) selectObject(result.hit.object.userData.components ? null : (result.hit.object.userData.componentRoot || result.hit.object), result.component);
  });
  window.addEventListener('keydown', event => { if (event.key.toLowerCase() === 'f' && !/input|textarea/i.test(event.target.tagName)) focusSelection(); });
  window.addEventListener('resize', resize);
  const updateClock = () => { el('clock').textContent = new Date().toLocaleTimeString('zh-CN', { hour12: false }); };
  updateClock(); setInterval(updateClock, 1000); updateReviewButtons(); resize(); animate(performance.now()); loadProject();
})();
