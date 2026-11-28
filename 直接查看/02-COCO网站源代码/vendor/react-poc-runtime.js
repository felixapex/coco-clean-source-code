(() => {
  const TEXT = Symbol('text');
  const flatten = (items) => items.flat(Infinity).filter((item) => item !== null && item !== undefined && item !== false && item !== true);
  function createElement(type, props, ...children) {
    return { type, props: props || {}, children: flatten(children) };
  }
  function toDom(vnode) {
    if (typeof vnode === 'string' || typeof vnode === 'number') return document.createTextNode(String(vnode));
    if (!vnode) return document.createTextNode('');
    if (typeof vnode.type === 'function') return toDom(vnode.type({ ...vnode.props, children: vnode.children }));
    const el = document.createElement(vnode.type);
    for (const [key, value] of Object.entries(vnode.props || {})) {
      if (key === 'children' || value === undefined || value === null || value === false) continue;
      if (key === 'className') { el.setAttribute('class', String(value)); continue; }
      if (key.startsWith('on') && typeof value === 'function') { el.addEventListener(key.slice(2).toLowerCase(), value); continue; }
      if (value === true) { el.setAttribute(key, ''); continue; }
      el.setAttribute(key, String(value));
    }
    for (const child of vnode.children || []) el.appendChild(toDom(child));
    return el;
  }
  globalThis.React = { createElement, Fragment: TEXT };
  globalThis.ReactDOM = {
    createRoot(container) {
      return { render(vnode) { container.replaceChildren(toDom(vnode)); } };
    },
  };
})();
