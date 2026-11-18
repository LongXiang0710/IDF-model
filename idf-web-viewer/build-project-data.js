const fs = require('fs');
const path = require('path');
const SKEY_CATALOG = require('./skey-catalog.js');

const sourceDir = path.resolve(__dirname, '..', '金陵航煤改造项目IDF文件');
const outputFile = path.resolve(__dirname, 'pipelines.json');

const TYPE_MAP = {
  35: ['弯头', 'elbow'], 36: ['弯头', 'elbow'],
  40: ['分支连接', 'branch'], 41: ['支管座', 'branch'], 42: ['分支连接', 'branch'],
  45: ['三通/支管', 'branch'], 46: ['三通/支管', 'branch'], 47: ['三通/支管', 'branch'], 50: ['阀门', 'valve'], 55: ['异径管', 'reducer'],
  90: ['仪表/端点', 'instrument'], 95: ['特殊管件', 'misc'], 96: ['特殊管件', 'misc'], 100: ['直管', 'pipe'], 105: ['法兰', 'flange'], 107: ['法兰', 'flange'],
  110: ['焊口/法兰', 'flange'], 115: ['注释/连接', 'flange'], 120: ['端部连接', 'flange'],
  125: ['管帽', 'misc'], 127: ['活接头', 'misc'], 130: ['阀门', 'valve'], 136: ['过滤器', 'misc'], 137: ['过滤器', 'misc'],
  150: ['特殊元件', 'valve'], 250: ['工程连接记录', 'misc']
};

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

function parse(text, filename) {
  const lines = text.replace(/\r/g, '').split('\n');
  const unit = lines.some(line => /^\s*-207\s+MM\b/.test(line)) ? 'MM' : 'UNKNOWN';
  let lineName = filename.replace(/\.idf$/i, '');
  const nameIndex = lines.findIndex(line => /^\s*-600\s+/.test(line));
  if (nameIndex >= 0) {
    const parts = [lines[nameIndex].replace(/^\s*-600\s+/, '').trim()];
    for (let i = nameIndex + 1; i < Math.min(nameIndex + 4, lines.length) && /^\s*-1\s+/.test(lines[i]); i++) {
      parts.push(lines[i].replace(/^\s*-1\s+/, '').trim());
    }
    lineName = parts.join('');
  }
  const readRecord = (index, code) => {
    const values = [lines[index].replace(new RegExp(`^\\s*${code}\\s*`), '').trim()];
    let end = index;
    while (end + 1 < lines.length && /^\s*-1\s+/.test(lines[end + 1])) { end++; values.push(lines[end].replace(/^\s*-1\s+/, '').trim()); }
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
    const tokens = line.split(',')[0].trim().split(/\s+/);
    if (tokens.length < 9 || !tokens.slice(0, 9).every(v => /^-?\d+$/.test(v))) return;
    const [code, x1, y1, z1, x2, y2, z2, diameter, sequence] = tokens.slice(0, 9).map(Number);
    if (code <= 0 || [149, 300, 999].includes(code)) return;
    const tail = line.split(',').slice(1).map(v => v.trim());
    const skey = tail[2] || '';
    const [label, category, skeyInfo] = classify(code, skey);
    const end = (x2 !== 0 || y2 !== 0 || z2 !== 0) ? [x2, y2, z2] : [x1, y1, z1];
    lastComponent = {
      id: `${filename}:${lineIndex}`, code, label, category,
      start: [x1, y1, z1], end, diameter, sequence,
      skey: skey || '—', skeyInfo: skeyInfo || null, line: lineIndex + 1, filename,
      pipingClass: currentSpec, materialRef: '未提供', rawDescription: ''
    };
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
    const description = entry.description.toUpperCase(); let score = dn.test(description) ? 8 : 0;
    if (keywords.some(keyword => description.includes(keyword))) score += 7;
    if (score > bestScore) { best = entry; bestScore = score; }
  });
  const info = c.skeyInfo || SKEY_CATALOG.lookup(c.skey);
  c.materialCode = bestScore >= 7 ? best.code : (c.materialRef || '未提供');
  c.materialDescription = c.rawDescription || (bestScore >= 7 ? best.description : `${info?.name || c.label}，${c.specification || `DN${c.diameter}`}`);
  c.materialMatch = bestScore >= 15 ? 'DN + 类型匹配' : bestScore >= 7 ? '类型匹配' : 'IDF 元件属性';
}

const files = fs.readdirSync(sourceDir).filter(name => /\.idf$/i.test(name)).sort();
const pipelines = files.map(filename => parse(fs.readFileSync(path.join(sourceDir, filename), 'utf8'), filename));
const output = {
  generatedAt: new Date().toISOString(),
  sourceFolder: path.basename(sourceDir),
  fileCount: pipelines.length,
  componentCount: pipelines.reduce((sum, p) => sum + p.components.length, 0),
  pipelines
};
fs.writeFileSync(outputFile, JSON.stringify(output));
console.log(`Generated ${path.basename(outputFile)}: ${output.fileCount} pipelines, ${output.componentCount} components`);
