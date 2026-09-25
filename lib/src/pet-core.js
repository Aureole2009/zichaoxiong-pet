/**
 * 自嘲熊桌宠组件：纯 DOM + CSS，不依赖任何框架，也不知道 DSH 的存在。
 *
 * 用法：
 *   const pet = mountPet({ frames: [...7 个图片 URL...] });
 *   pet.setState("busy");           // idle | busy | waiting | done | error
 *   pet.say("人，熊在。");           // 或 pet.sayKind("idle")
 *   pet.destroy();
 *
 * 交互：拖动=搬家（位置记住）、单击=戳一下、右键=小菜单。
 */

import { PET_CSS, PET_STYLE_ID } from "./pet-css.js";
import { pickLine, timeAwareIdle } from "./pet-lines.js";

/** 七帧的停留时长（毫秒），沿用源 GIF 的节奏。 */
export const FRAME_DURATIONS = [760, 130, 130, 130, 130, 130, 1150];

const SHADOW_H = 15;
const SCALE_BASE = 168; // 尺寸基准：--zx-scale = size / 168，气泡等按此等比缩放
const EDGE = 8;
/** 右键菜单里「大一点/小一点」行走的档位。 */
const SIZE_STEPS = [96, 120, 144, 168, 192, 216, 240, 288];

/** 把任意尺寸吸附到最近档位并夹在范围内。 */
function snapSize(value) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return 168;
  return SIZE_STEPS.reduce(
    (best, step) => (Math.abs(step - numeric) < Math.abs(best - numeric) ? step : best),
    SIZE_STEPS[0],
  );
}

function ensureStyle(doc) {
  if (doc.getElementById(PET_STYLE_ID)) return;
  const style = doc.createElement("style");
  style.id = PET_STYLE_ID;
  style.textContent = PET_CSS;
  doc.head.append(style);
}

/**
 * 活着的桌宠数量（模块级）。样式表是共享的，用计数决定什么时候能删 ——
 * 早先靠"文档里还有没有 .zx-pet-layer"来判断，那依赖 DOM 插入时机，
 * 在"先跑 effect 后插文档"的宿主里会把样式误删。
 */
let livePets = 0;

function loadState(storageKey) {
  try {
    return JSON.parse(localStorage.getItem(storageKey) ?? "{}") ?? {};
  } catch {
    return {};
  }
}

function saveState(storageKey, state) {
  try {
    localStorage.setItem(storageKey, JSON.stringify(state));
  } catch {
    /* 隐私模式等场景下静默失败 */
  }
}

