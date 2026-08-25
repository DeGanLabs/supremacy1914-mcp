import type { Vec2 } from "../types/common.js";
import type { WirePoint } from "../types/actions.js";

export function toWirePoint(p: Vec2): WirePoint {
  return { x: p.x, y: p.y };
}

export function distanceSq(a: Vec2, b: Vec2): number {
  const dx = a.x - b.x;
  const dy = a.y - b.y;
  return dx * dx + dy * dy;
}

export function nearlyEqualPoint(a: Vec2, b: Vec2, epsilon = 0.01): boolean {
  return distanceSq(a, b) <= epsilon * epsilon;
}
