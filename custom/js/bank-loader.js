/*!
 * bank-loader.js —— 决定"当前歌姬"
 *
 * 优先级：URL 参数 ?bank=xxx > localStorage 'vc:lastBank'（首页选择歌姬时写入）> 默认 mikuv4x。
 * 解析结果交给 clips.js 去 ../data/vocal/<bank>.json 拉取片段清单。
 * 歌姬文件名可能是非 ASCII（如 呗音ウタ），fetch 时必须 encodeURIComponent。
 */
(function (global) {
  'use strict';

  /** 审查 C4：歌姬名将进入存储键（bank:index）与 fetch 路径，拒绝会污染键/路径的字符 */
  function sanitize(b) {
    b = String(b || '');
    if (!b || b.length > 64) return null;
    if (/[:/?#%&=\\]/.test(b)) return null;
    return b;
  }

  function resolve() {
    try {
      var m = /[?&]bank=([^&]+)/.exec(global.location.search || '');
      if (m) {
        var fromUrl = sanitize(decodeURIComponent(m[1]));
        if (fromUrl) return fromUrl;
      }
    } catch (e) { /* noop */ }
    try {
      var fromLs = sanitize(global.localStorage.getItem('vc:lastBank'));
      if (fromLs) return fromLs;
    } catch (e) { /* noop */ }
    return 'mikuv4x';
  }

  /** 存储变更哨兵：IndexedDB 不产生 storage 事件，
   *  首页播放桥靠监听 localStorage 的 'vcb:ping' 变化来重同步缓存 */
  function ping() {
    try {
      global.localStorage.setItem('vcb:ping', String(Date.now()));
    } catch (e) { /* noop */ }
  }

  global.VcBank = {
    resolve: resolve,
    ping: ping
  };
})(window);
