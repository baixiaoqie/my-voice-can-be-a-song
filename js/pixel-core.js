/* ============================================================
   pixel.js — 像素渲染内核
   职责：低分辨率画布上的基础绘制原语 + 确定性随机 + 噪声
   设计约束：所有绘制必须落在整数像素上，禁止小数坐标，
   否则 CSS 放大后会出现半像素模糊，失去像素风质感。
   ============================================================ */
(function (global) {
  'use strict';

  /** 内部逻辑分辨率（与视频 16:9 接近，2 的整数倍便于缩放） */
  const VW = 480;
  const VH = 270;

  /* --------------------------------------------------------
     确定性伪随机（mulberry32）
     用固定种子保证每次刷新画面完全一致——像素风的"颗粒感"
     必须是可复现的，不能每次刷新都变。
     -------------------------------------------------------- */
  function makeRng(seed) {
    let a = seed >>> 0;
    return function () {
      a |= 0;
      a = (a + 0x6d2b79f5) | 0;
      let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  /** 区间随机整数 [min, max] */
  function rngInt(rng, min, max) {
    return min + Math.floor(rng() * (max - min + 1));
  }

  /** 从数组随机取一项 */
  function rngPick(rng, arr) {
    return arr[Math.floor(rng() * arr.length) % arr.length];
  }

  /** 一维值噪声（平滑起伏），用于海浪、草地起伏、云层分布 */
  function makeNoise1D(seed, size) {
    const rng = makeRng(seed);
    const table = new Float32Array(size);
    for (let i = 0; i < size; i++) table[i] = rng();
    return function (x) {
      const xi = Math.floor(x);
      const xf = x - xi;
      const a = table[((xi % size) + size) % size];
      const b = table[(((xi + 1) % size) + size) % size];
      // smoothstep 插值，避免折线感
      const t = xf * xf * (3 - 2 * xf);
      return a + (b - a) * t;
    };
  }

  /** 确定性伪随机点阵工具：给定坐标返回稳定的 0..1 值（用于草地/星空分布） */
  function hash01(x, y, seed) {
    let h = Math.imul(x, 374761393) ^ Math.imul(y, 668265263) ^ Math.imul(seed, 2246822519);
    h = Math.imul(h ^ (h >>> 13), 1274126177);
    return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
  }

  /* --------------------------------------------------------
     PixelCanvas — 画布绘制封装
     -------------------------------------------------------- */
  class PixelCanvas {
    constructor(canvas, w, h) {
      this.canvas = canvas;
      this.w = w;
      this.h = h;
      canvas.width = w;
      canvas.height = h;
      this.ctx = canvas.getContext('2d', { alpha: false });
      this.ctx.imageSmoothingEnabled = false;
    }

    /** 取 2D 上下文（调用方自行 save/restore） */
    get c() {
      return this.ctx;
    }

    /** 清空为指定颜色 */
    clear(color) {
      const ctx = this.ctx;
      ctx.fillStyle = color;
      ctx.fillRect(0, 0, this.w, this.h);
    }

    /** 实心矩形（整数对齐） */
    rect(x, y, w, h, color) {
      if (w <= 0 || h <= 0) return;
      this.ctx.fillStyle = color;
      this.ctx.fillRect(x | 0, y | 0, Math.max(1, w | 0), Math.max(1, h | 0));
    }

    /** 单像素 */
    px(x, y, color) {
      this.ctx.fillStyle = color;
      this.ctx.fillRect(x | 0, y | 0, 1, 1);
    }

    /** 水平线 */
    hline(x, y, len, color) {
      this.ctx.fillStyle = color;
      this.ctx.fillRect(x | 0, y | 0, len | 0, 1);
    }

    /** 垂直线 */
    vline(x, y, len, color) {
      this.ctx.fillStyle = color;
      this.ctx.fillRect(x | 0, y | 0, 1, len | 0);
    }

    /** 描边矩形（1px 边框） */
    strokeRect(x, y, w, h, color) {
      this.hline(x, y, w, color);
      this.hline(x, y + h - 1, w, color);
      this.vline(x, y, h, color);
      this.vline(x + w - 1, y, h, color);
    }

    /** 圆（像素圆，中心式填充） */
    disc(cx, cy, r, color) {
      const ctx = this.ctx;
      ctx.fillStyle = color;
      const r2 = r * r;
      for (let dy = -r; dy <= r; dy++) {
        const span = Math.floor(Math.sqrt(Math.max(0, r2 - dy * dy)));
        if (span < 0) continue;
        ctx.fillRect((cx - span) | 0, (cy + dy) | 0, span * 2 + 1, 1);
      }
    }

    /** 空心圆（描边） */
    ring(cx, cy, r, color) {
      const ctx = this.ctx;
      ctx.fillStyle = color;
      let x = r;
      let y = 0;
      let err = 1 - r;
      while (x >= y) {
        const pts = [
          [cx + x, cy + y], [cx + y, cy + x],
          [cx - y, cy + x], [cx - x, cy + y],
          [cx - x, cy - y], [cx - y, cy - x],
          [cx + y, cy - x], [cx + x, cy - y]
        ];
        for (let i = 0; i < pts.length; i++) {
          ctx.fillRect(pts[i][0] | 0, pts[i][1] | 0, 1, 1);
        }
        y++;
        if (err < 0) {
          err += 2 * y + 1;
        } else {
          x--;
          err += 2 * (y - x) + 1;
        }
      }
    }

    /**
     * 径向柔光（用于太阳/月亮光晕、灯光）。
     * 像素风里光晕应该"硬"一些，所以用有限档位量化而不是平滑渐变，
     * 模拟低色深下的光晕。
     */
    glow(cx, cy, r, color, strength) {
      if (r <= 0 || strength <= 0) return;
      const ctx = this.ctx;
      ctx.save();
      ctx.fillStyle = color;
      const layers = 7;
      for (let i = layers; i >= 1; i--) {
        const f = i / layers;
        const rr = r * f;
        // 平方衰减：中心亮、边缘迅速隐去，避免出现生硬同心圆
        const a = strength * Math.pow(1 - f, 1.8) * 0.55;
        if (a < 0.008) continue;
        ctx.globalAlpha = a;
        // 抖动半径，打散完美圆形
        const j = (hash01(i, cx | 0, cy | 0) - 0.5) * (r / layers) * 0.9;
        this.disc(cx, cy, Math.max(1, rr + j), color);
      }
      ctx.restore();
    }

    /** 线性渐变填充矩形（用于天空） */
    gradientRect(x, y, w, h, stops) {
      const ctx = this.ctx;
      // stops: [[offset0..1, color], ...]
      // 用多段硬色带模拟像素渐变：用 2px 一档，档间做半透明过渡
      const bands = Math.max(2, Math.floor(h / 2));
      for (let i = 0; i < bands; i++) {
        const t = i / (bands - 1);
        const yy = y + Math.floor((i * h) / bands);
        const hh = Math.max(1, Math.floor(h / bands) + 1);
        ctx.fillStyle = sampleStops(stops, t);
        ctx.fillRect(x | 0, yy, w | 0, hh);
      }
    }

    /** 文本（极简 3x5 像素字体，用于站牌/招牌） */
    text(str, x, y, color, scale) {
      const s = scale || 1;
      const ctx = this.ctx;
      ctx.fillStyle = color;
      let cx = x | 0;
      for (let i = 0; i < str.length; i++) {
        const glyph = FONT_3x5[str[i].toUpperCase()];
        if (glyph) {
          for (let gy = 0; gy < 5; gy++) {
            for (let gx = 0; gx < 3; gx++) {
              if (glyph[gy] & (4 >> gx)) {
                ctx.fillRect(cx + gx * s, (y | 0) + gy * s, s, s);
              }
            }
          }
        }
        cx += 4 * s;
      }
    }

    /** 文本宽度（用于居中） */
    textWidth(str, scale) {
      return str.length * 4 * (scale || 1) - (scale || 1);
    }
  }

  /** 采样多段色标 */
  function sampleStops(stops, t) {
    t = Math.max(0, Math.min(1, t));
    for (let i = 0; i < stops.length - 1; i++) {
      const a = stops[i];
      const b = stops[i + 1];
      if (t >= a[0] && t <= b[0]) {
        const lt = (t - a[0]) / Math.max(1e-6, b[0] - a[0]);
        return mix(a[1], b[1], lt);
      }
    }
    return stops[t <= stops[0][0] ? 0 : stops.length - 1][1];
  }

  /* --------------------------------------------------------
     颜色工具
     -------------------------------------------------------- */
  function hexToRgb(hex) {
    const h = hex.replace('#', '');
    return [
      parseInt(h.substring(0, 2), 16),
      parseInt(h.substring(2, 4), 16),
      parseInt(h.substring(4, 6), 16)
    ];
  }

  function rgbToHex(r, g, b) {
    const c = (v) => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, '0');
    return '#' + c(r) + c(g) + c(b);
  }

  /** 线性混色 */
  function mix(c1, c2, t) {
    const a = hexToRgb(c1);
    const b = hexToRgb(c2);
    return rgbToHex(
      a[0] + (b[0] - a[0]) * t,
      a[1] + (b[1] - a[1]) * t,
      a[2] + (b[2] - a[2]) * t
    );
  }

  /** 提亮 / 压暗 */
  function shade(hex, amt) {
    const c = hexToRgb(hex);
    if (amt >= 0) {
      return rgbToHex(
        c[0] + (255 - c[0]) * amt,
        c[1] + (255 - c[1]) * amt,
        c[2] + (255 - c[2]) * amt
      );
    }
    const k = 1 + amt;
    return rgbToHex(c[0] * k, c[1] * k, c[2] * k);
  }

  /** 向目标色靠拢（用于给整个场景上色：白天偏冷白，黄昏偏橙，夜景偏蓝） */
  function tint(hex, target, t) {
    return mix(hex, target, t);
  }

  /* --------------------------------------------------------
     3x5 极简像素字体
     每行用 3bit 表示，bit 顺序 高->低
     -------------------------------------------------------- */
  const FONT_3x5 = {
    'A': [0b010, 0b101, 0b111, 0b101, 0b101],
    'B': [0b110, 0b101, 0b110, 0b101, 0b110],
    'C': [0b011, 0b100, 0b100, 0b100, 0b011],
    'D': [0b110, 0b101, 0b101, 0b101, 0b110],
    'E': [0b111, 0b100, 0b110, 0b100, 0b111],
    'F': [0b111, 0b100, 0b110, 0b100, 0b100],
    'G': [0b011, 0b100, 0b101, 0b101, 0b011],
    'H': [0b101, 0b101, 0b111, 0b101, 0b101],
    'I': [0b111, 0b010, 0b010, 0b010, 0b111],
    'J': [0b001, 0b001, 0b001, 0b101, 0b010],
    'K': [0b101, 0b101, 0b110, 0b101, 0b101],
    'L': [0b100, 0b100, 0b100, 0b100, 0b111],
    'M': [0b101, 0b111, 0b111, 0b101, 0b101],
    'N': [0b101, 0b111, 0b111, 0b111, 0b101],
    'O': [0b010, 0b101, 0b101, 0b101, 0b010],
    'P': [0b110, 0b101, 0b110, 0b100, 0b100],
    'Q': [0b010, 0b101, 0b101, 0b110, 0b011],
    'R': [0b110, 0b101, 0b110, 0b101, 0b101],
    'S': [0b011, 0b100, 0b010, 0b001, 0b110],
    'T': [0b111, 0b010, 0b010, 0b010, 0b010],
    'U': [0b101, 0b101, 0b101, 0b101, 0b111],
    'V': [0b101, 0b101, 0b101, 0b101, 0b010],
    'W': [0b101, 0b101, 0b111, 0b111, 0b101],
    'X': [0b101, 0b101, 0b010, 0b101, 0b101],
    'Y': [0b101, 0b101, 0b010, 0b010, 0b010],
    'Z': [0b111, 0b001, 0b010, 0b100, 0b111],
    '0': [0b111, 0b101, 0b101, 0b101, 0b111],
    '1': [0b010, 0b110, 0b010, 0b010, 0b111],
    '2': [0b111, 0b001, 0b111, 0b100, 0b111],
    '3': [0b111, 0b001, 0b111, 0b001, 0b111],
    '4': [0b101, 0b101, 0b111, 0b001, 0b001],
    '5': [0b111, 0b100, 0b111, 0b001, 0b111],
    '6': [0b111, 0b100, 0b111, 0b101, 0b111],
    '7': [0b111, 0b001, 0b001, 0b001, 0b001],
    '8': [0b111, 0b101, 0b111, 0b101, 0b111],
    '9': [0b111, 0b101, 0b111, 0b001, 0b111],
    ' ': [0, 0, 0, 0, 0],
    '-': [0, 0, 0b111, 0, 0],
    '.': [0, 0, 0, 0, 0b010],
    '/': [0b001, 0b001, 0b010, 0b100, 0b100],
    '*': [0b101, 0b010, 0b111, 0b010, 0b101]
  };

  /* --------------------------------------------------------
     导出
     -------------------------------------------------------- */
  global.PX = {
    VW: VW,
    VH: VH,
    PixelCanvas: PixelCanvas,
    makeRng: makeRng,
    rngInt: rngInt,
    rngPick: rngPick,
    makeNoise1D: makeNoise1D,
    hash01: hash01,
    mix: mix,
    shade: shade,
    tint: tint,
    hexToRgb: hexToRgb,
    rgbToHex: rgbToHex,
    clamp: function (v, a, b) { return v < a ? a : v > b ? b : v; },
    lerp: function (a, b, t) { return a + (b - a) * t; },
    smoothstep: function (t) { return t * t * (3 - 2 * t); }
  };
})(window);
