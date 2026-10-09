/*!
 * recorder.js —— 麦克风录音
 *
 * 兼容性设计（"浏览器兼容性"硬要求）：
 *  ① 优先 MediaRecorder：按 audio/webm;codecs=opus → webm → ogg → mp4(iOS Safari) 依次协商。
 *  ② 无 MediaRecorder 时回退：AudioContext + ScriptProcessorNode 采集 PCM，自行封装成 WAV。
 *  ③ getUserMedia 做 vendor 前缀归一化（老版 webkit/moz）。
 *  ④ 统一把 DOMException 映射成中文可读错误，交给 UI 提示。
 *  ⑤ 提供音量电平（getLevel）用于录音时的可视化反馈。
 */
(function (global) {
  'use strict';

  var MIME_CANDIDATES = [
    'audio/webm;codecs=opus',
    'audio/webm',
    'audio/ogg;codecs=opus',
    'audio/ogg',
    'audio/mp4',
    'audio/mpeg'
  ];

  function isTypeSupported(m) {
    try {
      return !!(global.MediaRecorder && global.MediaRecorder.isTypeSupported && global.MediaRecorder.isTypeSupported(m));
    } catch (e) {
      return false;
    }
  }

  function pickMime() {
    for (var i = 0; i < MIME_CANDIDATES.length; i++) {
      if (isTypeSupported(MIME_CANDIDATES[i])) return MIME_CANDIDATES[i];
    }
    return '';
  }

  function hasMediaDevices() {
    return !!(global.navigator && global.navigator.mediaDevices && global.navigator.mediaDevices.getUserMedia);
  }

  function legacyGetUserMedia() {
    var nav = global.navigator;
    return nav.getUserMedia || nav.webkitGetUserMedia || nav.mozGetUserMedia || nav.msGetUserMedia || null;
  }

  /** 是否具备录音能力（不等于已授权） */
  function isSupported() {
    var canOpenMic = hasMediaDevices() || !!legacyGetUserMedia();
    var canRecord = !!global.MediaRecorder || !!(global.AudioContext || global.webkitAudioContext);
    return !!(canOpenMic && canRecord);
  }

  /** 是否运行在安全上下文（HTTPS / localhost）——非安全上下文 getUserMedia 会被拒 */
  function isSecure() {
    if (global.isSecureContext === true) return true;
    var h = (global.location && global.location.hostname) || '';
    return h === 'localhost' || h === '127.0.0.1' || h === '[::1]';
  }

  function gum(constraints) {
    return new Promise(function (resolve, reject) {
      var nav = global.navigator;
      if (hasMediaDevices()) {
        nav.mediaDevices.getUserMedia(constraints).then(resolve, reject);
        return;
      }
      var legacy = legacyGetUserMedia();
      if (!legacy) {
        reject(new Error('当前浏览器不支持 getUserMedia'));
        return;
      }
      try {
        legacy.call(nav, constraints, resolve, reject);
      } catch (e) {
        reject(e);
      }
    });
  }

  /** 把 DOMException 映射成用户能看懂的中文提示 */
  function friendlyError(err) {
    var name = (err && err.name) || '';
    var msg = (err && err.message) || '';
    if (name === 'NotAllowedError' || name === 'SecurityError' || name === 'PermissionDeniedError') {
      return '麦克风权限被拒绝，请在浏览器/系统设置中允许后重试';
    }
    if (name === 'NotFoundError' || name === 'DevicesNotFoundError') {
      return '未检测到可用的麦克风设备';
    }
    if (name === 'NotReadableError' || name === 'TrackStartError') {
      return '麦克风被其他程序占用，请关闭后重试';
    }
    if (name === 'OverconstrainedError' || name === 'ConstraintNotSatisfiedError') {
      return '麦克风不满足录音参数要求';
    }
    if (name === 'AbortError') {
      return '录音被中断，请重试';
    }
    if (!isSecure()) {
      return '录音需要在 HTTPS 或 localhost 环境下进行（当前为不安全的 http 环境）';
    }
    return msg || '录音失败，请重试';
  }

  /** 仅申请权限（不录音），用于进入页面时先拿到授权 */
  function requestPermission() {
    if (!isSupported()) {
      return Promise.reject(new Error('当前浏览器不支持录音功能'));
    }
    return gum({ audio: true }).then(function (stream) {
      // 立即释放，避免一直亮着录音指示灯
      if (stream && stream.getTracks) {
        stream.getTracks().forEach(function (t) { t.stop(); });
      }
      return true;
    }).catch(function (err) {
      throw new Error(friendlyError(err));
    });
  }

  /* ---------------- WAV 编码（回退路径用） ---------------- */

  function encodeWav(chunks, sampleRate) {
    var total = 0;
    var i, j;
    for (i = 0; i < chunks.length; i++) total += chunks[i].length;
    var buffer = new ArrayBuffer(44 + total * 2);
    var view = new DataView(buffer);

    function writeStr(off, s) {
      for (var k = 0; k < s.length; k++) view.setUint8(off + k, s.charCodeAt(k));
    }
    writeStr(0, 'RIFF');
    view.setUint32(4, 36 + total * 2, true);
    writeStr(8, 'WAVE');
    writeStr(12, 'fmt ');
    view.setUint32(16, 16, true);
    view.setUint16(20, 1, true);      // PCM
    view.setUint16(22, 1, true);      // mono
    view.setUint32(24, sampleRate, true);
    view.setUint32(28, sampleRate * 2, true); // byteRate
    view.setUint16(32, 2, true);      // blockAlign
    view.setUint16(34, 16, true);     // bitsPerSample
    writeStr(36, 'data');
    view.setUint32(40, total * 2, true);

    var off = 44;
    for (i = 0; i < chunks.length; i++) {
      var c = chunks[i];
      for (j = 0; j < c.length; j++) {
        var s = c[j];
        if (s > 1) s = 1; else if (s < -1) s = -1;
        view.setInt16(off, s < 0 ? s * 0x8000 : s * 0x7fff, true);
        off += 2;
      }
    }
    return new Blob([view], { type: 'audio/wav' });
  }

  /* ---------------- 录音器 ---------------- */

  /**
   * 创建一次录音会话。
   * start() -> Promise<void>
   * stop()  -> Promise<{ blob, mime, durationMs }>
   * cancel() -> 放弃并释放麦克风
   * getLevel() -> 0..1 实时音量
   */
  function create() {
    var stream = null;
    var mediaRecorder = null;
    var chunks = [];
    var startedAt = 0;
    var stopped = false;

    // 回退路径
    var audioCtx = null;
    var sourceNode = null;
    var processor = null;
    var fbChunks = [];
    var fbRate = 44100;
    var usingFallback = false;

    // 电平
    var analyser = null;
    var levelBuf = null;

    function setupLevel(ctx, source) {
      try {
        analyser = ctx.createAnalyser();
        analyser.fftSize = 1024;
        levelBuf = new Float32Array(analyser.fftSize);
        source.connect(analyser);
      } catch (e) {
        analyser = null;
      }
    }

    function start() {
      if (!isSupported()) {
        return Promise.reject(new Error('当前浏览器不支持录音功能'));
      }
      stopped = false;
      chunks = [];
      fbChunks = [];

      return gum({
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true
        }
      }).catch(function () {
        // 带处理参数失败时，退回到最宽松的约束再试一次
        return gum({ audio: true });
      }).then(function (s) {
        stream = s;
        startedAt = Date.now();

        if (global.MediaRecorder) {
          var mime = pickMime();
          try {
            mediaRecorder = mime ? new global.MediaRecorder(s, { mimeType: mime }) : new global.MediaRecorder(s);
          } catch (e) {
            mediaRecorder = new global.MediaRecorder(s);
          }
          mediaRecorder.ondataavailable = function (ev) {
            if (ev && ev.data && ev.data.size > 0) chunks.push(ev.data);
          };
          mediaRecorder.start(100);
          return;
        }

        // ---- 回退：WebAudio PCM 采集 ----
        usingFallback = true;
        var Ctx = global.AudioContext || global.webkitAudioContext;
        audioCtx = new Ctx();
        fbRate = audioCtx.sampleRate || 44100;
        sourceNode = audioCtx.createMediaStreamSource(s);

        processor = audioCtx.createScriptProcessor(4096, 1, 1);
        processor.onaudioprocess = function (ev) {
          if (stopped) return;
          var input = ev.inputBuffer.getChannelData(0);
          fbChunks.push(new Float32Array(input)); // 必须拷贝，buffer 会被复用
        };
        sourceNode.connect(processor);
        // 接一个零增益节点送到扬声器，保证部分浏览器上 onaudioprocess 持续触发
        try {
          var mute = audioCtx.createGain();
          mute.gain.value = 0;
          processor.connect(mute);
          mute.connect(audioCtx.destination);
        } catch (e) { /* 忽略：部分环境不允许连接 destination */ }

        setupLevel(audioCtx, sourceNode);
      }).catch(function (err) {
        cleanup();
        throw new Error(friendlyError(err));
      });
    }

    function release() {
      if (stream && stream.getTracks) {
        stream.getTracks().forEach(function (t) { t.stop(); });
      }
      if (processor) {
        try { processor.onaudioprocess = null; processor.disconnect(); } catch (e) { /* noop */ }
      }
      if (sourceNode) {
        try { sourceNode.disconnect(); } catch (e) { /* noop */ }
      }
      if (audioCtx && audioCtx.close) {
        try { audioCtx.close(); } catch (e) { /* noop */ }
      }
      stream = null; processor = null; sourceNode = null; audioCtx = null; analyser = null;
    }

    function cleanup() {
      stopped = true;
      release();
    }

    function stop() {
      var durationMs = startedAt ? Date.now() - startedAt : 0;

      if (mediaRecorder && !usingFallback) {
        return new Promise(function (resolve, reject) {
          mediaRecorder.onstop = function () {
            var mime = mediaRecorder && mediaRecorder.mimeType ? mediaRecorder.mimeType : (chunks[0] && chunks[0].type) || 'audio/webm';
            var blob = new Blob(chunks, { type: mime });
            cleanup();
            if (!blob.size) {
              reject(new Error('没有录到声音，请检查麦克风后重试'));
              return;
            }
            resolve({ blob: blob, mime: mime, durationMs: durationMs });
          };
          mediaRecorder.onerror = function (e) {
            cleanup();
            reject(new Error('录音过程出错：' + ((e && e.error && e.error.name) || 'unknown')));
          };
          try {
            if (mediaRecorder.state !== 'inactive') mediaRecorder.stop();
            else mediaRecorder.onstop();
          } catch (e) {
            cleanup();
            reject(new Error('停止录音失败'));
          }
        });
      }

      // 回退路径：把 PCM 编码成 WAV
      stopped = true;
      var pcm = fbChunks;
      release();
      if (!pcm.length) {
        return Promise.reject(new Error('没有录到声音，请检查麦克风后重试'));
      }
      var wav = encodeWav(pcm, fbRate);
      return Promise.resolve({ blob: wav, mime: 'audio/wav', durationMs: durationMs });
    }

    function cancel() {
      try {
        if (mediaRecorder && mediaRecorder.state !== 'inactive') mediaRecorder.stop();
      } catch (e) { /* noop */ }
      cleanup();
    }

    function getLevel() {
      if (!analyser || !levelBuf) return 0;
      try {
        analyser.getFloatTimeDomainData(levelBuf);
        var sum = 0;
        for (var i = 0; i < levelBuf.length; i++) sum += levelBuf[i] * levelBuf[i];
        var rms = Math.sqrt(sum / levelBuf.length);
        return Math.min(1, rms * 3.2);
      } catch (e) {
        return 0;
      }
    }

    return {
      start: start,
      stop: stop,
      cancel: cancel,
      getLevel: getLevel,
      isFallback: function () { return usingFallback; }
    };
  }

  global.VoiceRecorder = {
    isSupported: isSupported,
    isSecure: isSecure,
    requestPermission: requestPermission,
    create: create,
    pickMime: pickMime,
    friendlyError: friendlyError,
    encodeWav: encodeWav // 暴露给测试
  };
})(window);
