/* ============================================================
   sprites.js — 场景静态构件绘制
   包含：天空 / 星空 / 日月 / 云 / 海面 / 岛屿 / 灯塔 /
         站台 / 候车室 / 站牌 / 路灯 / 长椅 / 冰淇淋车 /
         草地 / 前景草丛
   所有绘制都读当前调色板 P，保证昼夜自动变色。
   ============================================================ */
(function (global) {
  'use strict';

  const VW = 480;
  const VH = 270;

  // 从 PX 命名空间取出随机工具（本文件内多处使用）
  const makeRng = PX.makeRng;
  const rngInt = PX.rngInt;
  const rngPick = PX.rngPick;
  const hash01 = PX.hash01;
  const lerp = PX.lerp;
  const clamp = PX.clamp;

  // ---- 关键地平线与分层高度（与原视频构图对齐）----
  const HORIZON = 118;      // 海天分界
  const SHORE = 150;        // 岸线（海结束）
  const FIELD_TOP = 152;    // 草地起始
  const PLATFORM_Y = 196;   // 站台木板面
  const PLATFORM_FRONT = 214;
  const BOTTOM = 250;       // 前景草起始

  /* =========================================================
     星空
     ========================================================= */
  const STARS = (function () {
    const rng = PX.makeRng(20260928);
    const arr = [];
    for (let i = 0; i < 90; i++) {
      arr.push({
        x: rngInt(rng, 0, VW - 1),
        y: rngInt(rng, 0, HORIZON - 8),
        b: 0.3 + rng() * 0.7,          // 基础亮度
        tw: rng() * Math.PI * 2,       // 闪烁相位
        tws: 0.5 + rng() * 1.6,        // 闪烁速度
        c: rng() < 0.2 ? '#cfe4ff' : (rng() < 0.4 ? '#ffe9c8' : '#ffffff')
      });
    }
    return arr;
  })();

  function drawStars(pc, P, t) {
    if (P.starAlpha <= 0.01) return;
    for (let i = 0; i < STARS.length; i++) {
      const s = STARS[i];
      // 越靠近地平线星星越淡（大气消光）
      const hz = PX.clamp(1 - s.y / HORIZON, 0.15, 1);
      const tw = 0.75 + 0.25 * Math.sin(t * s.tws + s.tw);
      const a = s.b * tw * hz * P.starAlpha;
      if (a < 0.06) continue;
      pc.ctx.globalAlpha = a;
      pc.px(s.x, s.y, s.c);
    }
    pc.ctx.globalAlpha = 1;
  }

  /* =========================================================
     太阳 / 月亮
     路径：日出左侧偏上 -> 正午接近顶部 -> 日落右侧偏下
     ========================================================= */
  function celestialPos(hour) {
    // 6:00 日出，12:00 最高，18:00 日落；夜间月亮走同样轨迹
    let t;
    if (hour >= 6 && hour <= 18) {
      t = (hour - 6) / 12;                     // 0..1
    } else if (hour > 18) {
      t = (hour - 18) / 12;                    // 夜间 0..1（月亮升起）
    } else {
      t = (hour + 6) / 12;                     // 凌晨（月亮西沉）
    }
    const x = lerp(40, VW - 40, t);
    // 抛物线路径：t=0.5 时最高
    const y = HORIZON - Math.sin(t * Math.PI) * (HORIZON - 22) - 12;
    return { x: x, y: y, t: t };
  }

  function drawSunMoon(pc, P, hour) {
    const pos = celestialPos(hour);
    const isDay = hour >= 6 && hour <= 18;
    // 过渡带（晨昏）地平线附近也画，视觉上正好是"落日"
    const visible = isDay || P.isNight;
    if (!visible) return;

    const c = P.sunColor;

    // 外层光晕
    pc.glow(pos.x, pos.y, isDay ? 22 : 15, c, P.sunGlow);

    if (isDay) {
      // 太阳：实心圆盘 + 更亮的芯
      pc.disc(pos.x, pos.y, 7, c);
      pc.disc(pos.x, pos.y, 5, PX.shade(c, 0.5));
      // 十字光芒（像素风常见手法）
      pc.ctx.globalAlpha = 0.5;
      pc.hline(pos.x - 11, pos.y, 23, c);
      pc.vline(pos.x, pos.y - 11, 23, c);
      pc.ctx.globalAlpha = 1;
    } else {
      // 月亮：带月牙阴影 + 环形山
      pc.disc(pos.x, pos.y, 7, c);
      pc.disc(pos.x + 3, pos.y - 2, 6, P.sky[1]);
      pc.px(pos.x - 2, pos.y - 1, PX.shade(c, -0.22));
      pc.px(pos.x + 1, pos.y + 2, PX.shade(c, -0.22));
      pc.px(pos.x - 3, pos.y + 2, PX.shade(c, -0.18));
    }
  }

  /* =========================================================
     云
     3 个视差层，形状由若干"棉块"叠加而成
     ========================================================= */
  const CLOUDS = (function () {
    const rng = PX.makeRng(77123);
    const defs = [];
    // layer: 0 远(慢小) 1 中 2 近(快大)
    const layerCfg = [
      { n: 5, y: [14, 52], w: [26, 44], h: [7, 11], spd: 1.2 },
      { n: 5, y: [6, 74], w: [38, 66], h: [9, 15], spd: 2.4 },
      { n: 3, y: [8, 86], w: [58, 92], h: [13, 21], spd: 4.2 }
    ];
    for (let L = 0; L < layerCfg.length; L++) {
      const cfg = layerCfg[L];
      for (let i = 0; i < cfg.n; i++) {
        const w = rngInt(rng, cfg.w[0], cfg.w[1]);
        const h = rngInt(rng, cfg.h[0], cfg.h[1]);
        // 棉块：3-5 个椭圆拼成蓬松轮廓
        const puffs = [];
        const pn = rngInt(rng, 3, 5);
        for (let p = 0; p < pn; p++) {
          puffs.push({
            dx: (p / (pn - 1) - 0.5) * (w * 0.72),
            dy: (rng() - 0.5) * h * 0.34,
            rx: (w / pn) * (0.55 + rng() * 0.35),
            ry: h * (0.5 + rng() * 0.35)
          });
        }
        defs.push({
          layer: L,
          x: rng() * VW,
          y: rngInt(rng, cfg.y[0], cfg.y[1]),
          w: w, h: h,
          puffs: puffs,
          spd: cfg.spd * (0.7 + rng() * 0.6)
        });
      }
    }
    return defs;
  })();

  function drawClouds(pc, P, t) {
    for (let i = 0; i < CLOUDS.length; i++) {
      const c = CLOUDS[i];
      // 视差滚动（近层更快）
      let x = c.x - t * c.spd;
      x = ((x % (VW + 140)) + VW + 140) % (VW + 140) - 70;

      const base = c.layer === 0 ? P.cloud : PX.mix(P.cloud, P.cloudLit, 0.25);
      const lit = c.layer === 0 ? PX.mix(P.cloud, P.cloudLit, 0.4) : P.cloudLit;
      const dark = PX.shade(base, -0.18);

      // 先画暗部（下沉），再画主体，再画顶部高光
      for (let p = 0; p < c.puffs.length; p++) {
        const pf = c.puffs[p];
        ellipsePx(pc, x + pf.dx, c.y + pf.dy + 1, pf.rx, pf.ry, dark);
      }
      for (let p = 0; p < c.puffs.length; p++) {
        const pf = c.puffs[p];
        ellipsePx(pc, x + pf.dx, c.y + pf.dy, pf.rx, pf.ry, base);
      }
      for (let p = 0; p < c.puffs.length; p++) {
        const pf = c.puffs[c.puffs.length - 1 - p];
        ellipsePx(pc, x + pf.dx, c.y + pf.dy - 1, pf.rx * 0.62, pf.ry * 0.55, lit);
      }
    }
  }

  /** 像素椭圆填充 */
  function ellipsePx(pc, cx, cy, rx, ry, color) {
    if (rx < 1) rx = 1;
    if (ry < 1) ry = 1;
    const y0 = Math.floor(cy - ry), y1 = Math.ceil(cy + ry);
    for (let y = y0; y <= y1; y++) {
      const dy = (y - cy) / ry;
      const s = 1 - dy * dy;
      if (s <= 0) continue;
      const half = Math.sqrt(s) * rx;
      pc.rect(Math.round(cx - half), y, Math.max(1, Math.round(half * 2)), 1, color);
    }
  }

  /* =========================================================
     海面
     3 条色带 + 波光 + 太阳/月亮倒影
     ========================================================= */
  const WAVES = (function () {
    const rng = PX.makeRng(5150);
    const arr = [];
    for (let i = 0; i < 150; i++) {
      const yy = HORIZON + rng() * (SHORE - HORIZON);
      const depth = (yy - HORIZON) / (SHORE - HORIZON);   // 0 远 1 近
      arr.push({
        x: rng() * (VW + 20) - 10,
        y: yy,
        len: 2 + Math.round(rng() * 3 + depth * 5),
        spd: 0.25 + rng() * 0.7,
        ph: rng() * Math.PI * 2,
        b: 0.35 + rng() * 0.65
      });
    }
    return arr;
  })();

  function drawSea(pc, P, t, hour) {
    // 主体色带
    const h = SHORE - HORIZON;
    const bands = 7;
    for (let i = 0; i < bands; i++) {
      const t0 = i / (bands - 1);
      const y0 = Math.round(HORIZON + (i * h) / bands);
      const y1 = Math.round(HORIZON + ((i + 1) * h) / bands);
      const col = P.sea[Math.min(2, Math.floor(t0 * 3))];
      pc.rect(0, y0, VW, Math.max(1, y1 - y0), col);
    }

    // 海平线亮边
    pc.hline(0, HORIZON, VW, PX.mix(P.seaFoam, P.sky[2], 0.4));

    // 波光
    for (let i = 0; i < WAVES.length; i++) {
      const w = WAVES[i];
      let x = w.x + Math.sin(t * w.spd + w.ph) * 3 - t * w.spd * 0.35;
      x = ((x % (VW + 12)) + VW + 12) % (VW + 12) - 6;
      const depth = (w.y - HORIZON) / h;
      const col = depth > 0.55 ? PX.mix(P.seaFoam, '#ffffff', 0.35) : P.seaFoam;
      pc.ctx.globalAlpha = w.b * (0.35 + depth * 0.5);
      pc.hline(Math.round(x), w.y, w.len, col);
    }
    pc.ctx.globalAlpha = 1;

    // 日月倒影光带（垂直于天体 x 坐标的闪烁光斑）
    const pos = celestialPos(hour);
    if (pos.y < HORIZON) {
      const isDay = hour >= 6 && hour <= 18;
      if (isDay || P.isNight) {
        const c = P.sunColor;
        const intensity = isDay ? 0.5 : 0.34;
        for (let y = HORIZON + 1; y < SHORE; y++) {
          const d = (y - HORIZON) / (SHORE - HORIZON);
          const wSpan = 3 + d * 16;
          const flick = Math.sin(t * 2.2 + y * 0.9) * 0.5 + 0.5;
          const n = 1 + Math.round(wSpan / 4);
          for (let k = 0; k < n; k++) {
            const ox = (k / Math.max(1, n - 1) - 0.5) * wSpan;
            const jx = Math.round(pos.x + ox + Math.sin(t * 3 + y * 1.7 + k) * 2.5);
            pc.ctx.globalAlpha = intensity * (1 - d * 0.55) * (0.35 + flick * 0.65);
            pc.rect(jx, y, 2 + Math.round(d * 2), 1, c);
          }
        }
        pc.ctx.globalAlpha = 1;
      }
    }
  }

  /* =========================================================
     远处岛屿 + 灯塔 + 灯塔光束
     ========================================================= */
  function drawIsland(pc, P, t, hour) {
    const bx = 300, by = SHORE - 12;   // 岛基

    // 岛屿主体（草坡）
    for (let x = 0; x < 176; x++) {
      const k = x / 176;
      // 岛形：中间隆起
      const rise = Math.sin(k * Math.PI) * 16;
      const top = Math.round(by - rise - 3);
      pc.vline(bx + x, top, by - top, P.grass);
      // 顶部受光
      pc.px(bx + x, top, P.grassLight);
      // 底部礁石
      if ((x * 7) % 13 < 3) pc.px(bx + x, by - 1, PX.shade(P.grassDark, -0.2));
    }
    // 沙滩
    for (let x = 0; x < 176; x++) {
      if ((x * 5) % 7 < 4) pc.px(bx + x, by - 1, PX.mix(P.grassLight, '#e0d8b0', 0.55));
    }

    // 岛上小屋
    const hx = bx + 108, hy = by - 12;
    pc.rect(hx, hy - 7, 12, 7, '#e8e0d0');
    pc.rect(hx - 1, hy - 9, 14, 2, '#b04838');      // 屋顶
    pc.rect(hx + 3, hy - 4, 3, 4, PX.shade(P.wood, -0.1));
    pc.rect(hx + 8, hy - 5, 3, 3, '#9ac8dc');      // 窗

    // 灯塔（红白条纹）
    const lx = bx + 62, ly = by - 26;
    const lh = 26;
    for (let i = 0; i < lh; i++) {
      const y = ly + i;
      const w = i < 4 ? 7 : (i < 8 ? 6 : 5);
      const col = (Math.floor(i / 3) % 2 === 0) ? '#e8e4dc' : '#d0483c';
      pc.rect(lx - Math.floor(w / 2), y, w, 1, col);
    }
    // 灯室
    pc.rect(lx - 3, ly - 4, 6, 4, '#3a4450');
    pc.rect(lx - 2, ly - 3, 4, 3, '#ffe27a');
    pc.rect(lx - 4, ly - 5, 8, 1, '#3a4450');

    // 夜间灯光
    if (P.lightOn > 0.3) {
      pc.glow(lx, ly - 2, 16, '#ffe27a', P.lightOn * 0.55);
      // 旋转光束：沿光轴铺一串递减的软光斑，而不是画一个硬边三角形
      // （硬边三角在 lighter 混合下会在天空留下明显的斜切色块）
      const sweep = Math.sin(t * 0.55);
      if (sweep > 0.15) {
        const dir = sweep > 0 ? 1 : -1;      // 往右/往左扫
        const strength = P.lightOn * 0.5 * Math.abs(sweep);
        const steps = 16;
        for (let i = 1; i <= steps; i++) {
          const k = i / steps;
          const px2 = lx + dir * k * 190;
          // 光束略微下倾，始终贴着海面高度，不越到天上去
          const py2 = ly - 2 + k * 26;
          const w = 2 + Math.round(k * 9);
          const a = strength * (1 - k) * 0.30;
          if (a < 0.01) continue;
          pc.ctx.globalAlpha = a;
          pc.rect(Math.round(px2 - w / 2), Math.round(py2), w, Math.max(1, Math.round(1 + k * 4)), '#ffe9a8');
        }
        pc.ctx.globalAlpha = 1;
      }
    }
  }

  /* =========================================================
     中景草地（站台后方）+ 围栏
     ========================================================= */
  function drawField(pc, P, t) {
    const h = PLATFORM_Y - FIELD_TOP;
    // 草地基色带
    for (let y = FIELD_TOP; y < PLATFORM_Y; y++) {
      const d = (y - FIELD_TOP) / h;
      const col = d < 0.35 ? P.grassLight : (d < 0.7 ? P.grass : P.grassDark);
      pc.hline(0, y, VW, col);
    }
    // 草丛纹理
    const rng = PX.makeRng(998);
    for (let i = 0; i < 220; i++) {
      const x = rngInt(rng, 0, VW - 1);
      const y = FIELD_TOP + rngInt(rng, 0, h - 1);
      const d = (y - FIELD_TOP) / h;
      const c = rng() < 0.5 ? P.grassLight : P.grassDark;
      pc.ctx.globalAlpha = 0.3 + d * 0.4;
      pc.px(x, y, c);
    }
    pc.ctx.globalAlpha = 1;

    // 木栅栏（横向）
    const fy = FIELD_TOP + Math.round(h * 0.42);
    for (let x = 0; x < VW; x += 7) {
      pc.rect(x, fy, 2, 7, P.wood);
      pc.px(x, fy, PX.shade(P.wood, 0.25));
    }
    pc.hline(0, fy + 1, VW, PX.shade(P.wood, -0.1));
    pc.hline(0, fy + 4, VW, PX.shade(P.wood, -0.1));
  }

  /* =========================================================
     站台木板
     ========================================================= */
  function drawPlatform(pc, P) {
    const h = PLATFORM_FRONT - PLATFORM_Y;
    for (let y = PLATFORM_Y; y < PLATFORM_FRONT; y++) {
      const d = (y - PLATFORM_Y) / h;
      pc.hline(0, y, VW, d < 0.5 ? P.wood : PX.shade(P.wood, -0.08));
    }
    // 木板缝
    for (let y = PLATFORM_Y + 1; y < PLATFORM_FRONT; y += 3) {
      pc.hline(0, y, VW, PX.shade(P.wood, -0.16));
    }
    // 站台边沿（近处压暗 + 高光）
    pc.hline(0, PLATFORM_FRONT - 1, VW, PX.shade(P.woodDark, -0.1));
    pc.hline(0, PLATFORM_FRONT, VW, P.woodDark);

    // 站台基座：从 PLATFORM_FRONT 一直填到前景草起始。
    // 少了这一段，站台与前景之间会露出画布底色，形成一条黑带。
    for (let y = PLATFORM_FRONT; y < BOTTOM; y++) {
      const d = (y - PLATFORM_FRONT) / Math.max(1, BOTTOM - PLATFORM_FRONT);
      // 越往下越暗（近景阴影），最底部与前景草衔接
      const base = d < 0.35 ? PX.shade(P.woodDark, -0.05)
        : (d < 0.7 ? PX.shade(P.woodDark, -0.18) : PX.shade(P.grassDark, -0.12));
      pc.hline(0, y, VW, base);
    }
    // 基座上的横向枕木纹理
    for (let y = PLATFORM_FRONT + 4; y < BOTTOM; y += 7) {
      pc.ctx.globalAlpha = 0.25;
      pc.hline(0, y, VW, PX.shade(P.woodDark, -0.34));
      pc.ctx.globalAlpha = 1;
    }
    // 基座与前景草之间的过渡行（避免硬边）
    pc.hline(0, BOTTOM - 1, VW, PX.shade(P.grassDark, -0.05));
  }

  /* =========================================================
     候车室（WAITING ROOM 小屋）
     ========================================================= */
  function drawWaitingRoom(pc, P, t, lights) {
    const x = 14, y = 148, w = 88, h = PLATFORM_Y + 6 - y;

    // 墙体（木板纹）
    for (let yy = 0; yy < h; yy++) {
      const d = yy / h;
      pc.hline(x, y + yy, w, d < 0.3 ? PX.shade(P.wood, 0.1) : P.wood);
    }
    // 竖向板缝
    for (let xx = 4; xx < w; xx += 7) {
      pc.vline(x + xx, y + 8, h - 8, PX.shade(P.wood, -0.14));
    }
    // 底部阴影
    pc.hline(x, y + h - 3, w, P.woodDark);

    // 屋顶（斜面 + 瓦片）
    const rh = 15;
    for (let i = 0; i < rh; i++) {
      const rw = w + 8 - i * 2;
      const rx = x - 4 + i;
      pc.rect(rx, y - rh + i, rw, 1, i < 2 ? PX.shade(P.woodDark, 0.2) : PX.shade(P.woodDark, -0.05));
    }
    // 屋檐
    pc.hline(x - 5, y - 1, w + 10, PX.shade(P.woodDark, 0.3));

    // 招牌 "WAITING ROOM"
    const signW = 62, signH = 11;
    const sx = x + Math.floor((w - signW) / 2), sy = y - rh - signH - 1;
    pc.rect(sx - 1, sy - 1, signW + 2, signH + 2, PX.shade(P.woodDark, -0.25));
    pc.rect(sx, sy, signW, signH, PX.mix(P.wood, '#e8dcc0', 0.55));
    pc.ctx.globalAlpha = 0.9;
    pc.text('WAITING', sx + 2, sy + 2, '#2a2018', 1);
    pc.text('ROOM', sx + 2 + 4 * 8, sy + 2, '#2a2018', 1);
    pc.ctx.globalAlpha = 1;

    // 窗户 ×2
    const winY = y + 16, winH = 16, winW = 15;
    const wins = [x + 9, x + w - 9 - winW];
    for (let i = 0; i < wins.length; i++) {
      const wx = wins[i];
      // 窗框
      pc.rect(wx - 1, winY - 1, winW + 2, winH + 2, PX.shade(P.woodDark, -0.1));
      // 玻璃
      pc.rect(wx, winY, winW, winH, '#5a94ac');
      // 玻璃反光
      pc.rect(wx + 1, winY + 1, 4, 6, '#a8d4e4');
      // 窗格
      pc.vline(wx + Math.floor(winW / 2), winY, winH, PX.shade(P.woodDark, 0.1));
      pc.hline(wx, winY + Math.floor(winH / 2), winW, PX.shade(P.woodDark, 0.1));
      // 窗台
      pc.hline(wx - 2, winY + winH + 1, winW + 4, PX.shade(P.wood, -0.2));

      // 夜间窗内暖光
      if (P.lightOn > 0.15) {
        pc.rect(wx, winY, winW, winH, PX.mix('#5a94ac', '#ffd88a', P.lightOn * 0.85));
        pc.glow(wx + winW / 2, winY + winH / 2, 16, '#ffc86a', P.lightOn * 0.42);
        lights.push({ x: wx + winW / 2, y: winY + winH / 2, r: 18, c: '#ffc86a', s: P.lightOn * 0.4 });
      }
    }

    // 门
    const dx = x + Math.floor(w / 2) - 8, dy = y + h - 26, dw = 16, dh = 26;
    pc.rect(dx - 1, dy - 1, dw + 2, dh + 1, PX.shade(P.woodDark, -0.15));
    pc.rect(dx, dy, dw, dh, PX.shade(P.wood, -0.28));
    pc.vline(dx + Math.floor(dw / 2), dy, dh, PX.shade(P.woodDark, -0.05));
    pc.px(dx + dw - 3, dy + Math.floor(dh / 2), '#e0c060');   // 门把
    // 门上方小窗
    pc.rect(dx + 3, dy + 3, dw - 6, 5, P.lightOn > 0.15 ? PX.mix('#5a94ac', '#ffd88a', P.lightOn) : '#5a94ac');

    // 墙上公告板
    pc.rect(x + w - 20, y + 20, 14, 12, '#d8c8a0');
    pc.strokeRect(x + w - 20, y + 20, 14, 12, PX.shade(P.woodDark, 0.1));
    for (let i = 0; i < 4; i++) pc.hline(x + w - 18, y + 22 + i * 2, 10, '#a89878');

    // 门廊灯
    const lx = x + Math.floor(w / 2) + 14, ly = y + 8;
    pc.rect(lx, ly, 3, 2, '#3a3a3a');
    pc.px(lx + 1, ly + 2, '#ffe08a');
    if (P.lightOn > 0.2) {
      pc.glow(lx + 1, ly + 3, 14, '#ffcf70', P.lightOn * 0.5);
      lights.push({ x: lx + 1, y: ly + 3, r: 16, c: '#ffcf70', s: P.lightOn * 0.45 });
    }
  }

  /* =========================================================
     站牌 SEAGLASS BAY
     ========================================================= */
  function drawStationSign(pc, P, lights) {
    const x = 178, y = 168, w = 86, h = 17;
    // 立柱
    pc.rect(x + 10, y + h, 3, 14, P.woodDark);
    pc.rect(x + w - 16, y + h, 3, 14, P.woodDark);

    // 牌面
    pc.rect(x - 1, y - 1, w + 2, h + 2, PX.shade(P.woodDark, -0.2));
    pc.rect(x, y, w, h, '#e8e4d8');
    // 上下色条
    pc.hline(x, y, w, '#c04a3c');
    pc.hline(x, y + h - 1, w, '#c04a3c');
    // 文字
    pc.text('SEAGLASS', x + 3, y + 4, '#2a2a2a', 1);
    pc.text('BAY', x + 6, y + 10, '#2a6a8a', 1);
    // 箭头
    pc.text('>>', x + w - 12, y + 10, '#2a6a8a', 1);

    if (P.lightOn > 0.2) {
      pc.glow(x + w / 2, y + h / 2, 26, '#bfe4f4', P.lightOn * 0.22);
    }
  }

  /* =========================================================
     路灯
     ========================================================= */
  function drawLamp(pc, P, lights) {
    const x = 300, top = 138, base = PLATFORM_Y + 4;
    // 杆
    pc.vline(x, top + 6, base - top - 6, '#3a4048');
    pc.vline(x + 1, top + 6, base - top - 6, '#2a3038');
    // 底座
    pc.rect(x - 3, base - 3, 8, 3, '#2a3038');
    // 灯头
    pc.rect(x - 5, top, 12, 3, '#2a3038');
    pc.rect(x - 4, top + 3, 10, 3, '#4a5058');
    // 灯泡
    pc.rect(x - 3, top + 4, 8, 3, P.lightOn > 0.15 ? '#ffe8a0' : '#c8c0a8');

    if (P.lightOn > 0.1) {
      // 灯下光锥
      pc.ctx.save();
      pc.ctx.globalAlpha = P.lightOn * 0.13;
      pc.ctx.fillStyle = '#ffd88a';
      pc.ctx.beginPath();
      pc.ctx.moveTo(x, top + 6);
      pc.ctx.lineTo(x - 42, base + 4);
      pc.ctx.lineTo(x + 42, base + 4);
      pc.ctx.closePath();
      pc.ctx.fill();
      pc.ctx.restore();

      pc.glow(x, top + 5, 30, '#ffd070', P.lightOn * 0.5);
      // 地面光斑
      pc.glow(x, base + 2, 26, '#ffcf70', P.lightOn * 0.3);
      lights.push({ x: x, y: top + 5, r: 34, c: '#ffcf70', s: P.lightOn * 0.45 });
    }
  }

  /* =========================================================
     长椅
     ========================================================= */
  function drawBench(pc, P, x) {
    const y = PLATFORM_Y - 2;
    // 椅面
    pc.rect(x, y, 26, 3, P.wood);
    pc.hline(x, y, 26, PX.shade(P.wood, 0.2));
    // 椅背
    pc.rect(x, y - 7, 26, 2, PX.shade(P.wood, -0.1));
    // 腿
    pc.rect(x + 2, y + 3, 2, 5, P.woodDark);
    pc.rect(x + 22, y + 3, 2, 5, P.woodDark);
  }

  /* =========================================================
     冰淇淋车
     ========================================================= */
  function drawIceCart(pc, P, x, lights) {
    const y = PLATFORM_Y - 4;
    // 车身
    pc.rect(x, y + 8, 30, 14, '#e8e0d0');
    pc.rect(x, y + 8, 30, 3, '#d0a8c0');
    pc.rect(x, y + 20, 30, 2, '#c8b8a0');
    // 轮子
    pc.disc(x + 7, y + 24, 3, '#3a3a3a');
    pc.disc(x + 23, y + 24, 3, '#3a3a3a');
    pc.px(x + 7, y + 24, '#8a8a8a');
    pc.px(x + 23, y + 24, '#8a8a8a');
    // 遮阳篷（粉白条纹）
    for (let i = 0; i < 6; i++) {
      const c = i % 2 === 0 ? '#e87890' : '#f0e8e0';
      pc.rect(x + i * 5, y, 5, 4, c);
    }
    pc.rect(x, y + 4, 30, 4, '#f0e8e0');
    pc.hline(x, y, 30, '#c8b8c0');
    // 支柱
    pc.rect(x + 2, y + 4, 1, 5, '#a89880');
    pc.rect(x + 27, y + 4, 1, 5, '#a89880');
    // 冰淇淋球
    pc.disc(x + 15, y - 2, 2, '#f0a0b8');
    pc.disc(x + 12, y - 3, 2, '#f8d8a0');
    pc.rect(x + 15, y - 5, 1, 3, '#c8a878');
    // 柜台灯
    if (P.lightOn > 0.15) {
      pc.glow(x + 15, y + 3, 18, '#ffcf70', P.lightOn * 0.4);
      lights.push({ x: x + 15, y: y + 3, r: 20, c: '#ffcf70', s: P.lightOn * 0.35 });
    }
  }

  /* =========================================================
     前景草丛 + 野花
     ========================================================= */
  function drawForeground(pc, P, t) {
    const h = VH - BOTTOM;
    for (let y = BOTTOM; y < VH; y++) {
      const d = (y - BOTTOM) / h;
      pc.hline(0, y, VW, d < 0.4 ? P.grass : (d < 0.75 ? P.grassLight : PX.shade(P.grassLight, 0.12)));
    }
    // 草叶
    const rng = PX.makeRng(31337);
    for (let i = 0; i < 300; i++) {
      const x = rngInt(rng, 0, VW - 1);
      const y = BOTTOM + rngInt(rng, 0, h - 2);
      const d = (y - BOTTOM) / h;
      const len = 2 + Math.round(d * 5);
      const sway = Math.sin(t * 1.1 + x * 0.15) * (0.4 + d);
      const c = d < 0.5 ? P.grassDark : P.grassLight;
      for (let k = 0; k < len; k++) {
        pc.ctx.globalAlpha = 0.75;
        pc.px(Math.round(x + sway * k * 0.5), y - k, c);
      }
    }
    pc.ctx.globalAlpha = 1;

    // 野花
    const rng2 = PX.makeRng(4242);
    for (let i = 0; i < 34; i++) {
      const x = rngInt(rng2, 0, VW - 1);
      const y = BOTTOM + rngInt(rng2, 2, h - 4);
      const d = (y - BOTTOM) / h;
      const c = rng2() < 0.4 ? '#f0e0a0' : (rng2() < 0.5 ? '#e880a8' : '#f0f0f0');
      pc.px(x, y, c);
      if (d > 0.5) pc.px(x, y - 1, PX.shade(c, 0.3));
    }
  }

  global.SPR = {
    VW: VW, VH: VH,
    HORIZON: HORIZON, SHORE: SHORE, FIELD_TOP: FIELD_TOP,
    PLATFORM_Y: PLATFORM_Y, PLATFORM_FRONT: PLATFORM_FRONT, BOTTOM: BOTTOM,
    drawStars: drawStars,
    drawSunMoon: drawSunMoon,
    celestialPos: celestialPos,
    drawClouds: drawClouds,
    drawSea: drawSea,
    drawIsland: drawIsland,
    drawField: drawField,
    drawPlatform: drawPlatform,
    drawWaitingRoom: drawWaitingRoom,
    drawStationSign: drawStationSign,
    drawLamp: drawLamp,
    drawBench: drawBench,
    drawIceCart: drawIceCart,
    drawForeground: drawForeground,
    ellipsePx: ellipsePx
  };
})(window);
