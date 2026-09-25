/**
 * Host loader 入口。
 *
 * 桌宠完全是浏览器侧的事（一个浮动层 + 一个状态适配器），宿主进程不需要做任何事；
 * 但 loader 会把 bundle 的 main 当作插件导入，所以这个空实现是必须的。
 */
function apply() {}

export { apply };
