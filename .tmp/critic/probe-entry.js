import { bootPreview } from '/Users/yoyopc/repos/kart-project/src/core/harness.js';
import { garageScene, setKartPreviewMounter } from '/Users/yoyopc/repos/kart-project/src/garage/garage.js';
import { createKart } from '/Users/yoyopc/repos/kart-project/src/kart/kartmodel.js';

window.__CALLS = [];
window.__TIERS = null;
setKartPreviewMounter((container, o = {}) => {
  const kart = createKart({ racerId: 'player', parts: { engine: 0, tires: 0, wing: 0, chassis: 0, exhaust: 0 }, shadows: false });
  container.add(kart.group); window.__KART = kart;
  return {
    // deliberately expose BOTH so we can see which one the garage actually uses
    setPart(slot, vt) { window.__CALLS.push(['setPart', slot, vt]); },
    setParts(p) { window.__CALLS.push(['setParts', JSON.stringify(p)]); window.__TIERS = p; kart.setParts(p); },
    update: kart.update, dispose: kart.dispose,
    _kart: kart,
  };
});
bootPreview((engine, o = {}) => garageScene(engine, { visit: 2, meet: false, tokens: 17, onDone: (p, g) => { window.__DONE = { p, g }; }, ...o }));
