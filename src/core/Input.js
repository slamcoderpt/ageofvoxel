// Raw input state. The UI piece builds selection/orders on top of this; the
// camera reads keys/edge-scroll/wheel from it.
export class Input {
  constructor(dom) {
    this.dom = dom;
    this.keys = new Set();
    this.mouse = { x: 0, y: 0, inside: false, buttons: 0 };
    this.wheel = 0;
    this.enabled = true;
    addEventListener('keydown', (e) => { if (!isTyping(e)) this.keys.add(e.code); });
    addEventListener('keyup', (e) => this.keys.delete(e.code));
    addEventListener('blur', () => this.keys.clear());
    addEventListener('mousemove', (e) => { this.mouse.x = e.clientX; this.mouse.y = e.clientY; this.mouse.inside = true; });
    document.addEventListener('mouseleave', () => { this.mouse.inside = false; });
    dom.addEventListener('wheel', (e) => { this.wheel += e.deltaY; e.preventDefault(); }, { passive: false });
    dom.addEventListener('contextmenu', (e) => e.preventDefault());
  }
  consumeWheel() { const w = this.wheel; this.wheel = 0; return w; }
}
function isTyping(e) { return e.target && (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA'); }
