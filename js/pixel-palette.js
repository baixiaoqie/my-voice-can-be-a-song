/* ============================================================
   palette.js — 昼夜循环调色板
   核心：把一天 24 小时切成若干关键帧，每个关键帧给出一整套
   场景配色（天空 / 海 / 草 / 木 / 雾 / 光源），中间做插值。

   关键帧时刻来自对原视频逐帧取样的实际观感：
     06:00 黎明  粉紫天空 / 冷蓝海
     08:00 清晨  浅蓝天空 / 青绿海
     12:00 正午  高亮蓝天空 / 明蓝海
     18:00 黄昏  橙粉天空 / 暖紫海
     21:00 夜晚  深蓝天空 / 近黑海
   ============================================================ */
(function (global) {
  'use strict';

  const mix = PX.mix;
  const lerp = PX.lerp;
  const clamp = PX.clamp;

  /**
   * 关键帧定义。
   * hour: 一天中的小时（0-24，支持小数）
   * 每一项都是完整配色方案，缺项会回退到最近的前序关键帧。
   */
  const KEYS = [
    {
      hour: 0, name: '深夜',
      sky: ['#0a0f2a', '#141b3f', '#22284f'],
      skyLow: '#2d2b52',       // 地平线附近
      sea: ['#0d1c3a', '#152a4e', '#1d3a60'],
      seaFoam: '#4a6a92',
      grass: '#2c5c52',
      grassLight: '#3d7466',
      grassDark: '#1c3c3e',
      wood: '#3a2c2a',
      woodDark: '#241a1a',
      cloud: '#3a3f63',
      cloudLit: '#565c85',
      hazeColor: '#1a2145',
      ambient: '#0d1230',       // 全局环境色（乘法叠加）
      ambientStrength: 0.40,
      lightOn: 1,              // 灯光强度系数 0-1
      starAlpha: 1,
      sunColor: '#e8eefc',
      sunGlow: 0.10,           // 月亮光晕
      isNight: true
    },
    {
      hour: 5, name: '破晓',
      sky: ['#131a3d', '#3a2f5c', '#7b4a6a'],
      skyLow: '#a8667e',
      sea: ['#24304f', '#3b4060', '#55506d'],
      seaFoam: '#8a7a92',
      grass: '#2c3a44',
      grassLight: '#3c4c52',
      grassDark: '#1c2630',
      wood: '#4a3830',
      woodDark: '#2e221e',
      cloud: '#6a4f6a',
      cloudLit: '#9a6f7a',
      hazeColor: '#8a5a70',
      ambient: '#2a2448',
      ambientStrength: 0.40,
      lightOn: 0.75,
      starAlpha: 0.35,
      sunColor: '#ffd0a0',
      sunGlow: 0.35,
      isNight: false
    },
    {
      hour: 7, name: '清晨',
      sky: ['#4a8fc4', '#7cbde2', '#b8e0f2'],
      skyLow: '#d8eef8',
      sea: ['#1d6f96', '#2b8cb0', '#45aac6'],
      seaFoam: '#c8eef6',
      grass: '#4e8c34',
      grassLight: '#68a844',
      grassDark: '#36682a',
      wood: '#8a6038',
      woodDark: '#5e4026',
      cloud: '#dfeef6',
      cloudLit: '#ffffff',
      hazeColor: '#c6e2f0',
      ambient: '#ffffff',
      ambientStrength: 0,
      lightOn: 0.15,
      starAlpha: 0,
      sunColor: '#fff4c8',
      sunGlow: 0.5,
      isNight: false
    },
    {
      hour: 12, name: '正午',
      sky: ['#2f7fc8', '#5aa6e0', '#96cdee'],
      skyLow: '#cfe8f6',
      sea: ['#1868a8', '#2588c4', '#42a8d6'],
      seaFoam: '#e0f4fc',
      grass: '#5a9c30',
      grassLight: '#7abb42',
      grassDark: '#3d7220',
      wood: '#a8763f',
      woodDark: '#75501f',
      cloud: '#f4fafe',
      cloudLit: '#ffffff',
      hazeColor: '#d8ecf6',
      ambient: '#ffffff',
      ambientStrength: 0,
      lightOn: 0,
      starAlpha: 0,
      sunColor: '#fffbe0',
      sunGlow: 0.65,
      isNight: false
    },
    {
      hour: 17, name: '午后',
      sky: ['#3a86c6', '#6aaae0', '#a8d0ec'],
      skyLow: '#e0dce0',
      sea: ['#1c6496', '#2a80b0', '#429ec4'],
      seaFoam: '#d8eef6',
      grass: '#5e9c34',
      grassLight: '#7cba48',
      grassDark: '#43761f',
      wood: '#a07038',
      woodDark: '#6e4a22',
      cloud: '#f0e8ee',
      cloudLit: '#fffaf6',
      hazeColor: '#e0c8c0',
      ambient: '#ffe8d0',
      ambientStrength: 0.08,
      lightOn: 0.08,
      starAlpha: 0,
      sunColor: '#ffeeb0',
      sunGlow: 0.6,
      isNight: false
    },
    {
      hour: 19, name: '黄昏',
      sky: ['#2e3a6e', '#8a5a86', '#e08a5a'],
      skyLow: '#f0a068',
      sea: ['#1e3a62', '#4a4a78', '#8a5a72'],
      seaFoam: '#c08a86',
      grass: '#4a5a38',
      grassLight: '#647a48',
      grassDark: '#2c3a26',
      wood: '#7a5030',
      woodDark: '#4e3220',
      cloud: '#a8626a',
      cloudLit: '#e89a72',
      hazeColor: '#c06a5a',
      ambient: '#ff9a5c',
      ambientStrength: 0.26,
      lightOn: 0.55,
      starAlpha: 0.12,
      sunColor: '#ffb060',
      sunGlow: 0.8,
      isNight: false
    },
    {
      hour: 21, name: '夜晚',
      sky: ['#080c24', '#131a3e', '#25294e'],
      skyLow: '#3a2e50',
      sea: ['#0c1a36', '#142a4c', '#1e3a5e'],
      seaFoam: '#50688e',
      grass: '#1c3c38',
      grassLight: '#284e46',
      grassDark: '#102628',
      wood: '#5a4238',
      woodDark: '#38282a',
      cloud: '#333a5e',
      cloudLit: '#4d5480',
      hazeColor: '#181e42',
      ambient: '#0b1030',
      ambientStrength: 0.40,
      lightOn: 1,
      starAlpha: 1,
      sunColor: '#e8eefc',
      sunGlow: 0.12,
      isNight: true
    },
    {
      hour: 24, name: '深夜',
      sky: ['#0a0f2a', '#141b3f', '#22284f'],
      skyLow: '#2d2b52',
      sea: ['#0d1c3a', '#152a4e', '#1d3a60'],
      seaFoam: '#4a6a92',
      grass: '#2c5c52',
      grassLight: '#3d7466',
      grassDark: '#1c3c3e',
      wood: '#3a2c2a',
      woodDark: '#241a1a',
      cloud: '#3a3f63',
      cloudLit: '#565c85',
      hazeColor: '#1a2145',
      ambient: '#0d1230',
      ambientStrength: 0.40,
      lightOn: 1,
      starAlpha: 1,
      sunColor: '#e8eefc',
      sunGlow: 0.10,
      isNight: true
    }
  ];

  /** 标量字段：直接插值 */
  const SCALARS = ['ambientStrength', 'lightOn', 'starAlpha', 'sunGlow'];
  /** 颜色数组字段：逐项插值 */
  const COLOR_ARRAYS = ['sky', 'sea'];
  /** 颜色标量字段 */
  const COLOR_SCALARS = [
    'skyLow', 'seaFoam', 'grass', 'grassLight', 'grassDark',
    'wood', 'woodDark', 'cloud', 'cloudLit', 'hazeColor',
    'ambient', 'sunColor'
  ];

  /** 兜底色：某关键帧漏字段时用它顶替，避免 mix(undefined) 整帧崩溃 */
  const FALLBACK = {
    skyLow: '#cfe8f6', seaFoam: '#e0f4fc',
    grass: '#5a9c30', grassLight: '#7abb42', grassDark: '#3d7220',
    wood: '#a8763f', woodDark: '#75501f',
    cloud: '#f4fafe', cloudLit: '#ffffff', hazeColor: '#d8ecf6',
    ambient: '#ffffff', sunColor: '#fffbe0',
    ambientStrength: 0, lightOn: 0, starAlpha: 0, sunGlow: 0.5,
    isNight: false
  };

  /**
   * 完整性自检：确保每个关键帧都带齐所有字段。
   * 这是防御性设计——新增关键帧时若漏写字段，兜底补齐而不是让整场景崩掉。
   */
  const ALL_FIELDS = SCALARS.concat(COLOR_SCALARS, COLOR_ARRAYS);
  (function selfCheck() {
    let fixed = 0;
    for (let i = 0; i < KEYS.length; i++) {
      const k = KEYS[i];
      const missing = [];
      for (let f = 0; f < ALL_FIELDS.length; f++) {
        const name = ALL_FIELDS[f];
        if (k[name] === undefined || k[name] === null) {
          if (Array.isArray(FALLBACK[name])) k[name] = FALLBACK[name].slice();
          else if (FALLBACK[name] !== undefined) k[name] = FALLBACK[name];
          missing.push(name);
          fixed++;
        }
      }
      if (missing.length) {
        console.warn('[palette] 关键帧 ' + k.hour + 'h 缺少字段，已兜底: ' + missing.join(', '));
      }
    }
    if (fixed === 0 && typeof console !== 'undefined') {
      console.info('[palette] ' + KEYS.length + ' 个关键帧字段完整。');
    }
  })();

  /**
   * 求给定小时的完整调色板（插值结果）
   * @param {number} hour 0-24
   * @returns {object} 配色对象
   */
  function paletteAt(hour) {
    hour = ((hour % 24) + 24) % 24;

    // 找到所在区间
    let i = 0;
    while (i < KEYS.length - 2 && KEYS[i + 1].hour <= hour) i++;
    const a = KEYS[i];
    const b = KEYS[i + 1];

    const span = Math.max(1e-6, b.hour - a.hour);
    let t = clamp((hour - a.hour) / span, 0, 1);
    t = PX.smoothstep(t);

    const out = { hour: hour, phase: a.name, isNight: t < 0.5 ? a.isNight : b.isNight };

    for (let k = 0; k < SCALARS.length; k++) {
      const f = SCALARS[k];
      out[f] = lerp(a[f], b[f], t);
    }
    for (let k = 0; k < COLOR_ARRAYS.length; k++) {
      const f = COLOR_ARRAYS[k];
      const arrA = a[f] || FALLBACK[f];
      const arrB = b[f] || FALLBACK[f];
      const n = Math.min(arrA.length, arrB.length);
      const res = [];
      for (let j = 0; j < n; j++) res.push(mix(arrA[j], arrB[j], t));
      out[f] = res;
    }
    for (let k = 0; k < COLOR_SCALARS.length; k++) {
      const f = COLOR_SCALARS[k];
      out[f] = mix(a[f] || FALLBACK[f], b[f] || FALLBACK[f], t);
    }
    return out;
  }

  /** 供 UI 用的时段名 */
  function phaseName(hour) {
    return paletteAt(hour).phase;
  }

  global.PAL = { paletteAt: paletteAt, phaseName: phaseName, KEYS: KEYS };
})(window);
