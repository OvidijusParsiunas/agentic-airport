import { Position, Plane } from '../types/game';

export function degToRad(degrees: number): number {
  return (degrees * Math.PI) / 180;
}

export function normalizeAngle(angle: number): number {
  let a = angle % 360;
  if (a < 0) a += 360;
  return a;
}

export function distance(p1: Position, p2: Position): number {
  return Math.sqrt((p2.x - p1.x) ** 2 + (p2.y - p1.y) ** 2);
}

// Calculate the shortest distance accounting for wrap-around (toroidal distance)
export function wrappedDistance(p1: Position, p2: Position, canvasWidth: number, canvasHeight: number): number {
  const wrapped = getWrappedDelta(p1, p2, canvasWidth, canvasHeight);
  return Math.sqrt(wrapped.dx ** 2 + wrapped.dy ** 2);
}

// Get the shortest delta (dx, dy) between two points, accounting for wrap-around
export function getWrappedDelta(p1: Position, p2: Position, canvasWidth: number, canvasHeight: number): { dx: number; dy: number } {
  let dx = p2.x - p1.x;
  let dy = p2.y - p1.y;

  // If going through the wrap boundary is shorter, use that
  if (Math.abs(dx) > canvasWidth / 2) {
    dx = dx > 0 ? dx - canvasWidth : dx + canvasWidth;
  }
  if (Math.abs(dy) > canvasHeight / 2) {
    dy = dy > 0 ? dy - canvasHeight : dy + canvasHeight;
  }

  return { dx, dy };
}

// Calculate heading from p1 to p2, using the shortest path (accounting for wrap-around)
export function wrappedHeadingTo(p1: Position, p2: Position, canvasWidth: number, canvasHeight: number): number {
  const { dx, dy } = getWrappedDelta(p1, p2, canvasWidth, canvasHeight);
  const rad = Math.atan2(dy, dx);
  return normalizeAngle((rad * 180) / Math.PI);
}

export function movePosition(position: Position, heading: number, speed: number): Position {
  const rad = degToRad(heading);
  return {
    x: position.x + Math.cos(rad) * speed,
    y: position.y + Math.sin(rad) * speed,
  };
}

export function checkCollision(plane1: Plane, plane2: Plane, minDistance: number = 30): boolean {
  if (plane1.status === 'landed' || plane2.status === 'landed') return false;
  if (plane1.status === 'crashed' || plane2.status === 'crashed') return false;
  return distance(plane1.position, plane2.position) < minDistance;
}

export function angleDifference(angle1: number, angle2: number): number {
  let diff = normalizeAngle(angle2) - normalizeAngle(angle1);
  if (diff > 180) diff -= 360;
  if (diff < -180) diff += 360;
  return diff;
}

export function randomInRange(min: number, max: number): number {
  return Math.random() * (max - min) + min;
}

// Zone constants
export const APPROACH_ZONE_LENGTH = 300;
export const LANDING_ZONE_EXTENSION = 100;
const AIRPORT_ZONE_PADDING = 30;

// Helper: transform a point to runway-local coordinates
function toRunwayLocal(position: Position, runwayStart: Position, runwayAngle: number): { x: number; y: number } {
  const dx = position.x - runwayStart.x;
  const dy = position.y - runwayStart.y;
  return {
    x: dx * Math.cos(-runwayAngle) - dy * Math.sin(-runwayAngle),
    y: dx * Math.sin(-runwayAngle) + dy * Math.cos(-runwayAngle),
  };
}

// Helper: get runway angle from start/end points
function getRunwayAngle(runwayStart: Position, runwayEnd: Position): number {
  return Math.atan2(runwayEnd.y - runwayStart.y, runwayEnd.x - runwayStart.x);
}

export function isOnRunway(
  position: Position,
  runwayStart: Position,
  runwayEnd: Position,
  runwayWidth: number,
  includeLandingExtension: boolean = false
): boolean {
  const runwayLength = distance(runwayStart, runwayEnd);
  const runwayAngle = getRunwayAngle(runwayStart, runwayEnd);
  const local = toRunwayLocal(position, runwayStart, runwayAngle);
  const maxX = includeLandingExtension ? runwayLength + LANDING_ZONE_EXTENSION : runwayLength;

  return local.x >= 0 && local.x <= maxX && Math.abs(local.y) <= runwayWidth / 2;
}

export function isOverAirport(
  position: Position,
  runwayStart: Position,
  runwayEnd: Position,
  runwayWidth: number
): boolean {
  const runwayLength = distance(runwayStart, runwayEnd);
  const runwayAngle = getRunwayAngle(runwayStart, runwayEnd);
  const local = toRunwayLocal(position, runwayStart, runwayAngle);
  const zoneHalfWidth = (runwayWidth / 2) + AIRPORT_ZONE_PADDING;

  return (
    local.x >= -AIRPORT_ZONE_PADDING &&
    local.x <= runwayLength + AIRPORT_ZONE_PADDING &&
    Math.abs(local.y) <= zoneHalfWidth
  );
}

export function isInApproachZone(
  position: Position,
  runwayStart: Position,
  runwayEnd: Position,
  runwayWidth: number
): boolean {
  const runwayAngle = getRunwayAngle(runwayStart, runwayEnd);
  const approachZoneEntry: Position = {
    x: runwayStart.x - Math.cos(runwayAngle) * APPROACH_ZONE_LENGTH,
    y: runwayStart.y - Math.sin(runwayAngle) * APPROACH_ZONE_LENGTH,
  };

  const local = toRunwayLocal(position, approachZoneEntry, runwayAngle);
  const approachWidth = runwayWidth * 2;

  return local.x >= 0 && local.x <= APPROACH_ZONE_LENGTH && Math.abs(local.y) <= approachWidth / 2;
}
