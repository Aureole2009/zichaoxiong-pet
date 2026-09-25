/**
 * DSH 客户端入口（源码；由 tools/build-client.mjs 打成一个经典脚本）。
 *
 * 挂载方式：注册进 layout 声明的 shell.overlay 槽位 —— 那是「覆盖整个框架、点击穿透」
 * 的浮动层，桌宠只在这层里占自己那一小块。万一槽位迟迟不出现，4 秒后兜底挂到
 * document.body 上（见 apply）。同一时刻只允许存在一只熊。
 * 状态来源：ctx.sessions.list 的 running 标志 + 当前会话的 lastAgentError。
 *
 * 注意：本文件被打包进 factory 里执行，`react` 由打包器在顶部 require("react") 提供，
 * 其余工具函数（mountPet / FRAME_DATA_URLS …）由同一次拼接提供，所以这里不写 import。
 * 保留的 import 行只是为了让源码单独看是合法的 ESM，打包时会被剥掉。
 */

import { mountPet } from "./pet-core.js";
import { FRAME_DATA_URLS } from "./pet-frames.js";

/** Cordis 服务名（不是包名）。服务不存在时 apply 不会执行。 */
export const inject = ["slots", "sessions"];

const OVERLAY_CELL = "zichaoxiong-pet";

let activePet; // 当前真正在用的那一只（槽位里的，或兜底挂在 body 上的）
let fallbackPet; // 只有走过兜底路径时才存在
let desiredState = "idle";

/** 状态推进：适配器写，桌宠挂载后立即补一次。 */
function pushState(next) {
  desiredState = next;
  activePet?.setState(next);
}

/** 换掉当前这只熊（先销毁旧的，保证任何时刻只有一只）。 */
function replacePet(next) {
  if (activePet && activePet !== next) activePet.destroy();
  activePet = next;
  if (fallbackPet && fallbackPet !== next) {
    fallbackPet.destroy();
    fallbackPet = undefined;
  }
}

/**
 * 覆盖层组件。只做一件事：把宿主 DOM 交给命令式的桌宠组件，
 * 并保证卸载（含 HMR 就地重载）时把它清干净。
 */
function PetOverlay() {
  const hostRef = react.useRef(null);

  react.useEffect(() => {
    const host = hostRef.current;
    if (!host) return undefined;
    // 兜底那只可能先挂上了：这里把它"升级"进槽位，而不是再挂一只。
    const pet = mountPet({ frames: FRAME_DATA_URLS, container: host });
    replacePet(pet);
    pet.setState(desiredState);
    return () => {
      if (activePet === pet) activePet = undefined;
      if (fallbackPet === pet) fallbackPet = undefined;
      pet.destroy();
    };
  }, []);

  return react.createElement("div", {
    ref: hostRef,
    className: "zx-pet-host",
    style: { position: "absolute", inset: 0, pointerEvents: "none" },
  });
}

/**
 * agent 状态 → 桌宠状态。
 *
 * running 由 SessionSummary.running 给出（这是官方的「这一轮在跑」标志）。
 * 只读取状态与错误文本，不读对话内容。
 *
 * @returns 停止函数（幂等）。
 */
function startActivityAdapter(ctx) {
  const sessions = ctx.sessions;
  const list = sessions?.list;
  if (!list || typeof list.getSnapshot !== "function") return () => {};

  let running = false;
  let runningSince = 0;
  let settleTimer = null;
  let lastError; // undefined = 还没建立基线（见下方 evaluate 的首轮处理）

  const readCurrent = () => {
    let snapshot;
    try {
      snapshot = list.getSnapshot();
    } catch {
      return undefined;
    }
    const id = snapshot?.current;
    if (!id) return undefined;
    return { id, row: snapshot.byId?.[id] };
  };

  /** 跑完之后先庆祝，过一会儿再自己回到待机。 */
  const scheduleSettle = () => {
    clearTimeout(settleTimer);
    settleTimer = setTimeout(() => {
      if (readCurrent()?.row?.running === true) return;
      pushState("idle");
    }, 7000);
  };

  const evaluate = () => {
    const current = readCurrent();
    if (!current) return;
    const isRunning = current.row?.running === true;

    if (isRunning && !running) {
      running = true;
      runningSince = Date.now();
      clearTimeout(settleTimer);
      pushState("busy");
    } else if (!isRunning && running) {
      running = false;
      pushState(Date.now() - runningSince > 1200 ? "done" : "idle");
      scheduleSettle();
    }

    // 错误只在「桌宠在场时新出现」才反应：第一次读到的是历史遗留值，只当基线，
    // 否则刷新页面就会莫名其妙看到「熊，搞砸了」。
    let error = null;
    try {
      error = sessions.binding?.(current.id)?.session?.getSnapshot?.()?.lastAgentError ?? null;
    } catch {
      error = null;
    }
    if (lastError === undefined) lastError = error;
    else if (error && error !== lastError) pushState("error");
    lastError = error;
  };

  let unsubscribe = () => {};
  try {
    unsubscribe = list.subscribe?.(evaluate) ?? (() => {});
  } catch {
    unsubscribe = () => {};
  }
  const poll = setInterval(evaluate, 1500);
  evaluate();

  return () => {
    try {
      unsubscribe();
    } catch {
      /* 已经断开 */
    }
    clearInterval(poll);
    clearTimeout(settleTimer);
  };
}

/**
 * 插件入口。全程只注册一个槽位条目，卸载时全部由 ctx.effect 的清理器收回。
 * @param ctx - 客户端 Cordis 上下文。
 */
export function apply(ctx) {
  ctx.effect(() => {
    const offOverlay = ctx.slots.inject("shell.overlay", () =>
      ctx.slots.register({ name: "shell.overlay", id: OVERLAY_CELL, order: 60 }, PetOverlay),
    );
    const stopAdapter = startActivityAdapter(ctx);

    // 兜底：shell.overlay 由 layout 插件声明，万一将来它改了名，桌宠会彻底消失且没有任何提示。
    // 4 秒内没挂上就直接挂到 document.body 上（桌宠脚本本来就支持 fixed 定位），
    // 宁可位置层级略有不同，也不要让用户对着一片空白猜。
    //
    // 竞态：槽位如果恰好在 4 秒之后才渲染，PetOverlay 会通过 replacePet() 把这只兜底的
    // 熊换掉（升级进槽位），而不是并排出现第二只。
    const fallback = setTimeout(() => {
      if (activePet) return;
      console.info("[zichaoxiong-pet] shell.overlay 没有出现，改用 document.body 承载桌宠。");
      const pet = mountPet({ frames: FRAME_DATA_URLS });
      fallbackPet = pet;
      replacePet(pet);
      pet.setState(desiredState);
    }, 4000);

    return () => {
      clearTimeout(fallback);
      stopAdapter();
      offOverlay();
      // 兜底：即使槽位卸载没有触发 React 的 effect 清理，也不留下桌宠。
      activePet?.destroy();
      fallbackPet?.destroy();
      activePet = undefined;
      fallbackPet = undefined;
    };
  }, "zichaoxiong-pet: overlay + activity adapter");
}