export function mountPet(options = {}) {
  const {
    frames,
    dockFace = frames?.[0],
    storageKey = "dsh-pet:zichaoxiong",
    size: initialSize = 168,
    /** 点击后播多久动画（毫秒）；播完回到静止帧。0 表示永不自动动。 */
    pokeAnimationMs = 5600,
    /** 完成一轮时是否自动撒星星（默认关：按「只有点击时才可以动」）。 */
    celebrate = false,
    margin = 26,
    idleMinMs = 55000,
    idleMaxMs = 125000,
    awayAfterMs = 8 * 60 * 1000,
    zIndex,
    container,
    doc = typeof document === "undefined" ? undefined : document,
  } = options;

  const api = {
    mounted: false,
    setState() {},
    say() {},
    sayKind() {},
    poke() {},
    show() {},
    hide() {},
    destroy() {},
    element: null,
  };

  if (!doc || !Array.isArray(frames) || frames.length === 0) return api;

  const start = () => {
    if (api.mounted) return;
    api.mounted = true;

    ensureStyle(doc);
    livePets += 1;
    const saved = loadState(storageKey);
    let size = snapSize(saved.size ?? initialSize);
    /** 尺寸比例：气泡/尾巴/字全部按它等比缩放。 */
    const scale = () => size / SCALE_BASE;
    /** 熊脚下的落影高度（也跟着缩放，布局一致）。 */
    const shadowH = () => Math.max(8, Math.round(SHADOW_H * scale()));
    /** 一次把所有尺寸变量写到元素上，CSS 全靠它们。 */
    const applySizeVars = () => {
      pet.style.setProperty("--zx-size", `${size}px`);
      pet.style.setProperty("--zx-scale", String(scale()));
      pet.style.setProperty("--zx-shadow-h", `${shadowH()}px`);
    };
    const reduceMotion =
      typeof matchMedia === "function" && matchMedia("(prefers-reduced-motion: reduce)").matches;

    // ------------------------------- DOM -------------------------------
    const layer = doc.createElement("div");
    layer.className = "zx-pet-layer";
    // Inside the DSH shell.overlay seat the layer is absolutely positioned in the
    // frame-wide layer; standalone it floats over the whole viewport.
    layer.style.position = container ? "absolute" : "fixed";
    if (zIndex !== undefined) layer.style.zIndex = String(zIndex);

    const pet = doc.createElement("div");
    pet.className = "zx-pet zx-idle";
    pet.setAttribute("role", "img");
    pet.setAttribute("aria-label", "自嘲熊桌宠");
    applySizeVars();

    const ground = doc.createElement("div");
    ground.className = "zx-ground";

    const bubble = doc.createElement("div");
    bubble.className = "zx-bubble";
    bubble.setAttribute("role", "status");

    const bob = doc.createElement("div");
    bob.className = "zx-bob";
    const sprite = doc.createElement("div");
    sprite.className = "zx-sprite";
    const imgs = frames.map((src, i) => {
      const img = doc.createElement("img");
      img.src = src;
      img.alt = "";
      img.draggable = false;
      if (i === 0) img.classList.add("zx-on");
      sprite.append(img);
      return img;
    });
    bob.append(sprite);

    const menu = doc.createElement("div");
    menu.className = "zx-menu";
    /** keepOpen：改大小的按钮点完不收起菜单，方便连点几下。 */
    const menuBtn = (label, onClick, keepOpen = false) => {
      const b = doc.createElement("button");
      b.type = "button";
      b.textContent = label;
      b.addEventListener("click", (event) => {
        event.stopPropagation();
        if (!keepOpen) hideMenu();
        onClick();
      });
      return b;
    };
    menu.append(
      menuBtn("大一点", () => stepSize(1), true),
      menuBtn("小一点", () => stepSize(-1), true),
      menuBtn("回到右下角", () => moveTo("br", true)),
      menuBtn("藏起来", () => api.hide()),
    );

    pet.append(ground, bubble, bob, menu);
    layer.append(pet);

    const dock = doc.createElement("button");
    dock.type = "button";
    dock.className = "zx-dock";
    dock.title = "把自嘲熊叫回来";
    dock.setAttribute("aria-label", "把自嘲熊叫回来");
    if (dockFace) {
      const face = doc.createElement("img");
      face.src = dockFace;
      face.alt = "";
      dock.append(face);
    }
    dock.addEventListener("click", () => api.show());
    layer.append(dock);

    (container ?? doc.body).append(layer);
    api.element = pet;

    // ------------------------------ 位置 ------------------------------
    // anchored = 「待在默认角落」：布局还没定型时（DSH 的框架是异步撑开的）先跟着角落走，
    // 用户一旦拖动就改成固定坐标并记住。
    //
    // localStorage 是不可信输入：里面可能是 "x"、null、NaN。任何非有限数都当成「没有坐标」，
    // 否则 Math.max("x", 8) 会算出 NaN，而 CSSOM 会静默丢掉 "NaNpx"，熊就被钉在左上角。
    const finite = (value) => (Number.isFinite(value) ? value : undefined);
    let anchored = saved.anchored === true || finite(saved.left) === undefined || finite(saved.top) === undefined;
    let pos = { left: finite(saved.left), top: finite(saved.top) };

    /** 可用区域：槽位容器内的实际盒模型，退化为视口。 */
    const bounds = () => {
      const rect = layer.getBoundingClientRect();
      return {
        w: Math.round(rect.width) || doc.documentElement.clientWidth,
        h: Math.round(rect.height) || doc.documentElement.clientHeight,
      };
    };

    const corner = () => {
      const { w, h } = bounds();
      return { left: w - size - margin, top: h - size - shadowH() - margin };
    };

    const clamp = () => {
      const { w, h } = bounds();
      if (!Number.isFinite(pos.left) || !Number.isFinite(pos.top)) {
        // 坐标坏了就回到默认角落，并重新变成「跟着角落」模式
        pos = corner();
        anchored = true;
      }
      const maxLeft = Math.max(EDGE, w - size - EDGE);
      const maxTop = Math.max(EDGE, h - (size + shadowH()) - EDGE);
      pos.left = Math.min(Math.max(pos.left, EDGE), maxLeft);
      pos.top = Math.min(Math.max(pos.top, EDGE), maxTop);
    };

    const apply = () => {
      clamp();
      const { w, h } = bounds();
      pet.style.left = `${Math.round(pos.left)}px`;
      pet.style.top = `${Math.round(pos.top)}px`;
      if (dock.classList.contains("zx-show")) {
        dock.style.left = `${Math.round(Math.min(pos.left, w - 48))}px`;
        dock.style.top = `${Math.round(Math.min(pos.top, h - 48))}px`;
      }
      placeBubble();
    };

    const moveTo = (which, announce) => {
      const { w, h } = bounds();
      pos = which === "bl"
        ? { left: margin, top: h - size - shadowH() - margin }
        : { left: w - size - margin, top: h - size - shadowH() - margin };
      anchored = which !== "free";
      apply();
      save();
      placeMenu();
      if (announce) sayKind("drop");
    };

    const save = () => {
      const usable = !anchored && Number.isFinite(pos.left) && Number.isFinite(pos.top);
      state.anchored = !usable;
      if (usable) {
        state.left = Math.round(pos.left);
        state.top = Math.round(pos.top);
      } else {
        // 待角落（或坐标不可用）时不写坐标，免得下次窗口尺寸不同就卡在半路
        delete state.left;
        delete state.top;
      }
      saveState(storageKey, state);
    };

    const state = { ...saved };

    // ------------------- 帧动画：默认完全静止，按需播放 -------------------
    const REST_FRAME = 0; // 静止时定格的那一帧
    let frame = REST_FRAME;
    let frameTimer = null;
    let animTimer = null;

    const showFrame = (index) => {
      imgs[frame].classList.remove("zx-on");
      frame = index;
      imgs[frame].classList.add("zx-on");
    };

    const step = () => {
      showFrame((frame + 1) % imgs.length);
      frameTimer = setTimeout(step, FRAME_DURATIONS[frame] * (reduceMotion ? 1.8 : 1));
    };

    const stopAnimation = () => {
      clearTimeout(frameTimer);
      clearTimeout(animTimer);
      frameTimer = null;
      animTimer = null;
      pet.classList.remove("zx-animating");
      showFrame(REST_FRAME);
    };

    /**
     * 播放摆动动画，durationMs 之后自动停回静止帧；重复调用即续期。
     * 这是「动」的唯一入口 —— 只有点击/拖动会走到这里。
     */
    const animateFor = (durationMs) => {
      if (reduceMotion || !durationMs) return;
      pet.classList.add("zx-animating");
      if (frameTimer === null) step();
      clearTimeout(animTimer);
      animTimer = setTimeout(stopAnimation, durationMs);
    };

    // ---------------------------- 台词气泡 ----------------------------
    let bubbleTimer = null;
    let lastBubbleAt = 0;

    /**
     * 把气泡摆到「贴着熊头、但整只留在框内」的位置。
     *
     * 注意坐标系：气泡的 left 是相对 .zx-pet 的，而 pos.left 是相对整层的，
     * 两者不能混用 —— 混了会把气泡一路推到熊盒子的边缘（这里踩过坑）。
     * 必须先设文本再调用，因为要量气泡宽度。
     */
    const placeBubble = () => {
      const width = bubble.offsetWidth;
      const height = bubble.offsetHeight;
      if (!width) return;
      const { w } = bounds();
      const center = size / 2; // 熊头中心（相对 pet 盒子）
      const minLeft = EDGE - pos.left;
      const maxLeft = Math.max(minLeft, w - width - EDGE - pos.left);
      const left = Math.min(Math.max(center - width / 2, minLeft), maxLeft);
      bubble.style.setProperty("--zx-bubble-left", `${Math.round(left)}px`);
      // 尾巴的活动范围也跟着缩放（16px 是基准尺寸下的最小边距）
      const tailMargin = Math.max(10, Math.round(16 * scale()));
      const tail = Math.min(
        Math.max(center - left, tailMargin),
        Math.max(tailMargin, width - tailMargin),
      );
      bubble.style.setProperty("--zx-tail-left", `${Math.round(tail)}px`);
      // 头顶放不下就翻到熊下面去，免得气泡压住熊或者被画面切掉
      const tailDepth = 11 * scale();
      const roomAbove = pos.top - EDGE;
      bubble.classList.toggle("zx-below", roomAbove < height + tailDepth);
    };

    const say = (text, opts = {}) => {
      if (!text) return;
      bubble.textContent = text;
      placeBubble();
      bubble.classList.add("zx-show");
      lastBubbleAt = Date.now();
      clearTimeout(bubbleTimer);
      const hold = opts.duration ?? Math.min(7200, Math.max(2400, 900 + text.length * 150));
      bubbleTimer = setTimeout(() => bubble.classList.remove("zx-show"), hold);
    };

    // ------------------------------ 大小 ------------------------------
    const setSize = (next) => {
      const snapped = snapSize(next);
      if (snapped === size) return;
      size = snapped;
      state.size = size;
      saveState(storageKey, state);
      applySizeVars();
      apply(); // 重新贴边 + 重排气泡（气泡字号等由 --zx-scale 自动跟随）
      placeMenu(); // 菜单开着的话，跟着新尺寸重新贴位
    };

    /** 档位上下走一格。 */
    const stepSize = (direction) => {
      const index = SIZE_STEPS.indexOf(size);
      const next = SIZE_STEPS[Math.min(SIZE_STEPS.length - 1, Math.max(0, (index < 0 ? 3 : index) + direction))];
      if (next === size) {
        say(direction > 0 ? "熊，已经很大了。" : "熊，已经很小了。", { duration: 2200 });
        return;
      }
      setSize(next);
      say(direction > 0 ? "熊，变大了。" : "熊，变小了。", { duration: 1800 });
    };

    function sayKind(kind) {
      const key = kind ?? timeAwareIdle();
      say(pickLine(key, state.lastLine));
      state.lastLine = bubble.textContent;
      saveState(storageKey, state);
    }

    const sayDots = () => {
      bubble.innerHTML = '熊，在想<span class="zx-dots"><span></span><span></span><span></span></span>';
      placeBubble();
      bubble.classList.add("zx-show");
      lastBubbleAt = Date.now();
      clearTimeout(bubbleTimer);
      bubbleTimer = setTimeout(() => bubble.classList.remove("zx-show"), 4200);
    };

    // ---------------------------- 星星特效 ----------------------------
    const GLYPHS = ["✨", "⭐", "💫", "🌟"];
    const MAX_SPARKS = 12; // 隐藏状态下 animationend 不会触发，所以既要限流也要定时兜底
    const clearSparks = () => pet.querySelectorAll(".zx-spark").forEach((node) => node.remove());
    const burst = (count = 3) => {
      if (reduceMotion) return;
      for (let i = 0; i < count; i += 1) {
        const sparks = pet.querySelectorAll(".zx-spark");
        for (let extra = sparks.length; extra >= MAX_SPARKS; extra -= 1) sparks[0].remove();
        const spark = doc.createElement("span");
        spark.className = "zx-spark";
        spark.textContent = GLYPHS[Math.floor(Math.random() * GLYPHS.length)];
        spark.style.setProperty("--dx", `${Math.round((Math.random() - 0.35) * 110)}px`);
        spark.style.setProperty("--dy", `${Math.round(-40 - Math.random() * 60)}px`);
        spark.style.setProperty("--rot", `${Math.round((Math.random() - 0.5) * 180)}deg`);
        spark.style.animationDelay = `${i * 70}ms`;
        pet.append(spark);
        spark.addEventListener("animationend", () => spark.remove(), { once: true });
        setTimeout(() => spark.remove(), 1500); // display:none 时事件不会来
        spark.classList.add("zx-pop");
      }
    };

    // ------------------------------ 状态 ------------------------------
    const STATES = ["idle", "busy", "waiting", "done", "error"];
    let current = "idle";

    const setState = (next) => {
      if (!STATES.includes(next) || next === current) return;
      const previous = current;
      current = next;
      pet.classList.remove(...STATES.map((s) => `zx-${s}`));
      pet.classList.add(`zx-${next}`);

      // 状态只换台词，不动身体（只有点击/拖动才动）。
      if (next === "done" && previous !== "done") {
        if (celebrate) burst(4);
        sayKind("done");
      } else if (next === "error") {
        sayKind("error");
      } else if (next === "waiting") {
        sayKind("waiting");
      } else if (next === "busy" && previous === "idle") {
        sayKind("busy");
      }
    };

    // ---------------------------- 拖拽 / 点击 ----------------------------
    let dragging = false;
    let moved = false;
    let grab = { x: 0, y: 0 };
    let lifted = false;

    const onPointerDown = (event) => {
      if (event.button !== 0) return;
      // 拖着的时候再来一次 pointerdown（第二根手指/第二个键）不该让熊瞬移
      if (dragging) return;
      // 点在右键菜单上时绝不能开始拖拽：否则 setPointerCapture 会把指针抢走，
      // 浏览器随之把 click 重定向到熊身上，菜单按钮就"失灵"了。
      if (menu.contains(event.target)) return;
      dragging = true;
      moved = false;
      lifted = false;
      grab = { x: event.clientX - pos.left, y: event.clientY - pos.top };
      pet.classList.add("zx-dragging");
      try {
        pet.setPointerCapture?.(event.pointerId);
      } catch {
        /* 合成事件或指针已失效：忽略，不影响拖拽 */
      }
      animateFor(120000); // 被拿起时开始动，松手后由 onPointerUp 收尾
    };

    const onPointerMove = (event) => {
      if (!dragging) return;
      const dx = event.clientX - (pos.left + grab.x);
      const dy = event.clientY - (pos.top + grab.y);
      if (!moved && Math.hypot(dx, dy) > 4) {
        moved = true;
        if (!lifted) {
          lifted = true;
          sayKind("lift");
        }
      }
      if (!moved) return;
      anchored = false;
      pos = { left: event.clientX - grab.x, top: event.clientY - grab.y };
      apply();
      hideMenu();
    };

    const onPointerUp = () => {
      if (!dragging) return;
      dragging = false;
      pet.classList.remove("zx-dragging");
      if (moved) {
        save();
        sayKind("drop");
        animateFor(900); // 落地后再摆一下
      } else {
        api.poke(); // 单击=戳一下，poke 自己会播一段动画
      }
    };

    /** 指针被系统抢走（切窗口、触控笔离开等）时也要结束拖拽，别卡在"拖着"的状态。 */
    const onLostCapture = () => {
      if (!dragging) return;
      dragging = false;
      pet.classList.remove("zx-dragging");
      animateFor(400);
    };

    const onContextMenu = (event) => {
      event.preventDefault();
      const show = !menu.classList.contains("zx-show");
      menu.classList.toggle("zx-show", show);
      placeMenu();
    };

    /** 在熊之外右键、或按 Esc，都应该收起我们的菜单（并且不要挡掉浏览器原生菜单）。 */
    const onDocumentContextMenu = (event) => {
      if (!pet.contains(event.target)) hideMenu();
    };
    const onKeyDown = (event) => {
      if (event.key === "Escape") hideMenu();
    };

    /** 把菜单摆到熊旁边并夹在画面内（菜单在 .zx-pet 里，坐标要减掉 pos）。 */
    const placeMenu = () => {
      if (!menu.classList.contains("zx-show")) return;
      const { w, h } = bounds();
      const rect = menu.getBoundingClientRect(); // 先显示再量，否则量到 0
      const layerLeft = Math.min(pos.left, Math.max(EDGE, w - rect.width - EDGE));
      const aboveTop = pos.top - rect.height - 10;
      const layerTop = aboveTop < EDGE ? pos.top + size + shadowH() + 6 : aboveTop;
      const clampedTop = Math.max(EDGE, Math.min(layerTop, h - rect.height - EDGE));
      menu.style.left = `${Math.round(layerLeft - pos.left)}px`;
      menu.style.top = `${Math.round(clampedTop - pos.top)}px`;
    };

    const hideMenu = () => menu.classList.remove("zx-show");

    // ------------------------------ 计时器 ------------------------------
    let idleTimer = null;
    let busyTimer = null;
    let awayTimer = null;
    let lastActivity = Date.now();
    let awaySaid = false;

    const scheduleIdle = () => {
      clearTimeout(idleTimer);
      const wait = idleMinMs + Math.random() * Math.max(0, idleMaxMs - idleMinMs);
      idleTimer = setTimeout(() => {
        const quiet = Date.now() - lastBubbleAt > 14000;
        const canTalk =
          doc.visibilityState === "visible" &&
          !dragging &&
          quiet &&
          !dock.classList.contains("zx-show") &&
          current !== "busy";
        if (canTalk) sayKind(timeAwareIdle());
        scheduleIdle();
      }, wait);
    };

    const scheduleBusy = () => {
      clearTimeout(busyTimer);
      busyTimer = setTimeout(() => {
        if (current === "busy" && doc.visibilityState === "visible" && Date.now() - lastBubbleAt > 12000) {
          if (Math.random() < 0.45) sayDots();
          else sayKind("tool");
        }
        scheduleBusy();
      }, 16000 + Math.random() * 10000);
    };

    const onActivity = () => {
      lastActivity = Date.now();
      awaySaid = false;
    };

    const checkAway = () => {
      if (awaySaid || dragging) return;
      if (Date.now() - lastActivity > awayAfterMs) {
        awaySaid = true;
        if (doc.visibilityState === "visible") sayKind("away");
      }
    };

    const onResize = () => {
      if (anchored) pos = corner();   // 还待角落：跟着窗口一起走
      apply();
    };
    const onDocClick = (event) => {
      if (!pet.contains(event.target)) hideMenu();
    };

    pet.addEventListener("pointerdown", onPointerDown);
    pet.addEventListener("pointermove", onPointerMove);
    pet.addEventListener("pointerup", onPointerUp);
    pet.addEventListener("pointercancel", onPointerUp);
    pet.addEventListener("lostpointercapture", onLostCapture);
    pet.addEventListener("contextmenu", onContextMenu);
    doc.addEventListener("pointerdown", onDocClick, true);
    doc.addEventListener("contextmenu", onDocumentContextMenu, true);
    window.addEventListener("pointermove", onPointerMove, { passive: true });
    window.addEventListener("pointerup", onPointerUp, { passive: true });
    window.addEventListener("mousemove", onActivity, { passive: true });
    window.addEventListener("keydown", onActivity, { passive: true });
    window.addEventListener("keydown", onKeyDown);
    window.addEventListener("resize", onResize);
    doc.addEventListener("visibilitychange", onActivity);

    // DSH 的框架是异步撑开的：挂载那一刻容器可能还没有最终尺寸，
    // 所以盯着容器尺寸，待角落时跟着重新落位。
    const resizeObserver =
      typeof ResizeObserver === "function" ? new ResizeObserver(onResize) : undefined;
    resizeObserver?.observe(layer);

    // ------------------------------ 启动 ------------------------------
    if (anchored) pos = corner();
    apply();
    awayTimer = setInterval(checkAway, 30000);
    scheduleIdle();
    scheduleBusy();

    if (saved.hidden) {
      pet.style.display = "none";
      dock.classList.add("zx-show");
      apply();
    } else {
      sayKind(saved.hatched ? "greet" : "hatch");
      state.hatched = true;
      save();
    }

    // ------------------------------ 对外 API ------------------------------
    api.setState = setState;
    api.say = say;
    api.sayKind = sayKind;
    api.setSize = setSize;
    api.poke = () => {
      animateFor(pokeAnimationMs);
      sayKind("poke");
      burst(2);
    };
    api.show = () => {
      state.hidden = false;
      save();
      pet.style.display = "";
      dock.classList.remove("zx-show");
      sayKind("greet");
      apply();
    };
    api.hide = () => {
      state.hidden = true;
      save();
      clearSparks(); // 藏起来时动画不会结束，顺手清掉残留的星星
      pet.style.display = "none";
      dock.classList.add("zx-show");
      apply();
    };
    api.destroy = () => {
      if (api.destroyed) return;
      api.destroyed = true;
      stopAnimation();
      clearTimeout(bubbleTimer);
      clearTimeout(idleTimer);
      clearTimeout(busyTimer);
      clearInterval(awayTimer);
      pet.removeEventListener("pointerdown", onPointerDown);
      pet.removeEventListener("pointermove", onPointerMove);
      pet.removeEventListener("pointerup", onPointerUp);
      pet.removeEventListener("pointercancel", onPointerUp);
      pet.removeEventListener("lostpointercapture", onLostCapture);
      pet.removeEventListener("contextmenu", onContextMenu);
      doc.removeEventListener("pointerdown", onDocClick, true);
      doc.removeEventListener("contextmenu", onDocumentContextMenu, true);
      window.removeEventListener("pointermove", onPointerMove);
      window.removeEventListener("pointerup", onPointerUp);
      window.removeEventListener("mousemove", onActivity);
      window.removeEventListener("keydown", onActivity);
      window.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("resize", onResize);
      doc.removeEventListener("visibilitychange", onActivity);
      resizeObserver?.disconnect();
      layer.remove();
      // 最后一只熊走了，样式也一起收走（HMR 重新挂载时会再加回来）。
      livePets = Math.max(0, livePets - 1);
      if (livePets === 0) doc.getElementById(PET_STYLE_ID)?.remove();
    };
  };

  if (doc.body) start();
  else doc.addEventListener("DOMContentLoaded", start, { once: true });

  return api;
}
