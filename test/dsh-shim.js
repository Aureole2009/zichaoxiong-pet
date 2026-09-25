/**
 * 离线测试替身：模拟 DSH 浏览器侧中桌宠用到的那几块接口。
 *
 *   window.__ModuleLoader__.load({id, factory})   —— 经典脚本自注册
 *   require("react")                              —— 极简 React（createElement/useRef/useEffect）
 *   ctx.slots.inject / register                   —— 含 shell.overlay 的点击穿透层语义
 *   ctx.sessions.list / binding                   —— running + lastAgentError
 *   ctx.effect                                    —— 收集清理器
 *
 * 只替身桌宠真正用到的部分；任何多余行为都算测试失效。
 */
(function () {
  const registry = new Map();
  window.__ModuleLoader__ = {
    load(registration) {
      if (registry.has(registration.id)) throw new Error(`duplicate factory registration for "${registration.id}"`);
      registry.set(registration.id, registration);
    },
  };

  // ------------------------------- 极简 React -------------------------------
  // 顺序刻意与真 React 一致：先建 DOM（赋 ref）、把它插进文档，**然后**才跑 effect。
  // effect 里如果依赖"自己的 DOM 已经在文档里"，这个顺序才和真宿主一样。
  const hooks = { list: [], index: 0, effects: [] };
  const pendingEffects = [];

  function renderComponent(type, props) {
    hooks.list = [];
    hooks.index = 0;
    hooks.effects = [];
    const tree = type(props ?? {});
    const node = buildDom(tree);
    for (const run of hooks.effects) pendingEffects.push(run);
    return node;
  }

  /** 把攒下的 effect 跑掉 —— 由调用方在节点进入文档之后调用。 */
  function flushEffects() {
    while (pendingEffects.length > 0) pendingEffects.shift()();
  }

  const react = {
    createElement(type, props, ...children) {
      if (typeof type === "function") return { __component: type, props: props ?? {} };
      return { type, props: props ?? {}, children };
    },
    useRef(initial) {
      const slot = hooks.index++;
      hooks.list[slot] ??= { current: initial };
      return hooks.list[slot];
    },
    useEffect(fn) {
      const slot = hooks.index++;
      if (hooks.list[slot]) return;
      hooks.list[slot] = true;
      hooks.effects.push(fn);
    },
  };

  // ------------------------------ 假 DSH 服务 ------------------------------
  const state = {
    overlays: new Map(),
    disposers: [],
    listeners: new Set(),
    sessions: {
      current: "session-test",
      byId: { "session-test": { id: "session-test", running: false, displayTitle: "测试会话" } },
      // 页面可以用 window.__zxPreError 预置一条「上一轮留下的」错误
      lastAgentError: window.__zxPreError ?? null,
    },
    slots: null,
    ctx: null,
    /**
     * 模拟「layout 从没声明过 shell.overlay」：槽位回调只被记下、永不执行。
     * 页面可以设 window.__zxSkipSlot = true，或在 URL 上加 ?noslot=1。
     */
    skipSlot: Boolean(window.__zxSkipSlot) || new URLSearchParams(location.search).has("noslot"),
    pendingSlotCallbacks: [],
  };

  const fakeCtx = {
    effect(fn, label) {
      const dispose = fn();
      state.disposers.push({ dispose, label });
      return () => dispose?.();
    },
    slots: {
      inject(key, callback) {
        if (key !== "shell.overlay") throw new Error(`unexpected slot ${key}`);
        // ?noslot=1 用来验证插件的兜底路径：假装 layout 从没声明过这个槽位。
        state.pendingSlotCallbacks.push(callback);
        if (state.skipSlot) return () => {};
        const dispose = callback();
        return () => dispose?.();
      },
      register(options, Component) {
        const cell = `${options.name}#${options.id ?? ""}`;
        state.overlays.set(cell, { options, Component });
        return () => state.overlays.delete(cell);
      },
    },
    sessions: {
      list: {
        getSnapshot() {
          return { current: state.sessions.current, byId: state.sessions.byId, ids: ["session-test"] };
        },
        subscribe(listener) {
          state.listeners.add(listener);
          return () => state.listeners.delete(listener);
        },
      },
      binding(id) {
        if (id !== "session-test") return undefined;
        return {
          sessionId: id,
          session: { getSnapshot: () => ({ lastAgentError: state.sessions.lastAgentError }) },
        };
      },
    },
  };
  state.slots = fakeCtx.slots;
  state.ctx = fakeCtx;

  // --------------------------- 宿主侧渲染替身 ---------------------------
  const overlayLayer = document.createElement("div");
  overlayLayer.setAttribute("data-shell-overlay", "");
  overlayLayer.className = "overlayLayer";
  document.body.append(overlayLayer);

  // 与 dsh-client-ui-layout 一致的层几何：点击穿透，直接子元素自动吃事件
  const style = document.createElement("style");
  style.textContent = ".overlayLayer{z-index:20;pointer-events:none;position:absolute;inset:0}"
    + ".overlayLayer>*{pointer-events:auto}";
  document.head.append(style);

  window.__zxHarness = {
    react,
    state,
    /** 渲染槽位条目，返回它渲染出的根元素。DOM 先进文档，再跑 effect（同真 React）。 */
    renderOverlays() {
      const rendered = [];
      for (const [cell, entry] of state.overlays) {
        const node = document.createElement("div");
        node.setAttribute("data-cell", cell);
        const built = buildDom(react.createElement(entry.Component, {}));
        node.append(built);
        overlayLayer.append(node);
        flushEffects();
        rendered.push({ cell, node, built });
      }
      return rendered;
    },
    notify() {
      for (const listener of state.listeners) listener();
    },
    setRunning(running) {
      state.sessions.byId["session-test"].running = running;
      window.__zxHarness.notify();
    },
    setError(text) {
      state.sessions.lastAgentError = text;
      window.__zxHarness.notify();
    },
    disposeAll() {
      for (const { dispose } of state.disposers) dispose?.();
      state.disposers.length = 0;
      overlayLayer.replaceChildren();
    },
  };

  /** 把 createElement 的产物变成真实 DOM（含 ref 与 style 对象）。 */
  function buildDom(element) {
    if (element && element.__component) return renderComponent(element.__component, element.props);
    if (element === null || element === undefined || element === false) return document.createTextNode("");
    if (typeof element === "string" || typeof element === "number") return document.createTextNode(String(element));
    const node = document.createElement(element.type);
    for (const [key, value] of Object.entries(element.props ?? {})) {
      if (key === "ref") {
        if (value && typeof value === "object") value.current = node;
        continue;
      }
      if (key === "className") node.className = value;
      else if (key === "style" && value && typeof value === "object") Object.assign(node.style, value);
      else if (key.startsWith("on") && typeof value === "function") node.addEventListener(key.slice(2).toLowerCase(), value);
      else node.setAttribute(key, String(value));
    }
    for (const child of element.children ?? []) node.append(buildDom(child));
    return node;
  }

  /** 取得插件导出的工厂（由 lib/client.js 注册）。 */
  window.__zxLoadPlugin = function loadPlugin(id) {
    const registration = registry.get(id);
    if (!registration) throw new Error(`bundle did not register "${id}"`);
    return registration.factory((specifier) => {
      if (specifier === "react") return react;
      throw new Error(`unexpected require("${specifier}")`);
    });
  };
})();
