/* ============================================================
   train-cards.js — 列车卡片队列（结合点5）

   交互定义（按用户描述实现）：
     录完一个片段 → 该卡片向左滑出屏幕 → 后面一个卡片补位上来。
   也就是说：一列「车厢」排队停在站台上，录完的那节驶离站台。

   实现方式：CSS transform 动画 + 一次性重排。
     - 不用 display:none（会打断网格布局，导致整体重排抖动）
     - 不用删除 DOM（会丢失已渲染的波形 canvas）
     - 而是把整列卡片做一次 translateX 位移，动画结束后再真正重排
   这样既有滑出动效，又保留波形与状态。

   与既有流转逻辑的关系：
     - 顺序录制（state.flow）仍然照旧工作，列车卡片只是渲染层的表现
     - 非顺序录制时也可以逐个录，同样有驶离动效
   ============================================================ */
(function (global) {
  'use strict';

  var SLIDE_MS = 420;     // 滑出时长
  var isSliding = false;  // 防止动画期间重复触发

  /**
   * 把某张卡片「驶离站台」。
   * @param {string} id 片段 id
   * @param {Function} done 动画结束后回调（此时 DOM 已完成重排）
   */
  function depart(id, done) {
    if (isSliding) { if (done) done(); return; }

    var list = document.getElementById('clipList');
    if (!list) { if (done) done(); return; }

    var li = list.querySelector('.clip-item[data-id="' + cssEscape(id) + '"]');
    if (!li) { if (done) done(); return; }

    isSliding = true;

    // 该卡片向左驶出（略微上抬 + 淡出，模拟驶离而非被删）
    li.style.transition = 'transform ' + SLIDE_MS + ' cubic-bezier(.4,0,.6,1), opacity ' + SLIDE_MS + ' linear';
    li.style.transform = 'translateX(-130%)';
    li.style.opacity = '0';

    setTimeout(function () {
      // 动画结束：清掉行内样式，让它回到正常网格位置
      // 注意：此时不删除节点——卡片仍代表该片段（已录制状态），
      // 只是「驶离」了当前队列视口。若用户希望它彻底离场，
      // 后续可在此处把已录制卡片折叠为「已完成」分组。
      li.style.transition = '';
      li.style.transform = '';
      li.style.opacity = '';
      isSliding = false;
      if (done) done();
    }, SLIDE_MS + 30);
  }

  /**
   * 让某个卡片「进站高亮」，即当前待处理的那一节。
   * @param {string} id
   */
  function arrive(id) {
    var list = document.getElementById('clipList');
    if (!list || !id) return;
    var li = list.querySelector('.clip-item[data-id="' + cssEscape(id) + '"]');
    if (!li) return;
    // 新卡片从右侧轻微滑入，暗示「下一节到站」
    li.style.transition = 'transform 320ms ease-out, opacity 320ms linear';
    li.style.transform = 'translateX(24px)';
    li.style.opacity = '0.4';
    // 强制回流后再复位，确保动画能播放
    /* eslint-disable no-unused-expressions */
    void li.offsetWidth;
    li.style.transform = '';
    li.style.opacity = '';
    setTimeout(function () {
      li.style.transition = '';
    }, 340);
  }

  /** CSS 选择器转义（片段 id 含 `:` 必须处理） */
  function cssEscape(v) {
    if (global.CSS && global.CSS.escape) return global.CSS.escape(v);
    return String(v).replace(/["\\]/g, '\\$&');
  }

  /**
   * 数字滚动补位动画：显示「下一节是第几号」。
   * 让用户明确感知到「队列在前进」。
   */
  function announce(index, total) {
    var el = document.getElementById('flowQueue');
    if (!el) return;
    el.textContent = '第 ' + (index + 1) + ' / ' + total + ' 节';
    el.style.opacity = '1';
    setTimeout(function () { el.style.opacity = '0'; }, 1200);
  }

  global.VcTrainCards = {
    depart: depart,
    arrive: arrive,
    announce: announce,
    isSliding: function () { return isSliding; }
  };
})(window);
