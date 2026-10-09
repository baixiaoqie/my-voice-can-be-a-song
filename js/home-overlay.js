/* ============================================================
   home-overlay.js —— 模式二：像素首页 + 同页覆盖切换 + 演奏互动

   职责（三件事，都挂在这一个文件里，因为它们共享同一个 canvas）：
     1. 像素车站作为首屏覆盖层，盖在原 #view 之上；
        点「开始」→ 淡出覆盖层 → 交还控制权给原项目场景状态机。
     2. 原项目 36 键演奏时，通过 PixelStage.pulse(index) 触发场景互动：
        涟漪 + 路灯变亮 + 人物跳舞 + 飞鸟惊起。
     3. 对外暴露 setHour / pulse / destroy 三个接口给 main.js 调用。

   关键约束（改既有系统时容易踩）：
     - 不新增任何键盘监听器。原项目 main.js 的 onKeyDown 已是唯一入口，
       本模块只提供 pulse() 方法由它调用，避免同一按键被处理两次。
     - 覆盖层不接管原项目的 sceneFlag，只用 CSS 层叠 + z-index，
       退出时把 DOM 移除即可完全回滚，不污染原状态机。
     - 所有 canvas 绘制走整数像素 + 整数倍缩放，保持像素栅格不被破坏。
   ============================================================ */
