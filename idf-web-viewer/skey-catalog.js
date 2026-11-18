(function (root, factory) {
  const catalog = factory();
  if (typeof module === 'object' && module.exports) module.exports = catalog;
  if (root) root.SKEY_CATALOG = catalog;
})(typeof window !== 'undefined' ? window : globalThis, function () {
  'use strict';

  const END_CONDITIONS = {
    BW: '对焊', CP: '压缩连接', SW: '承插焊', FL: '法兰', SC: '螺纹',
    PL: '平端', LN: '衬套螺母', LC: '衬套/卡箍', LR: '异径衬套/螺母',
    MP: '外螺纹件', PF: '推入式', GL: '胶接', CL: '卡箍', FA: '扩口',
    BS: '球窝连接', SB: '球窝连接', GF: '压盖连接'
  };

  // 部分 SKEY 的末两位表示管件子型而不是通用端型，需按完整代码覆盖。
  const EXACT_END_CONDITIONS = {
    FLWN: '对焊颈端（Weld Neck）',
    FLBL: '盲端（Blind）',
    FPPL: '平端固定长度管',
    UNIV: '项目自定义端型 IV',
    SB: '不适用',
    BW: '对焊',
    SW: '承插焊',
    NULL: '未指定'
  };

  const EXACT = {
    ELBW: ['对焊弯头', '弯头', 'elbow', 'ELBOW', '35/36'],
    ELSW: ['承插焊弯头', '弯头', 'elbow', 'ELBOW', '35/36'],
    FLWN: ['对焊颈法兰', '法兰', 'flange', 'FLANGE', '105'],
    FLSW: ['承插焊法兰', '法兰', 'flange', 'FLANGE', '105'],
    FLBL: ['盲法兰（含放空连接）', '法兰', 'flange', 'FLANGE-BLIND', '107'],
    TEBW: ['对焊三通', '三通', 'branch', 'TEE', '45/0/46/47'],
    TESW: ['承插焊三通', '三通', 'branch', 'TEE', '45/0/46/47'],
    TERF: ['加强型外接三通', '三通', 'branch', 'TEE-SET-ON / TEE-STUB', '45/0/46/47'],
    SKSW: ['承插焊支管座（Sockolet）', '支管座', 'branch', 'OLET', '40/0/41/42'],
    WTBW: ['对焊支管座（Weldolet）', '支管座', 'branch', 'OLET', '40/0/41/42'],
    RCBW: ['对焊同心异径管', '异径管', 'reducer', 'REDUCER-CONCENTRIC', '55/0'],
    REBW: ['对焊偏心异径管', '异径管', 'reducer', 'REDUCER-ECCENTRIC', '55/0'],
    RNSC: ['螺纹同心异径短节', '异径管', 'reducer', 'REDUCER-CONCENTRIC', '55/0'],
    FPPL: ['无整体法兰固定长度管', '固定长度管', 'pipe', 'PIPE-FIXED', '101'],
    KASC: ['螺纹管帽', '管帽', 'misc', 'CAP', '125/0'],
    IDFL: ['法兰式仪表表盘', '仪表', 'instrument', 'INSTRUMENT-DIAL', '90'],
    IRFL: ['法兰式回转仪表', '仪表', 'instrument', 'INSTRUMENT-RETURN', '90/93'],
    CVFL: ['法兰式调节阀', '仪表阀', 'instrument', 'INSTRUMENT', '90/93'],
    XAFL: ['法兰式角型减压仪表阀', '仪表阀', 'instrument', 'INSTRUMENT-ANGLE', '90/93'],
    VTFL: ['法兰闸阀', '阀门', 'valve', 'VALVE', '130/0'],
    VTSW: ['承插焊闸阀', '阀门', 'valve', 'VALVE', '130/0'],
    VCFL: ['法兰止回阀', '阀门', 'valve', 'VALVE', '130/0'],
    VCSW: ['承插焊止回阀', '阀门', 'valve', 'VALVE', '130/0'],
    VGFL: ['法兰截止阀', '阀门', 'valve', 'VALVE', '130/0'],
    VGSW: ['承插焊截止阀', '阀门', 'valve', 'VALVE', '130/0'],
    VYFL: ['法兰蝶阀', '阀门', 'valve', 'VALVE', '130/0'],
    CHSC: ['螺纹软管接头', '杂项管件', 'misc', 'MISC-COMPONENT', '95/96'],
    TUBW: ['对焊漏斗（Tundish）', '杂项管件', 'misc', 'MISC-COMPONENT', '95/96'],
    FABW: ['对焊角式过滤器/滤网', '过滤器', 'misc', 'FILTER-ANGLE', '136/137'],
    UNIV: ['活接头（项目自定义端型 IV）', '活接头', 'misc', 'UNION', '127/0'],
    SB: ['关闭状态眼镜盲板', '杂项管件', 'misc', 'MISC-COMPONENT', '95/96'],
    BW: ['对焊连接/焊口', '连接', 'misc', 'WELD / CONNECTION', '120'],
    SW: ['承插焊连接/焊口', '连接', 'misc', 'WELD / CONNECTION', '120'],
    NULL: ['未指定符号', '未分类', 'misc', 'N/A', 'N/A']
  };

  const FAMILY_RULES = [
    [/^EL/, '弯头', '弯头', 'elbow', 'ELBOW', '35/36'],
    [/^TE/, '三通', '三通', 'branch', 'TEE', '45/0/46/47'],
    [/^(SK|WT|HC|NI|SW|TH|LA)/, '支管座', '支管座', 'branch', 'OLET', '40/0/41/42'],
    [/^FL/, '法兰', '法兰', 'flange', 'FLANGE', '105'],
    [/^RC/, '同心异径管', '异径管', 'reducer', 'REDUCER-CONCENTRIC', '55/0'],
    [/^RE/, '偏心异径管', '异径管', 'reducer', 'REDUCER-ECCENTRIC', '55/0'],
    [/^FP/, '固定长度管', '固定长度管', 'pipe', 'PIPE-FIXED', '101'],
    [/^KA/, '管帽', '管帽', 'misc', 'CAP', '125/0'],
    [/^UN/, '活接头', '活接头', 'misc', 'UNION', '127/0'],
    [/^CV/, '调节阀', '仪表阀', 'instrument', 'INSTRUMENT', '90/93'],
    [/^XA/, '角型减压仪表阀', '仪表阀', 'instrument', 'INSTRUMENT-ANGLE', '90/93'],
    [/^IR/, '回转仪表', '仪表', 'instrument', 'INSTRUMENT-RETURN', '90/93'],
    [/^ID/, '仪表表盘', '仪表', 'instrument', 'INSTRUMENT-DIAL', '90'],
    [/^VT/, '闸阀', '阀门', 'valve', 'VALVE', '130/0'],
    [/^VC/, '止回阀', '阀门', 'valve', 'VALVE', '130/0'],
    [/^VG/, '截止阀', '阀门', 'valve', 'VALVE', '130/0'],
    [/^VY/, '蝶阀', '阀门', 'valve', 'VALVE', '130/0'],
    [/^V[A-Z]/, '阀门', '阀门', 'valve', 'VALVE', '130/0'],
    [/^FA/, '角式过滤器/滤网', '过滤器', 'misc', 'FILTER-ANGLE', '136/137'],
    [/^CH/, '软管接头', '杂项管件', 'misc', 'MISC-COMPONENT', '95/96'],
    [/^TU/, '漏斗（Tundish）', '杂项管件', 'misc', 'MISC-COMPONENT', '95/96']
  ];

  function lookup(rawSkey) {
    const skey = String(rawSkey || '').trim().toUpperCase();
    if (!skey || skey === '—') return null;
    const exact = EXACT[skey];
    let data = exact;
    if (!data) {
      const rule = FAMILY_RULES.find(([pattern]) => pattern.test(skey));
      if (rule) data = rule.slice(1);
    }
    if (!data) return { skey, name: '未收录项目符号', family: '未分类', category: 'misc', endCondition: EXACT_END_CONDITIONS[skey] || END_CONDITIONS[skey.slice(-2)] || '未知', pcf: 'N/A', idfRecord: 'N/A', source: 'fallback' };
    return {
      skey, name: data[0], family: data[1], category: data[2], pcf: data[3], idfRecord: data[4],
      endCondition: EXACT_END_CONDITIONS[skey] || END_CONDITIONS[skey.slice(-2)] || (skey.length <= 2 ? '不适用' : '项目自定义/未定义'),
      source: exact ? 'ISOGEN SKEY Guide / exact' : 'ISOGEN SKEY Guide / family rule'
    };
  }

  return { END_CONDITIONS, EXACT_END_CONDITIONS, EXACT, lookup };
});
