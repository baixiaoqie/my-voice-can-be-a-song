/* ============================================================
   waveform.js — 录音波形缩略图（结合点4：自定义面板上的音频可视化记录）

   职责：为已录制的片段生成波形缩略图 + 时长，形成可视化的录制档案。

   设计约束（不改既有 storage 契约）：
     - 波形数据是「派生数据」，由 blob 解码现算，**不写入存储**。
       这样 storage.js 的 list() 返回结构、墓碑语义、降级链全部零改动。
     - 波形结果放在内存 Map（id -> peaks），刷新页面后重算。
       32 条 × 采样点很少，内存占用可忽略。
     - 解码失败（不支持的编码 / blob 已失效）时静默降级为「无波形」，
       不能让整个列表渲染失败。

   复用：与原项目视觉令牌一致（#8cc 体系、零圆角、白色描边）。
   ============================================================ */
(function (global) {
  'use strict';

  // 全局波形缓存：id -> { peaks: [0..1], durationMs: number, w: number }
  var cache = {};
  // 正在解码中的 id，避免同一片段并发解码
  var inflight = {};

  var PEAK_BUCKETS = 48;   // 缩略图横向采样点数

  /**
   * 解码 blob 为 AudioBuffer。
   * 一次性创建 AudioContext 并复用，避免每条录音都新建（浏览器有数量上限）。
   */
  var _actx = null;
  function getCtx() {
    if (!_actx) {
      var C = global.AudioContext || global.webkitAudioContext;
      if (!C) return null;
      _actx = new C();
    }
    // 部分浏览器在用户手势前会挂起 suspended，需 resume
    if (_actx.state === 'suspended' && _actx.resume) _actx.resume();
    return _actx;
  }

  /**
   * 从 blob 提取波形峰值。
   * @param {Blob} blob
   * @param {number} id 用于缓存键
   * @returns {Promise<{peaks:number[], durationMs:number}>}
   */
  function extract(blob, id) {
    if (cache[id]) return Promise.resolve(cache[id]);
    if (inflight[id]) return inflight[id];

    var actx = getCtx();
    if (!actx || !blob) return Promise.resolve(null);

    var p = new Promise(function (resolve) {
      // FileReader 读为 ArrayBuffer
      var fr = new FileReader();
      fr.onload = function () {
        // decodeAudioData 有两种签名（回调 / Promise），统一处理
        var decodeTarget = actx.decodeAudioData(fr.result, resolve, function () {
          resolve(null);   // 解码失败：静默降级
        });
        if (decodeTarget && decodeTarget.then) {
          decodeTarget.then(resolve, function () { resolve(null); });
        }
      };
      fr.onerror = function () { resolve(null); };
      fr.readAsArrayBuffer(blob);
    });

    inflight[id] = p.then(function (buf) {
      delete inflight[id];
      if (!buf || !buf.length) return null;
      var peaks = computePeaks(buf, PEAK_BUCKETS);
      var rec = { peaks: peaks, durationMs: Math.round(buf.duration * 1000) };
      cache[id] = rec;
      return rec;
    });
    return inflight[id];
  }

  /**
   * 把 AudioBuffer 降采样成 N 个峰值（取每段 RMS，比取绝对峰值更贴近听感）。
   */
  function computePeaks(buf, buckets) {
    var ch = buf.numberOfChannels;
    var len = buf.length;
    var data = buf.getChannelData(0);
    var step = Math.max(1, Math.floor(len / buckets));
    var peaks = [];
    for (var b = 0; b < buckets; b++) {
      var start = b * step;
      var end = Math.min(len, start + step);
      var sum = 0, n = 0;
      for (var i = start; i < end; i++) {
        var v = data[i];
        sum += v * v;
        n++;
      }
      var rms = n ? Math.sqrt(sum / n) : 0;
      peaks.push(rms);
    }
    // 多声道混合（简单相加再归一），让立体声/单声道视觉一致
    if (ch > 1) {
      for (var c = 1; c < ch; c++) {
        var d2 = buf.getChannelData(c);
        for (var k = 0; k < peaks.length; k++) {
          var s2 = start + k * step, e2 = Math.min(len, s2 + step);
          var sum2 = 0, n2 = 0;
          for (var j = s2; j < e2; j++) { sum2 += d2[j] * d2[j]; n2++; }
          peaks[k] = Math.max(peaks[k], n2 ? Math.sqrt(sum2 / n2) : 0);
        }
      }
    }
    // 归一到 0..1（用最大值，避免个别爆音压扁整体）
    var max = 0;
    for (var m = 0; m < peaks.length; m++) if (peaks[m] > max) max = peaks[m];
    if (max > 0) {
      for (var q = 0; q < peaks.length; q++) peaks[q] = peaks[q] / max;
    }
    return peaks;
  }

  /**
   * 把波形画到 canvas（由调用方插入卡片 DOM）。
   * @param {HTMLCanvasElement} canvas
   * @param {number[]} peaks
   * @param {string} ink 前景色
   * @param {string} dim 已录制的暗色底
   */
  function draw(canvas, peaks, ink, dim) {
    var dpr = global.devicePixelRatio || 1;
    var cssW = canvas.clientWidth || 120;
    var cssH = canvas.clientHeight || 22;
    canvas.width = Math.round(cssW * dpr);
    canvas.height = Math.round(cssH * dpr);
    var g = canvas.getContext('2d');
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    g.clearRect(0, 0, cssW, cssH);

    if (!peaks || !peaks.length) return;

    var n = peaks.length;
    var barW = cssW / n;
    var mid = cssH / 2;
    for (var i = 0; i < n; i++) {
      // 用平方让弱音也可见（视觉上更接近"有声音"）
      var v = Math.sqrt(peaks[i]);
      var h = Math.max(1, v * (cssH - 2));
      g.fillStyle = ink;
      // 偶数抽样以省一半绘制量，48 根缩到 24 根，视觉几乎无损
      if (i % 2 === 0) {
        g.fillRect(Math.floor(i * barW), Math.floor(mid - h / 2), Math.max(1, Math.floor(barW)), Math.ceil(h));
      }
    }
  }

  /** 取得某片段的波形（可能为 null 表示尚未解码） */
  function get(id) { return cache[id] || null; }

  /** 清除某片段缓存（删除自定义音频时调用） */
  function drop(id) { delete cache[id]; }

  /** 格式化为 0.0" 显示 */
  function fmtDuration(ms) {
    return (ms / 1000).toFixed(1) + '"';
  }

  global.VcWave = {
    extract: extract,
    draw: draw,
    get: get,
    drop: drop,
    fmtDuration: fmtDuration,
    PEAK_BUCKETS: PEAK_BUCKETS
  };
})(window);