(function (global) {
  'use strict';

  const VW = 480;
  const VH = 270;
  const clamp = PX.clamp;
  const lerp = PX.lerp;

  /* =========================================================
     涟漪池：36 键可能同时触发，需要对象池避免频繁 new
     生命周期：spawn → 扩张 → 淡出 → 回收
     ========================================================= */
  const RIPPLE_POOL_SIZE = 48;

  class PixelStage {
    constructor(hostEl) {
      this.host = hostEl;
      this.canvas = null;
      this.pc = null;
      this.ctx = null;

      this.hour = 7.0;          // 起始为清晨
      this.playing = true;      // 时间是否流动
      this.t = 0;               // 累计动画时间
      this.running = false;
      this.raf = 0;
      this.lastTs = 0;

      // 涟漪池
      this.ripples = [];
      for (let i = 0; i < RIPPLE_POOL_SIZE; i++) {
        this.ripples.push({ active: false, x: 0, y: 0, age: 0, life: 1, hue: 0, size: 1 });
      }
      this.rippleCursor = 0;

      // 互动强度（由 pulse 累积，随时间衰减）
      this.glow = 0;            // 路灯/整体提亮 0..1
      this.dance = 0;           // 人物跳舞 0..1
      this.birdScare = 0;       // 飞鸟惊起 0..1

      // 场景组件
      this.crowd = null;
      this.boats = null;
      this.train = null;
      this.birds = null;

      // 主项目的音画映射参数（由 setPadMap 注入）
      this.padMap = null;
    }

    /* --------------------------------------------------------
       构建 DOM
       -------------------------------------------------------- */
    mount(options) {
      const opt = options || {};
      this.padMap = opt.padMap || null;

      // 覆盖层容器：绝对定位铺满。
      // z-index 必须高于原项目的 #bt_back / #bt_fs（用 var(--z-content)=100），
      // 否则返回到像素首页后，「＜返回」「全屏显示」两个按钮会浮在像素场景之上，
      // 看起来像是没切换成功。此处取 200 覆盖 content 层。
      const wrap = document.createElement('div');
      wrap.id = 'pixelHome';
      wrap.setAttribute('style', [
        'position:fixed', 'top:0', 'left:0', 'width:100%', 'height:100%',
        'z-index:200', 'background:#0d1a24', 'display:block'
      ].join(';'));

      const canvas = document.createElement('canvas');
      canvas.width = VW;
      canvas.height = VH;
      canvas.id = 'pixelHomeCanvas';
      canvas.setAttribute('style', [
        'display:block', 'image-rendering:pixelated',
        'image-rendering:crisp-edges', 'cursor:pointer'
      ].join(';'));

      wrap.appendChild(canvas);
      this.host.appendChild(wrap);
      this.wrap = wrap;
      this.canvas = canvas;
      this.pc = new PX.PixelCanvas(canvas, VW, VH);
      this.ctx = this.pc.c;

      // 场景组件
      this.crowd = new SCENE.Crowd(24);
      this.boats = new SCENE.Boats();
      this.train = new SCENE.Train();
      this.birds = this.makeBirds();

      // 绑定交互：点「开始」区域进入
      canvas.addEventListener('click', (e) => this.onCanvasClick(e));
      // 键盘：像素首页不再拦截回车/空格。
      // 原首页真实按钮是标准 <a>/<button>，原生即可聚焦与回车触发，
      // 若这里再 preventDefault 反而会挡住真实按钮的键盘可达性。
      this._onKey = (e) => { /* 由真实按钮接管键盘交互 */ };
      this._onMove = (e) => { this.lastMouse = this.toLocal(e); };
      window.addEventListener('keydown', this._onKey);
      canvas.addEventListener('mousemove', this._onMove);

      this.resize();
      window.addEventListener('resize', this._onResize = () => this.resize());

      this.alive = true;
      this.running = true;
      this.lastTs = performance.now();
      // 像素首页是流程起点，不该出现「＜返回」「全屏显示」——
      // 它们属于原项目演奏场景。覆盖层存活期间隐藏，destroy 时恢复。
      this._hideHostChrome();
      this.loop();
      return this;
    }

    /** 隐藏原项目的浮层按钮（返回 / 全屏） */
    _hideHostChrome() {
      var ids = ['bt_back', 'bt_fs'];
      for (var i = 0; i < ids.length; i++) {
        var el = document.getElementById(ids[i]);
        if (el) el.style.display = 'none';
      }
    }

    /** 恢复原项目浮层按钮（由 main.js 在进入演奏后调用） */
    static restoreHostChrome() {
      var ids = ['bt_back', 'bt_fs'];
      for (var i = 0; i < ids.length; i++) {
        var el = document.getElementById(ids[i]);
        // 清掉我们加的内联 display，让原项目的 fadeIn 逻辑重新接管
        if (el) el.style.display = '';
      }
    }

    /** 像素放大：整数倍 */
    resize() {
      const w = window.innerWidth, h = window.innerHeight;
      const scale = Math.max(1, Math.floor(Math.min(w / VW, h / VH)));
      this.scale = scale;
      this.canvas.style.width = (VW * scale) + 'px';
      this.canvas.style.height = (VH * scale) + 'px';
      // 居中
      this.canvas.style.position = 'absolute';
      this.canvas.style.left = Math.floor((w - VW * scale) / 2) + 'px';
      this.canvas.style.top = Math.floor((h - VH * scale) / 2) + 'px';
    }

    /** 屏幕坐标 → canvas 逻辑坐标（供场景做悬停效果，不用于点击分发） */
    toLocal(e) {
      const r = this.canvas.getBoundingClientRect();
      return {
        x: (e.clientX - r.left) / this.scale,
        y: (e.clientY - r.top) / this.scale
      };
    }

    /**
     * canvas 不再分发点击。
     * 原首页 4 个真实按钮（#bt_start / #bt_select / #bt_custom / #bt_about）
     * 已由 main.js 抬高 z-index 浮在场景之上，点击自然落到按钮上。
     * 保留空实现以维持既有事件绑定点。
     */
    onCanvasClick(e) { /* 真实按钮接管点击 */ }

    /* --------------------------------------------------------
       进入演奏：淡出覆盖层并交还控制权
       -------------------------------------------------------- */
    enterPlay() {
      if (this.entering) return;
      this.entering = true;
      this.playing = false;

      // 淡出后移除 DOM —— 至此对原项目零残留
      this.wrap.style.transition = 'opacity 420ms linear';
      this.wrap.style.opacity = '0';
      setTimeout(() => {
        this.destroy();
        if (typeof global.__UTATAP_ON_ENTER_PLAY__ === 'function') {
          global.__UTATAP_ON_ENTER_PLAY__();
        }
      }, 430);
    }

    destroy() {
      this.alive = false;
      this.running = false;
      if (this.raf) cancelAnimationFrame(this.raf);
      window.removeEventListener('keydown', this._onKey);
      window.removeEventListener('resize', this._onResize);
      if (this.canvas) {
        this.canvas.removeEventListener('click', this.onCanvasClick);
        this.canvas.removeEventListener('mousemove', this._onMove);
      }
      if (this.wrap && this.wrap.parentNode) this.wrap.parentNode.removeChild(this.wrap);
      this.wrap = null;
      this.canvas = null;
    }

    /* --------------------------------------------------------
       对外接口
       -------------------------------------------------------- */

    /** 设置一天中的时间（0-24） */
    setHour(h) {
      this.hour = ((h % 24) + 24) % 24;
    }

    /**
     * 演奏反馈入口。由原项目 main.js 的 onKeyDown(index) 调用。
     * @param {number} index 0..35 音垫序号
     */
    pulse(index) {
      if (!this.alive) return;
      // 把音垫序号映射为舞台坐标：6 列 × 6 行。
      // 纵向必须落在站台面前景区（PLATFORM_Y=196 ~ BOTTOM=250），
      // 否则涟漪会盖住草地与 SEAGLASS BAY 站牌文字。
      const col = index % 6, row = Math.floor(index / 6);
      const x = 56 + col * 74;
      const y = 204 + row * 8;

      // 取一个涟漪（环形复用）
      const r = this.ripples[this.rippleCursor];
      this.rippleCursor = (this.rippleCursor + 1) % this.ripples.length;
      r.active = true;
      r.x = x; r.y = y;
      r.age = 0;
      r.life = 0.85;
      r.size = 3 + (index % 4);      // 不同键视觉大小略有差异
      r.hue = index % 3;

      // 累积互动强度（上限 1）
      this.glow = Math.min(1, this.glow + 0.34);
      this.dance = Math.min(1, this.dance + 0.28);
      // 飞鸟只在较高音区（index 靠后 = 高音）惊起
      if (index >= 18) this.birdScare = Math.min(1, this.birdScare + 0.5);
    }

    /* --------------------------------------------------------
       飞鸟（惊起反馈用，独立于 SCENE.Birds）
       -------------------------------------------------------- */
    makeBirds() {
      const rng = PX.makeRng(20260928);
      const arr = [];
      for (let i = 0; i < 6; i++) {
        arr.push({
          x: 40 + rng() * 380,
          y: 40 + rng() * 60,
          vx: (rng() < 0.5 ? -1 : 1) * (0.3 + rng() * 0.5),
          ph: rng() * 6.28,
          scared: 0
        });
      }
      return arr;
    }

    /* --------------------------------------------------------
       主循环
       -------------------------------------------------------- */
    loop() {
      if (!this.running) return;
      this.raf = requestAnimationFrame(() => this.loop());
      const now = performance.now();
      let dt = (now - this.lastTs) / 1000;
      this.lastTs = now;
      if (dt > 0.1) dt = 0.1;
      this.t += dt;

      this.update(dt);
      this.render();
    }

    update(dt) {
      const P = PAL.paletteAt(this.hour);

      // 互动强度自然衰减
      const decay = Math.pow(0.12, dt);
      this.glow *= decay;
      this.dance *= decay;
      this.birdScare *= decay;

      // 涟漪推进
      for (let i = 0; i < this.ripples.length; i++) {
        const r = this.ripples[i];
        if (!r.active) continue;
        r.age += dt;
        if (r.age >= r.life) r.active = false;
      }

      // 场景组件
      this.crowd.update(dt, P);
      this.boats.update(dt);
      this.train.update(dt, P);

      // 飞鸟：受惊时向上窜
      for (let i = 0; i < this.birds.length; i++) {
        const b = this.birds[i];
        b.x += b.vx * dt * 60;
        b.ph += dt * 7;
        if (b.x < 8) { b.x = 8; b.vx = Math.abs(b.vx); }
        if (b.x > VW - 8) { b.x = VW - 8; b.vx = -Math.abs(b.vx); }
        if (b.scared > 0) {
          b.scared -= dt;
          b.y -= dt * 26;                 // 受惊上飞
          if (b.y < 16) { b.y = 16; b.scared = 0; }
        } else {
          // 缓慢回归巡航高度
          const cruise = 40 + (i % 3) * 18;
          b.y = lerp(b.y, cruise, 1 - Math.pow(0.2, dt));
        }
      }
    }

    /* --------------------------------------------------------
       渲染
       -------------------------------------------------------- */
    render() {
      const P = PAL.paletteAt(this.hour);
      const lights = [];
      const pc = this.pc;
      const ctx = this.ctx;

      // --- 天空 ---
      const skyH = SPR.HORIZON + 2;
      pc.gradientRect(0, 0, VW, skyH, [
        [0, P.sky[0]], [0.55, P.sky[1]], [1, P.sky[2]]
      ]);
      pc.gradientRect(0, skyH - 10, VW, 10, [[0, P.sky[2]], [1, P.skyLow]]);

      SPR.drawStars(pc, P, this.t);
      SPR.drawSunMoon(pc, P, this.hour);
      SPR.drawClouds(pc, P, this.t);

      // --- 海 ---
      SPR.drawSea(pc, P, this.t, this.hour);
      this.boats.draw(pc, P);

      // --- 岛 + 灯塔 ---
      SPR.drawIsland(pc, P, this.t, this.hour);

      // --- 草地 / 站台 ---
      SPR.drawField(pc, P, this.t);
      SPR.drawPlatform(pc, P);
      SPR.drawWaitingRoom(pc, P, this.t, lights);
      SPR.drawStationSign(pc, P, lights);
      SPR.drawLamp(pc, P, lights);
      SPR.drawBench(pc, P, 122);
      SPR.drawBench(pc, P, 336);
      SPR.drawIceCart(pc, P, 386, lights);

      // --- 人群（叠加跳舞姿态） ---
      this.drawCrowdWithDance(pc, P);

      // --- 列车 ---
      SCENE.drawTrain(pc, this.train, P, lights);

      // --- 前景草 ---
      SPR.drawForeground(pc, P, this.t);

      // --- 涟漪（在最上层，作为演奏反馈）---
      this.drawRipples(pc, P);

      // --- 飞鸟 ---
      this.drawBirds(pc, P);

      // --- 开始按钮 ---
      // 注意：「开始」按钮不在此处绘制。
      // 它必须放在本函数末尾（全部环境色/灯光合成之后），
      // 否则会被夜景 multiply 压暗，导致按钮几乎看不见。

      // --- 环境色（夜景分层压暗）---
      if (P.ambientStrength > 0.01) {
        const s = P.ambientStrength;
        ctx.save();
        ctx.globalCompositeOperation = 'multiply';
        ctx.fillStyle = P.ambient;
        ctx.globalAlpha = s;
        ctx.fillRect(0, 0, VW, SPR.HORIZON + 4);
        const gnd = PX.mix(P.ambient, '#7a86b8', 0.55);
        ctx.fillStyle = gnd;
        ctx.globalAlpha = s * 0.62;
        ctx.fillRect(0, SPR.HORIZON + 4, VW, VH - SPR.HORIZON - 4);
        ctx.restore();
      }

      // --- 灯光（涟漪/跳舞时会额外提亮）---
      if (lights.length) {
        ctx.save();
        ctx.globalCompositeOperation = 'lighter';
        for (let i = 0; i < lights.length; i++) {
          const L = lights[i];
          pc.glow(L.x, L.y, L.r, L.c, L.s);
        }
        ctx.restore();
      }

      // --- 整体微亮（演奏活跃时画面更鲜活）---
      if (this.glow > 0.02) {
        ctx.save();
        ctx.globalCompositeOperation = 'lighter';
        ctx.globalAlpha = this.glow * 0.06;
        ctx.fillStyle = '#fff4d0';
        ctx.fillRect(0, 0, VW, VH);
        ctx.restore();
      }
    }

    /** 人群 + 跳舞姿态（按 dance 强度让小人摆动） */
    drawCrowdWithDance(pc, P) {
      const people = this.crowd.people;
      for (let i = 0; i < people.length; i++) {
        const p = people[i];
        if (!p.onPlatform) SCENE.drawPerson(pc, p, p.frame, P);
      }
      for (let i = 0; i < this.crowd.dogs.length; i++) {
        const d = this.crowd.dogs[i];
        if (d.y < SPR.PLATFORM_Y + 6) SCENE.drawDog(pc, d, d.frame);
      }
      for (let i = 0; i < people.length; i++) {
        const p = people[i];
        if (!p.onPlatform) continue;
        if (this.dance > 0.05) {
          // 跳舞：整个人上下偏移 + 拉伸帧
          const bob = Math.round(Math.sin(this.t * 9 + i) * this.dance * 2);
          const saved = p.y;
          p.y += bob;
          SCENE.drawPerson(pc, p, p.frame, P);
          p.y = saved;
        } else {
          SCENE.drawPerson(pc, p, p.frame, P);
        }
      }
      for (let i = 0; i < this.crowd.dogs.length; i++) {
        const d = this.crowd.dogs[i];
        if (d.y >= SPR.PLATFORM_Y + 6) SCENE.drawDog(pc, d, d.frame);
      }
    }

    /** 涟漪绘制：扩张的像素圆环 + 淡出 */
    drawRipples(pc, P) {
      for (let i = 0; i < this.ripples.length; i++) {
        const r = this.ripples[i];
        if (!r.active) continue;
        const k = r.age / r.life;                 // 0..1
        const rad = 2 + k * (16 + r.size * 3);   // 扩张
        const alpha = (1 - k) * 0.8;
        const c = r.hue === 0 ? '#ffffff' : (r.hue === 1 ? '#bfe8ff' : '#ffe9a8');
        pc.ctx.globalAlpha = alpha;
        pc.ring(r.x, r.y, Math.round(rad), c);
        // 内圈更亮
        pc.ctx.globalAlpha = alpha * 0.5;
        pc.ring(r.x, r.y, Math.max(1, Math.round(rad * 0.6)), c);
        pc.ctx.globalAlpha = 1;
      }
    }

    /** 飞鸟绘制：小 v 字，受惊时张开更大 */
    drawBirds(pc, P) {
      const ink = P.isNight ? '#8a94b8' : '#3a4458';
      for (let i = 0; i < this.birds.length; i++) {
        const b = this.birds[i];
        const flap = Math.sin(b.ph) > 0 ? 1 : -1;
        const spread = 2 + (b.scared > 0 ? 1 : 0);
        pc.px(b.x - spread, b.y - flap, ink);
        pc.px(b.x, b.y, ink);
        pc.px(b.x + spread, b.y - flap, ink);
      }
    }

    /**
     * 绘制中英混排文字。
     * 为什么不用 pc.text()：内置 3x5 像素字体表只有 41 个 ASCII 字符
     * （A-Z 0-9 空格 - . / *），**不含中文**。传「开」「始」进去
     * 查不到字形会被静默跳过，结果只画出「!」和下划线，中文整段消失。
     *
     * 解决：ASCII 仍用 pc.text()（保持像素风方块字），
     * 中文改用 canvas 原生 fillText + 深色描边，
     * 再靠「低分辨率画布 + 整数倍放大」让它同样呈像素颗粒感
     * —— 这是像素风画中文的标准做法。
     */
    _drawMixedText(pc, str, x, y, color, pxSize) {
      const ctx = pc.ctx;
      let cx = x;
      for (let i = 0; i < str.length; i++) {
        const ch = str[i];
        if (/[A-Za-z0-9 !.?\-*/]/.test(ch)) {
          // ASCII → 3x5 像素字体
          pc.text(ch, cx, y, color, pxSize);
          cx += 4 * pxSize;
        } else {
          // 中文 → 原生绘制
          ctx.save();
          ctx.fillStyle = color;
          // 实测：480x270 低分辨率画布上，12px 中文只有 59 个亮像素（几乎不可见），
          // 20px 才有 171 个（清晰）。故基准取 pxSize*10。
          ctx.font = '700 ' + (pxSize * 10) + 'px "Microsoft YaHei", "PingFang SC", sans-serif';
          ctx.textBaseline = 'top';
          // 先描深色边，保证任何背景上都可读
          ctx.strokeStyle = 'rgba(0,0,0,0.8)';
          ctx.lineWidth = Math.max(1, pxSize);
          ctx.strokeText(ch, cx, y - pxSize * 0.5);
          ctx.fillText(ch, cx, y - pxSize * 0.5);
          ctx.restore();
          cx += pxSize * 11;
        }
      }
      return cx - x;
    }

    /** 测量 _drawMixedText 的宽度（步进必须与绘制侧 pxSize*11 严格一致） */
    _measureMixedText(pc, str, pxSize) {
      let w = 0;
      for (let i = 0; i < str.length; i++) {
        const ch = str[i];
        w += /[A-Za-z0-9 !.?\-*/]/.test(ch) ? 4 * pxSize : pxSize * 11;
      }
      return w;
    }

    /**
     * 绘制首页菜单（4 个入口）。
     * 对应原项目 #bt_start / #bt_select / #bt_custom / #bt_about，
     * 视觉上延续原项目「文字链 + 虚线下划线」的极简语言。
     */

  }

  /* =========================================================
     全局单例
     ========================================================= */
  let instance = null;

  /**
   * 启动像素首页。
   * 若已存在实例：
   *   - 仍存活（首次进入演奏前的重复调用）→ 直接复用
   *   - 已销毁（从演奏返回首页）→ 丢弃旧引用并重建，
   *     否则会拿到 alive=false 的死实例，覆盖层无法再显示。
   */
  function bootOnce(hostEl, options) {
    if (instance) {
      if (instance.alive) return instance;
      instance = null;
    }
    instance = new PixelStage(hostEl);
    instance.mount(options);
    return instance;
  }

  global.PixelHome = {
    boot: bootOnce,
    get: function () { return instance; },
    setHour: function (h) { if (instance) instance.setHour(h); },
    pulse: function (i) { if (instance) instance.pulse(i); },
    /** 当前像素首页是否处于活动状态（覆盖层已挂载且未销毁） */
    isActive: function () { return !!(instance && instance.alive); }
  };

  // 导出类，供 main.js 在进入演奏时恢复被隐藏的浮层按钮
  global.PixelStage = PixelStage;
})(window);
