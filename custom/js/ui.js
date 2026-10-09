/*!
 * ui.js —— 轻量 UI 工具（toast / 确认框 / 格式化）
 * 不依赖任何框架，保证打包进小程序 web-view 时零外部依赖。
 */
(function (global) {
  'use strict';

  var toastTimer = null;

  function toast(msg, type, ms) {
    var el = document.getElementById('vcToast');
    if (!el) {
      el = document.createElement('div');
      el.id = 'vcToast';
      el.className = 'vc-toast';
      document.body.appendChild(el);
    }
    el.textContent = msg;
    el.className = 'vc-toast vc-toast--' + (type || 'info') + ' is-show';
    if (toastTimer) clearTimeout(toastTimer);
    toastTimer = setTimeout(function () {
      el.className = 'vc-toast vc-toast--' + (type || 'info');
    }, ms || 2200);
  }

  /**
   * 简易确认框（不用 window.confirm：小程序 web-view 里可能被拦截或样式割裂）。
   * 返回 Promise<boolean>
   *
   * 健壮性要点：
   *   1. close() 幂等 —— 双击「确定」不会重复 resolve / 重复 removeChild；
   *   2. 卸载时自动关闭 —— 若调用方所在页面被销毁，避免 Promise 悬挂与 DOM 泄漏；
   *   3. 单例复用 —— 同一时刻只应存在一个模态框，避免叠出多层遮罩互相遮挡；
   *   4. Esc 键可关闭。
   */
  var activeModal = null;

  function confirm(title, message, okText, cancelText) {
    // 已有模态框在显示时，先把旧的关掉（resolve(false)），
    // 防止叠出两层遮罩导致下层永远点不到。
    if (activeModal && activeModal.parentNode) {
      activeModal.__close(false);
    }

    return new Promise(function (resolve) {
      var wrap = document.createElement('div');
      wrap.className = 'vc-modal is-show';
      wrap.setAttribute('role', 'dialog');
      wrap.setAttribute('aria-modal', 'true');
      wrap.innerHTML =
        '<div class="vc-modal__mask"></div>' +
        '<div class="vc-modal__panel">' +
        '<h3 class="vc-modal__title"></h3>' +
        '<p class="vc-modal__msg"></p>' +
        '<div class="vc-modal__actions">' +
        '<button type="button" class="vc-btn vc-btn--ghost" data-act="cancel"></button>' +
        '<button type="button" class="vc-btn vc-btn--danger" data-act="ok"></button>' +
        '</div></div>';
      wrap.querySelector('.vc-modal__title').textContent = title || '确认';
      wrap.querySelector('.vc-modal__msg').textContent = message || '';
      wrap.querySelector('[data-act="cancel"]').textContent = cancelText || '取消';
      wrap.querySelector('[data-act="ok"]').textContent = okText || '确定';
      document.body.appendChild(wrap);
      activeModal = wrap;

      var settled = false;
      function close(result) {
        if (settled) return;          // 幂等：重复点击直接返回
        settled = true;
        document.removeEventListener('keydown', onKey, true);
        if (activeModal === wrap) activeModal = null;
        // 先摘掉 is-show 让遮罩进入淡出，再移除节点；
        // 若 CSS 未定义该过渡，则立即移除也不会残留。
        wrap.classList.remove('is-show');
        if (wrap.parentNode) wrap.parentNode.removeChild(wrap);
        resolve(result);
      }
      // 暴露给「有旧模态时」的开销路径
      wrap.__close = close;

      function onKey(e) {
        if (e.key === 'Escape') {
          e.preventDefault();
          close(false);
        }
      }
      document.addEventListener('keydown', onKey, true);

      wrap.querySelector('[data-act="ok"]').onclick = function () { close(true); };
      wrap.querySelector('[data-act="cancel"]').onclick = function () { close(false); };
      wrap.querySelector('.vc-modal__mask').onclick = function () { close(false); };
    });
  }

  function formatSeconds(ms) {
    if (!ms || ms < 0) return '0.0"';
    return (ms / 1000).toFixed(1) + '"';
  }

  function formatDate(ts) {
    if (!ts) return '';
    var d = new Date(ts);
    function pad(n) { return n < 10 ? '0' + n : String(n); }
    return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()) +
      ' ' + pad(d.getHours()) + ':' + pad(d.getMinutes());
  }

  /** HTML 转义：所有插入 innerHTML 的用户可控内容都必须过这一层 */
  function escapeHtml(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  global.VcUI = {
    toast: toast,
    confirm: confirm,
    formatSeconds: formatSeconds,
    formatDate: formatDate,
    escapeHtml: escapeHtml
  };
})(window);
