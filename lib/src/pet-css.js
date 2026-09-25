/**
 * 自嘲熊桌宠的样式，以字符串形式打包，避免插件需要额外的 CSS 构建步骤。
 * 注入到 document.head 的 <style id="zx-pet-style"> 里。
 */

export const PET_STYLE_ID = "zx-pet-style";

export const PET_CSS = `
.zx-pet-layer, .zx-pet {
  --zx-size: 168px;
  --zx-scale: 1;                                    /* = size / 168，气泡据此整体缩放 */
  --zx-shadow-h: 15px;
  /* 气泡底边距：bottom 是相对「熊盒子底边」算的，而盒子 = 熊高 + 落影高，
     所以间距必须 ≥ 落影高，气泡本体才完全落在熊头顶之上（否则会压住发箍）。
     多出的 2px 是留给尾巴尖搭在头上的余量。 */
  --zx-gap: calc(17px * var(--zx-scale));
  --zx-ink: #1c1916;
  --zx-paper: #fffdf8;
  --zx-z: 2147483000;
}
/* 槽位容器：DSH 的 shell.overlay 会把它自己的直接子元素设成 pointer-events:auto，
   这里必须显式关掉，否则整层会挡住下面的界面（桌宠自己再单独打开）。 */
.zx-pet-host {
  position: absolute;
  inset: 0;
  pointer-events: none;
}
.zx-pet-layer {
  inset: 0;
  z-index: var(--zx-z);
  pointer-events: none;
  font-family: "PingFang SC", "HarmonyOS Sans SC", "Microsoft YaHei UI", "Microsoft YaHei", system-ui, sans-serif;
  -webkit-font-smoothing: antialiased;
}

/* ------------------------------- 熊本体 ------------------------------- */
.zx-pet {
  position: absolute;
  left: 0;
  top: 0;
  width: var(--zx-size);
  height: calc(var(--zx-size) + var(--zx-shadow-h));
  pointer-events: auto;
  cursor: grab;
  user-select: none;
  touch-action: none;
}
.zx-pet.zx-dragging { cursor: grabbing; }

/* 默认完全静止：不播帧、不浮动。只有 .zx-animating 时才动 ——
   由点击/拖动触发，播完自动收回静止帧。 */
.zx-bob {
  position: absolute;
  left: 0;
  top: 0;
  width: var(--zx-size);
  height: var(--zx-size);
  transform-origin: 50% 96%;
  z-index: 2;
}
@keyframes zx-bob {
  0%, 100% { transform: translateY(0) rotate(-.7deg); }
  50%      { transform: translateY(-7px) rotate(1deg); }
}
.zx-pet.zx-animating .zx-bob { animation: zx-bob 3.2s ease-in-out infinite; }

.zx-sprite { position: absolute; inset: 0; }
.zx-sprite img {
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
  opacity: 0;
  pointer-events: none;
  -webkit-user-drag: none;
  filter: drop-shadow(0 7px 9px rgba(24, 20, 16, .2));
}
.zx-sprite img.zx-on { opacity: 1; }

.zx-ground {
  position: absolute;
  left: 50%;
  bottom: 0;
  width: calc(var(--zx-size) * .58);
  height: var(--zx-shadow-h);
  transform: translateX(-50%);
  background: radial-gradient(ellipse at center, rgba(24,20,16,.3) 0%, rgba(24,20,16,.13) 46%, rgba(24,20,16,0) 74%);
  z-index: 1;
}
.zx-pet.zx-animating .zx-ground { animation: zx-ground 3.2s ease-in-out infinite; }
@keyframes zx-ground {
  0%, 100% { transform: translateX(-50%) scale(1, 1); opacity: 1; }
  50%      { transform: translateX(-50%) scale(.85, .78); opacity: .68; }
}

/* ------------------------------ 气泡台词 ------------------------------ */
.zx-bubble {
  position: absolute;
  /* 默认「在熊头顶居中」；贴边时由 JS 改成 px，保证整只气泡留在框内 */
  left: var(--zx-bubble-left, calc(50% - 108px * var(--zx-scale)));
  bottom: calc(var(--zx-size) + var(--zx-gap));
  transform: translateY(calc(7px * var(--zx-scale))) scale(.88);
  transform-origin: 32% 100%;
  /* 全套尺寸都跟着 --zx-scale 走：熊调小，气泡和字一起变小 */
  max-width: calc(216px * var(--zx-scale));
  min-width: calc(78px * var(--zx-scale));
  padding: calc(9px * var(--zx-scale)) calc(14px * var(--zx-scale)) calc(10px * var(--zx-scale));
  background: var(--zx-paper);
  border: calc(2.5px * var(--zx-scale)) solid var(--zx-ink);
  border-radius: calc(19px * var(--zx-scale)) calc(19px * var(--zx-scale))
                 calc(19px * var(--zx-scale)) calc(8px * var(--zx-scale));
  box-shadow: 0 calc(9px * var(--zx-scale)) calc(22px * var(--zx-scale)) rgba(20, 16, 12, .18),
              0 1px 0 rgba(255,255,255,.7) inset;
  color: #241f1b;
  font-size: calc(13.5px * var(--zx-scale));
  font-weight: 600;
  line-height: 1.55;
  letter-spacing: .2px;
  white-space: pre-wrap;
  word-break: break-word;
  opacity: 0;
  pointer-events: none;
  z-index: 3;
  transition: opacity .17s ease-out, transform .24s cubic-bezier(.34, 1.56, .64, 1);
}
.zx-bubble.zx-show { opacity: 1; transform: translateY(0) scale(1); }

/* 头顶空间不够时翻到熊下面（尖角朝上），避免气泡压住或者跑出画面 */
.zx-bubble.zx-below {
  top: calc(var(--zx-size) + var(--zx-shadow-h) + var(--zx-gap));
  bottom: auto;
}

/* 尾巴分两块画，才能既开口干净又不歪：
   ::after  45° 正方形，只留两条相邻描边，转 45° 后自然成为对称的 V 形，
            尖角用 border-radius 收圆；
   ::before 一块与气泡同色的窄遮罩，正好盖住接口处的描边，
            让尾巴根部是"开口"而不是被横线横穿。
   两块都用 z-index:-1：画在气泡边框之上、文字之下（气泡自身 z-index:3 建了层叠上下文）。 */
.zx-bubble::after {
  content: "";
  position: absolute;
  left: var(--zx-tail-left, 50%);
  bottom: calc(-7.5px * var(--zx-scale));
  width: calc(15px * var(--zx-scale));
  height: calc(15px * var(--zx-scale));
  margin-left: calc(-7.5px * var(--zx-scale));
  background: var(--zx-paper);
  border-right: calc(2.5px * var(--zx-scale)) solid var(--zx-ink);
  border-bottom: calc(2.5px * var(--zx-scale)) solid var(--zx-ink);
  border-bottom-right-radius: calc(7px * var(--zx-scale));
  transform: rotate(45deg);
  z-index: -1;
}
.zx-bubble::before {
  content: "";
  position: absolute;
  left: calc(var(--zx-tail-left, 50%) - 10.5px * var(--zx-scale));
  bottom: calc(-2.5px * var(--zx-scale));
  width: calc(21px * var(--zx-scale));
  height: calc(2.6px * var(--zx-scale));
  background: var(--zx-paper);
  z-index: -1;
}
/* 翻转态：描边换到左边+上边，遮罩移到上沿 */
.zx-bubble.zx-below::after {
  top: calc(-7.5px * var(--zx-scale));
  bottom: auto;
  border-right: 0;
  border-bottom: 0;
  border-left: calc(2.5px * var(--zx-scale)) solid var(--zx-ink);
  border-top: calc(2.5px * var(--zx-scale)) solid var(--zx-ink);
  border-bottom-right-radius: 0;
  border-top-left-radius: calc(7px * var(--zx-scale));
}
.zx-bubble.zx-below::before {
  top: calc(-2.5px * var(--zx-scale));
  bottom: auto;
}
.zx-dots span {
  display: inline-block;
  width: 4px;
  height: 4px;
  margin: 0 1.5px;
  border-radius: 50%;
  background: var(--zx-ink);
  opacity: .3;
  animation: zx-dot 1.1s ease-in-out infinite;
}
.zx-dots span:nth-child(2) { animation-delay: .16s; }
.zx-dots span:nth-child(3) { animation-delay: .32s; }
@keyframes zx-dot {
  0%, 100% { opacity: .22; transform: translateY(0); }
  40%      { opacity: 1; transform: translateY(-2px); }
}

/* ------------------------------- 星星特效 ------------------------------ */
.zx-spark {
  position: absolute;
  left: 50%;
  top: 30%;
  font-size: calc(15px * var(--zx-scale));
  opacity: 0;
  pointer-events: none;
  z-index: 4;
}
.zx-spark.zx-pop { animation: zx-spark .75s ease-out forwards; }
@keyframes zx-spark {
  0%   { opacity: 0; transform: translate(0, 0) scale(.45) rotate(0deg); }
  22%  { opacity: 1; }
  100% { opacity: 0; transform: translate(var(--dx), var(--dy)) scale(1.2) rotate(var(--rot)); }
}

/* 不做 hover 缩放：按需求「只有点击时才可以动」，指针形状已经说明它可以点。 */

/* ------------------------------ 右键小菜单 ----------------------------- */
.zx-menu {
  position: absolute;
  pointer-events: auto;
  z-index: 5;
  min-width: calc(116px * var(--zx-scale));
  padding: calc(5px * var(--zx-scale));
  background: var(--zx-paper);
  border: calc(2.5px * var(--zx-scale)) solid var(--zx-ink);
  border-radius: calc(13px * var(--zx-scale));
  box-shadow: 0 calc(10px * var(--zx-scale)) calc(24px * var(--zx-scale)) rgba(20, 16, 12, .2);
  display: none;
}
.zx-menu.zx-show { display: block; animation: zx-menu-in .16s ease-out; }
@keyframes zx-menu-in {
  from { opacity: 0; transform: translateY(4px) scale(.96); }
  to   { opacity: 1; transform: none; }
}
.zx-menu button {
  display: block;
  width: 100%;
  padding: calc(6px * var(--zx-scale)) calc(10px * var(--zx-scale));
  border: 0;
  border-radius: calc(9px * var(--zx-scale));
  background: transparent;
  color: #241f1b;
  font: 600 calc(12.5px * var(--zx-scale))/1.5 inherit;
  text-align: left;
  cursor: pointer;
  white-space: nowrap;
}
.zx-menu button:hover { background: #f0e7d8; }

/* --------------------------- 藏起来后的小圆钮 --------------------------- */
.zx-dock {
  position: absolute;
  width: 40px;
  height: 40px;
  padding: 0;
  border: 2.5px solid var(--zx-ink);
  border-radius: 50%;
  background: var(--zx-paper);
  box-shadow: 0 6px 16px rgba(20, 16, 12, .18);
  cursor: pointer;
  pointer-events: auto;
  overflow: hidden;
  display: none;
  opacity: .78;
  transition: opacity .18s ease-out, transform .18s ease-out;
}
.zx-dock.zx-show { display: block; }
.zx-dock:hover { opacity: 1; transform: scale(1.06); }
.zx-dock img { width: 132%; height: 132%; object-fit: cover; margin: -14% 0 0 -16%; }

@media (prefers-reduced-motion: reduce) {
  .zx-bob, .zx-ground { animation: none !important; }
}
`;
