# DSH client-plugin notes

Condensed from building this pet against DSH `0.1.5-rc.3`. Everything below was
verified against the shipped packages, not just their docs — the file references
are to `node_modules/@deepseek-ai/*` in a DSH install.

## What a client plugin is

A DSH plugin package has two halves:

| Half | File | Runs in | Job |
| --- | --- | --- | --- |
| host | `lib/index.js` (`main`) | the `dsh web` node process | can register services; **required even for a browser-only plugin** |
| client | `lib/client.js` (`exports["./client"]`) | the browser page | draws UI, reads client services |

Discovery is `package.json` → `dsh.client.platform === "web"` plus a resolvable
`exports["./client"]`. Nothing else is needed to be loaded — but nothing is mounted
until your bundle patch inserts a row for it.

## The client bundle format

`lib/client.js` is **not** an ES module. It is a classic script that registers a CJS
factory; DSH snapshots the file at boot and serves it from `/plugins/<package-name>/client.js`.

```js
window.__ModuleLoader__.load({
  id: "your-package-name",           // MUST equal the package name
  factory: (require) => {
    var module = { exports: {} };
    var exports = module.exports;
    const react = require("react");  // platform modules need no declaration
    function apply(ctx) { /* … */ }
    const inject = ["slots", "sessions"];
    exports.apply = apply;
    exports.inject = inject;
    return module.exports;
  },
});
```

- `id` ≠ package name → DSH throws when the bundle materialises.
- Module-level side effects (including CSS injection) must live **inside** the factory:
  the bundle is executed once to register, and materialised later.
- `require` resolves a small platform table for free (`react`, `react/jsx-runtime`,
  `react-dom`, `@deepseek-ai/cordis`, `@deepseek-ai/dsh-client-ui-primitives`, …).
  Anything else needs `dsh.client.external` + `dsh.client.inject` (package names).
- Exported `inject` is a list of **service names** (`slots`, `sessions`, `locale`, …);
  Cordis will not call `apply` until they exist. The `dsh.client.inject` field in
  package.json is a different thing: package-name edges that order module arrival.

## Mounting a floating layer

Do **not** touch `document.body` or `ctx.layout`. The sanctioned seat for a
frame-wide surface is the layout plugin's `shell.overlay` list slot:

```js
ctx.effect(() => {
  const off = ctx.slots.inject("shell.overlay", () =>
    ctx.slots.register({ name: "shell.overlay", id: "my-cell", order: 60 }, MyComponent),
  );
  return () => off();
}, "my-plugin: overlay");
```

The overlay layer is `position:absolute; inset:0; z-index:20; pointer-events:none`, and
its **direct children get `pointer-events:auto`**. If your root element is a full-size
container, that rule will swallow clicks for the whole frame — turn it off explicitly
(inline `style="pointer-events:none"` wins over the layer's `> *` rule).

## Reading agent state

There is no `turn/*` or `tool/*` Cordis event on the client. State comes from the
session controller service:

```js
const snapshot = ctx.sessions.list.getSnapshot();   // { current, byId, phase, … }
const running = snapshot.byId[snapshot.current]?.running;   // "a turn is running"

const binding = ctx.sessions.binding(snapshot.current);
binding.session.getSnapshot().lastAgentError;               // human-readable error text
binding.eventSource.subscribe(() => {                       // full session log window
  // entries carry 'turn/start' | 'turn/end' | 'step/*' | 'tool/call' | 'tool/result' | …
  // turn/end.data.reason.kind: 'completed' | 'aborted' | 'blocked' | 'error' | 'max-tokens'
});
```

This plugin deliberately reads **only** `running` and `lastAgentError` — no conversation
content — and degrades to a plain idle pet if `ctx.sessions` is ever renamed.

## Installing a locally authored plugin

```bash
dsh plugin --profile web add <path-or-git-url>   # forwards to pnpm in the profile dir,
                                                 # then reconciles dsh.profile.bundles
```

- The package must be a **regular dependency** (not `-D`): the reconciler only scans
  `dependencies` for packages declaring `dsh.bundle.patch`.
- A new package needs **one restart** of `dsh web` — `dsh.profile.bundles` is read once
  at process start. After that, editing `lib/client.js` hot-swaps in the browser in
  ~500 ms (`dsh-client-hmr` stat-polls the bundle) with no restart and no refresh.
- Two layers inserting the same row id is a hard boot failure
  (`duplicate loader entry id`), so never repeat the bundle's own row in the profile
  `cordis.patch.yml`.
- Disable without uninstalling: add `- id: <row-id>` + `disabled: true` to
  `<DSH_HOME>/profiles/web/cordis.patch.yml` (that file is watched live).

## Gotchas this project hit

1. **Coordinate systems.** A child of the pet box (`left/top`) and a position inside the
   frame-wide layer (`pos.left/top`) differ by the pet's origin. Mixing them silently
   throws your UI thousands of pixels away — which looks exactly like "the menu is
   broken".
2. **Pointer capture eats clicks.** Calling `setPointerCapture()` on pointerdown for
   drag support retargets the following `pointerup`/`click` to the capturing element.
   If a popup lives inside the draggable element, its buttons stop firing. Bail out of
   the drag handler when the pointerdown came from the popup.
3. **`opacity` mid-transition.** A screenshot taken during a fade-in shows the element
   at partial opacity — a "missing border" that is not a bug. Assert computed styles,
   not pixels.
4. **`bottom` is measured from the containing block's padding box**, i.e. the *bottom*
   of the pet box. A bubble anchored "above the head" needs
   `bottom ≥ petHeight`, not `bottom ≥ spriteHeight`.
5. **CSS `zoom`/`transform` for scaling UI** breaks the pixel maths around it; derive
   every metric from one `--scale` custom property instead.
