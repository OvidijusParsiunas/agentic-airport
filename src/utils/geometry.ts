import { Position, Plane } from '../types/game';

export function degToRad(degrees: number): number {
  return (degrees * Math.PI) / 180;
}

export function radToDeg(radians: number): number {
  return (radians * 180) / Math.PI;
}

export function normalizeAngle(angle: number): number {
  while (angle < 0) angle += 360;
  while (angle >= 360) angle -= 360;
  return angle;
}

export function distance(p1: Position, p2: Position): number {
  return Math.sqrt((p2.x - p1.x) ** 2 + (p2.y - p1.y) ** 2);
}

export function movePosition(
  position: Position,
  heading: number,
  speed: number
): Position {
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

export function isOnRunway(
  position: Position,
  runwayStart: Position,
  runwayEnd: Position,
  runwayWidth: number
): boolean {
  // Check if point is within the runway rectangle
  const runwayLength = distance(runwayStart, runwayEnd);
  const runwayAngle = Math.atan2(
    runwayEnd.y - runwayStart.y,
    runwayEnd.x - runwayStart.x
  );

  // Transform point to runway-local coordinates
  const dx = position.x - runwayStart.x;
  const dy = position.y - runwayStart.y;

  const localX = dx * Math.cos(-runwayAngle) - dy * Math.sin(-runwayAngle);
  const localY = dx * Math.sin(-runwayAngle) + dy * Math.cos(-runwayAngle);

  return (
    localX >= 0 &&
    localX <= runwayLength &&
    Math.abs(localY) <= runwayWidth / 2
  );
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

export function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

export const APPROACH_ZONE_LENGTH = 240;

export function isInApproachZone(
  position: Position,
  runwayStart: Position,
  runwayEnd: Position,
  runwayWidth: number
): boolean {
  const runwayAngle = Math.atan2(
    runwayEnd.y - runwayStart.y,
    runwayEnd.x - runwayStart.x
  );

  // Approach zone entry point (left of runway)
  const approachZoneEntry: Position = {
    x: runwayStart.x - Math.cos(runwayAngle) * APPROACH_ZONE_LENGTH,
    y: runwayStart.y - Math.sin(runwayAngle) * APPROACH_ZONE_LENGTH,
  };

  // Check if in approach zone corridor (extends from entry to runwayStart)
  const approachWidth = runwayWidth * 1.5;
  const dx = position.x - approachZoneEntry.x;
  const dy = position.y - approachZoneEntry.y;
  const localX = dx * Math.cos(-runwayAngle) - dy * Math.sin(-runwayAngle);
  const localY = dx * Math.sin(-runwayAngle) + dy * Math.cos(-runwayAngle);

  return localX >= 0 && localX <= APPROACH_ZONE_LENGTH && Math.abs(localY) <= approachWidth / 2;
}
