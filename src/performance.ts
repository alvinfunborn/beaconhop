import {call, native} from "./api";

const enabled = native ? call<boolean>("performance_enabled").catch(() => false) : Promise.resolve(false);
export function timing(stage:string, sessionId:number, elapsedMs=0, count=0) {
  void enabled.then(on => {
    if (on) return call("record_performance", {sessionId,stage,elapsedMs,count});
  }).catch(() => {});
}

// The second frame is a paint opportunity, not proof of pixels on the display.
export function afterFrame(callback:()=>void) {
  let frame=requestAnimationFrame(()=>{ frame=requestAnimationFrame(callback); });
  return ()=>cancelAnimationFrame(frame);
}
