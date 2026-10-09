/* ============================================================
   scene.js — 动态层：人物 / 动物 / 列车
   人物为 7x14 像素小人，行走用 2 帧切换（像素风经典做法）。
   行为：站台上随机走动、偶尔停留、坐下；夜间减少活动。
   ============================================================ */
(function (global) {
  'use strict';

  const VW = SPR.VW;
  const PLAT = SPR.PLATFORM_Y;
  const SHORE = SPR.SHORE;

  // 从 PX 命名空间取出随机工具
  const makeRng = PX.makeRng;
  const rngInt = PX.rngInt;
  const rngPick = PX.rngPick;

  // 皮肤 / 头发 / 衣服配色池（取自视频里的小人配色）
  const SKIN = ['#f0c8a0', '#e0b088', '#c89068', '#a06848', '#785038'];
  const HAIR = ['#3a2a20', '#6a4028', '#a06838', '#d8c078', '#2a2a30', '#8a4a4a', '#4a5a8a'];
  const SHIRT = [
    '#d8504a', '#4a80c8', '#e0a038', '#5aa860', '#8a5ac0',
    '#e07898', '#38a0a8', '#e8e0d0', '#6a7a48', '#c87840'
  ];
  const PANTS = ['#3a4a68', '#5a4030', '#2a2a34', '#6a6a70', '#405060'];

  /* =========================================================
     小人绘制
     7x14：头(3行) + 身(6行) + 腿(5行)
     frame: 0 站立 / 1 左腿前 / 2 右腿前
     ========================================================= */
  function drawPerson(pc, p, frame, P) {
    const x = Math.round(p.x);
    const y = Math.round(p.y);   // y = 脚下
    const S = SKIN[p.skin];
    const H = HAIR[p.hair];
    const C = SHIRT[p.shirt];
    const N = PANTS[p.pants];

    // 夜间整体压暗（在场景层统一做，这里只画本色）
    const top = y - 14;

    // 头
    pc.rect(x + 1, top, 5, 1, S);
    pc.rect(x, top + 1, 7, 3, S);
    // 头发
    pc.rect(x + 1, top - 1, 5, 1, H);
    pc.rect(x, top, 1, 2, H);
    pc.rect(x + 6, top, 1, 2, H);
    // 眼睛
    pc.px(x + 2, top + 2, '#2a2028');
    pc.px(x + 4, top + 2, '#2a2028');
    // 脖子
    pc.rect(x + 2, top + 4, 3, 1, PX.shade(S, -0.15));

    // 身体
    pc.rect(x + 1, top + 5, 5, 5, C);
    pc.rect(x, top + 6, 1, 3, C);       // 左臂
    pc.rect(x + 6, top + 6, 1, 3, C);   // 右臂
    pc.px(x, top + 9, PX.shade(S, -0.05));   // 手
    pc.px(x + 6, top + 9, PX.shade(S, -0.05));
    // 衣服阴影
    pc.vline(x + 5, top + 5, 5, PX.shade(C, -0.15));

    // 腿（按帧摆动）
    const ly = top + 10;
    if (p.state === 'sit') {
      // 坐姿
      pc.rect(x + 1, ly, 5, 3, N);
      pc.rect(x + 1, ly + 3, 2, 1, '#2a2a30');
      pc.rect(x + 4, ly + 3, 2, 1, '#2a2a30');
    } else if (p.state === 'stand' || frame === 0) {
      pc.rect(x + 1, ly, 2, 4, N);
      pc.rect(x + 4, ly, 2, 4, N);
      pc.rect(x + 1, ly + 4, 2, 1, '#2a2a30');
      pc.rect(x + 4, ly + 4, 2, 1, '#2a2a30');
    } else {
      // 行走：前后腿错开
      if (frame === 1) {
        pc.rect(x + 1, ly, 2, 3, N);
        pc.rect(x + 3, ly + 1, 2, 2, N);
        pc.rect(x, ly + 3, 2, 1, '#2a2a30');
        pc.rect(x + 4, ly + 3, 2, 1, '#2a2a30');
      } else {
        pc.rect(x + 3, ly, 2, 3, N);
        pc.rect(x + 1, ly + 1, 2, 2, N);
        pc.rect(x, ly + 3, 2, 1, '#2a2a30');
        pc.rect(x + 4, ly + 3, 2, 1, '#2a2a30');
      }
    }
  }

  /* =========================================================
     自行车（简化为两个轮 + 车架 + 骑车人姿态）
     ========================================================= */
  function drawBike(pc, p, frame) {
    const x = Math.round(p.x);
    const y = Math.round(p.y);
    const C = SHIRT[p.shirt];

    // 轮
    pc.ring(x + 3, y - 4, 4, '#2a2a30');
    pc.ring(x + 12, y - 4, 4, '#2a2a30');
    pc.px(x + 3, y - 4, '#6a6a70');
    pc.px(x + 12, y - 4, '#6a6a70');
    // 车架
    pc.rect(x + 6, y - 6, 5, 1, '#c04a3c');
    pc.rect(x + 5, y - 8, 1, 4, '#c04a3c');
    pc.rect(x + 8, y - 9, 4, 1, '#c04a3c');
    // 骑车人
    const S = SKIN[p.skin];
    pc.rect(x + 4, y - 18, 5, 1, HAIR[p.hair]);
    pc.rect(x + 3, y - 17, 7, 3, S);
    pc.px(x + 5, y - 16, '#2a2028');
    pc.rect(x + 4, y - 14, 5, 4, C);
    pc.rect(x + 8, y - 13, 3, 1, C);   // 手臂伸向车把
    pc.rect(x + 4, y - 10, 2, 3, PANTS[p.pants]);
    pc.rect(x + 7, y - 10, 2, 3, PANTS[p.pants]);
  }

  /* =========================================================
     狗
     ========================================================= */
  function drawDog(pc, p, frame) {
    const x = Math.round(p.x);
    const y = Math.round(p.y);
    const C = p.dark ? '#4a3a30' : '#c8a070';
    // 身
    pc.rect(x, y - 5, 8, 3, C);
    // 头
    pc.rect(x + (p.dir > 0 ? 7 : -3), y - 7, 3, 3, C);
    // 耳
    pc.px(x + (p.dir > 0 ? 9 : -3), y - 8, PX.shade(C, -0.2));
    // 尾
    pc.px(x + (p.dir > 0 ? -1 : 8), y - 6, C);
    // 腿
    const lf = frame === 1 ? 0 : 1;
    pc.rect(x + 1, y - 2, 1, 2, PX.shade(C, -0.2));
    pc.rect(x + 3 + lf, y - 2, 1, 2, PX.shade(C, -0.2));
    pc.rect(x + 5, y - 2, 1, 2, PX.shade(C, -0.2));
    pc.rect(x + 6 - lf, y - 2, 1, 2, PX.shade(C, -0.2));
  }

  /* =========================================================
     列车
     车厢沿铁轨从右向左驶入，站台停靠后驶离
     ========================================================= */
  function Train() {
    this.reset();
  }

  Train.prototype.reset = function () {
    this.active = false;
    this.x = VW + 140;          // 车头 x
    this.speed = 0;
    this.state = 'idle';       // idle | approach | stop | depart
    this.timer = 0;
    this.cars = 3;
    this.stopped = false;
  };

  Train.prototype.call = function () {
    if (this.active) return;
    this.reset();
    this.active = true;
    this.state = 'approach';
    this.x = VW + 140;
  };

  Train.prototype.update = function (dt, P) {
    if (!this.active) return;
    this.timer += dt;
    switch (this.state) {
      case 'approach':
        this.speed = PX.lerp(this.speed, 1.5, 0.02);
        this.x -= this.speed;
        if (this.x <= 150) { this.x = 150; this.state = 'stop'; this.timer = 0; this.stopped = true; }
        break;
      case 'stop':
        this.speed *= 0.86;
        if (this.timer > 6) { this.state = 'depart'; this.timer = 0; }
        break;
      case 'depart':
        this.speed = PX.lerp(this.speed, 2.4, 0.03);
        this.x -= this.speed;
        if (this.x < -260) { this.reset(); }
        break;
    }
  };

  /** 单节车厢，x 为车头位置 */
  function drawCar(pc, x, P, lights, isHead) {
    const cw = 56, ch = 22;
    const y = PLAT - ch + 4;

    // 车体主色（薄荷绿 + 米白，原视频配色）
    pc.rect(x, y + 4, cw, ch - 4, '#d8e4d8');
    pc.rect(x, y + 4, cw, 8, '#4a9a8a');
    pc.rect(x, y + 4, cw, 1, PX.shade('#4a9a8a', 0.2));
    // 腰线
    pc.hline(x, y + 12, cw, '#e8c86a');
    // 底盘
    pc.rect(x, y + ch - 3, cw, 3, '#3a4048');
    // 车窗
    for (let i = 0; i < 5; i++) {
      const wx = x + 4 + i * 10;
      pc.rect(wx, y + 6, 7, 6, P.lightOn > 0.15 ? PX.mix('#3a5a68', '#ffe8a8', P.lightOn) : '#3a5a68');
      pc.rect(wx, y + 6, 7, 1, PX.shade('#3a5a68', 0.25));
      // 夜间车内灯
      if (P.lightOn > 0.2) {
        pc.glow(wx + 3, y + 9, 12, '#ffd88a', P.lightOn * 0.28);
      }
    }
    // 门
    pc.rect(x + cw - 16, y + 5, 4, 13, '#3a6060');
    pc.rect(x + cw - 16, y + 5, 4, 1, '#5a8a8a');

    // 转向架
    pc.rect(x + 6, y + ch, 10, 3, '#2a2a30');
    pc.rect(x + cw - 18, y + ch, 10, 3, '#2a2a30');

    // 车头（驾驶室 + 前灯）
    if (isHead) {
      pc.rect(x, y, 6, 5, '#4a9a8a');
      pc.rect(x + 1, y + 1, 4, 3, '#3a5a68');
      // 前灯
      const lamp = P.lightOn > 0.2;
      pc.rect(x, y + 6, 2, 3, lamp ? '#fff0b0' : '#c8c0a0');
      if (lamp) {
        // 前照灯光锥
        pc.ctx.save();
        pc.ctx.globalAlpha = P.lightOn * 0.16;
        pc.ctx.fillStyle = '#ffe8a0';
        pc.ctx.beginPath();
        pc.ctx.moveTo(x, y + 7);
        pc.ctx.lineTo(x - 90, y + 30);
        pc.ctx.lineTo(x - 90, y - 16);
        pc.ctx.closePath();
        pc.ctx.fill();
        pc.ctx.restore();
        pc.glow(x, y + 7, 24, '#ffe8a0', P.lightOn * 0.5);
        lights.push({ x: x, y: y + 7, r: 26, c: '#ffe8a0', s: P.lightOn * 0.4 });
      }
    }
  }

  function drawTrain(pc, train, P, lights) {
    if (!train.active) return;
    for (let i = 0; i < train.cars; i++) {
      const x = train.x - i * 58;
      if (x > VW + 60 || x < -60) continue;
      drawCar(pc, x, P, lights, i === 0);
    }
  }

  /* =========================================================
     人群系统
     ========================================================= */
  function Crowd(count) {
    this.people = [];
    this.dogs = [];
    const rng = makeRng(88231);
    for (let i = 0; i < count; i++) {
      this.people.push(this.makePerson(rng, true));
    }
    for (let i = 0; i < 3; i++) {
      this.dogs.push({
        x: rng() * VW, y: PLAT + 10 + rng() * 6,
        dir: rng() < 0.5 ? -1 : 1,
        speed: 0.16 + rng() * 0.1,
        state: 'walk', timer: rng() * 4,
        dark: rng() < 0.4,
        frame: 0, ft: 0
      });
    }
  }

  Crowd.prototype.makePerson = function (rng, onPlatform) {
    const kind = rng();
    let type = 'walk';
    if (kind < 0.12) type = 'bike';
    else if (kind < 0.2) type = 'sitter';
    return {
      x: rng() * VW,
      y: onPlatform ? PLAT + 4 + rng() * 12 : SHORE - 6 + rng() * 10,
      dir: rng() < 0.5 ? -1 : 1,
      speed: 0.1 + rng() * 0.22,
      type: type,
      state: type === 'sitter' ? 'sit' : (rng() < 0.3 ? 'stand' : 'walk'),
      timer: rng() * 6,
      frame: 0,
      ft: 0,
      skin: rngInt(rng, 0, SKIN.length - 1),
      hair: rngInt(rng, 0, HAIR.length - 1),
      shirt: rngInt(rng, 0, SHIRT.length - 1),
      pants: rngInt(rng, 0, PANTS.length - 1),
      onPlatform: onPlatform
    };
  };

  Crowd.prototype.update = function (dt, P) {
    // 夜间人流明显减少
    const activity = P.isNight ? 0.25 : 1;

    for (let i = 0; i < this.people.length; i++) {
      const p = this.people[i];
      p.timer -= dt;

      // 状态切换
      if (p.timer <= 0) {
        if (p.state === 'walk') {
          p.state = rngChance(PX.hash01(i, Math.floor(p.timer * 7) + i, 3)) < 0.4 * activity ? 'stand' : 'walk';
          if (p.state === 'stand' && p.type === 'sitter') p.state = 'sit';
          p.timer = 1.5 + (p.x * 7 % 5);
        } else {
          p.state = (p.type === 'sitter') ? 'sit' : 'walk';
          p.timer = 2 + (p.x * 13 % 6);
        }
        if (rngChance(PX.hash01(i, Math.floor(p.timer * 3) + 7, 5)) < 0.25) {
          p.dir *= -1;
        }
      }

      // 位移
      if (p.state === 'walk' && activity > 0.2) {
        p.x += p.speed * p.dir * dt * 60 * activity;
      }
      // 边界反弹
      if (p.x < 4) { p.x = 4; p.dir = 1; }
      if (p.x > VW - 12) { p.x = VW - 12; p.dir = -1; }

      // 走路帧动画
      if (p.state === 'walk') {
        p.ft += dt * 6;
        p.frame = (p.ft % 2 < 1) ? 1 : 2;
      } else {
        p.frame = 0;
      }
    }

    // 狗
    for (let i = 0; i < this.dogs.length; i++) {
      const d = this.dogs[i];
      d.x += d.speed * d.dir * dt * 60 * activity;
      if (d.x < 6) { d.x = 6; d.dir = 1; }
      if (d.x > VW - 14) { d.x = VW - 14; d.dir = -1; }
      d.ft += dt * 6;
      d.frame = (d.ft % 2 < 1) ? 1 : 2;
    }
  };

  Crowd.prototype.draw = function (pc, P) {
    // 远景人群（岸边）先画
    for (let i = 0; i < this.people.length; i++) {
      const p = this.people[i];
      if (!p.onPlatform) drawPerson(pc, p, p.frame, P);
    }
    for (let i = 0; i < this.dogs.length; i++) {
      const d = this.dogs[i];
      if (d.y < PLAT + 6) drawDog(pc, d, d.frame);
    }
    // 站台人群
    for (let i = 0; i < this.people.length; i++) {
      const p = this.people[i];
      if (p.onPlatform) {
        if (p.type === 'bike') drawBike(pc, p, p.frame);
        else drawPerson(pc, p, p.frame, P);
      }
    }
    for (let i = 0; i < this.dogs.length; i++) {
      const d = this.dogs[i];
      if (d.y >= PLAT + 6) drawDog(pc, d, d.frame);
    }
  };

  function rngChance(v) {
    const f = v - Math.floor(v);
    return f;
  }

  /* =========================================================
     帆船 / 渔船（海面上）
     ========================================================= */
  function Boats() {
    const rng = makeRng(6060);
    this.list = [];
    for (let i = 0; i < 4; i++) {
      this.list.push({
        x: rng() * VW,
        y: SPR.HORIZON + 6 + rng() * (SHORE - SPR.HORIZON - 18),
        s: 0.6 + rng() * 0.7,
        spd: 0.06 + rng() * 0.1,
        sail: rng() < 0.5,
        ph: rng() * 6.28
      });
    }
  }

  Boats.prototype.update = function (dt) {
    for (let i = 0; i < this.list.length; i++) {
      const b = this.list[i];
      b.x += b.spd * dt * 60;
      b.ph += dt * 1.6;
      if (b.x > VW + 20) b.x = -20;
    }
  };

  Boats.prototype.draw = function (pc, P) {
    for (let i = 0; i < this.list.length; i++) {
      const b = this.list[i];
      const bob = Math.round(Math.sin(b.ph) * 0.8);
      const x = Math.round(b.x), y = Math.round(b.y) + bob;
      const s = b.s;
      if (b.sail) {
        // 帆船：三角帆 + 船体
        const h = Math.round(7 * s);
        for (let k = 0; k < h; k++) {
          const half = Math.round((k / h) * 3 * s);
          pc.vline(x, y - h + k, half * 2 + 1, P.skyLow === undefined ? '#ffffff' : '#f0f4f8');
        }
        pc.vline(x, y - h, h, '#c8b0a0');
        pc.rect(x - Math.round(3 * s), y, Math.round(7 * s), Math.max(1, Math.round(2 * s)), '#8a5a48');
      } else {
        // 渔船：船体 + 驾驶舱
        const w = Math.round(9 * s);
        pc.rect(x - Math.floor(w / 2), y, w, Math.max(1, Math.round(2 * s)), '#5a6a78');
        pc.rect(x - 1, y - Math.round(3 * s), 3, Math.round(3 * s), '#d8d0c0');
      }
    }
  };

  global.SCENE = {
    Crowd: Crowd,
    Train: Train,
    Boats: Boats,
    drawPerson: drawPerson,
    drawDog: drawDog,
    drawBike: drawBike,
    drawTrain: drawTrain
  };
})(window);
