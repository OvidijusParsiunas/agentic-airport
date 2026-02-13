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

// Predict future position based on current heading and speed
export function predictPosition(position: Position, heading: number, speed: number, frames: number): Position {
  const rad = degToRad(heading);
  return {
    x: position.x + Math.cos(rad) * speed * frames,
    y: position.y + Math.sin(rad) * speed * frames,
  };
}

// Check if two planes will collide within a time horizon
// Returns the predicted collision frame (0 if no collision predicted)
export function predictCollision(
  plane1: Plane,
  plane2: Plane,
  horizonFrames: number = 300, // ~5 seconds at 60fps
  collisionDistance: number = 30
): { willCollide: boolean; framesUntilCollision: number; minDistance: number } {
  let minDistance = distance(plane1.position, plane2.position);
  let collisionFrame = 0;

  // Check positions at intervals
  for (let frame = 30; frame <= horizonFrames; frame += 30) { // Check every 0.5 seconds
    const pos1 = predictPosition(plane1.position, plane1.heading, plane1.speed, frame);
    const pos2 = predictPosition(plane2.position, plane2.heading, plane2.speed, frame);
    const dist = distance(pos1, pos2);

    if (dist < minDistance) {
      minDistance = dist;
      collisionFrame = frame;
    }

    if (dist < collisionDistance) {
      return { willCollide: true, framesUntilCollision: frame, minDistance: dist };
    }
  }

  return { willCollide: minDistance < collisionDistance, framesUntilCollision: collisionFrame, minDistance };
}

// Detect "tail collision" scenario: faster plane catching up to slower plane on similar heading
export function detectTailCollision(
  plane1: Plane,
  plane2: Plane,
  headingTolerance: number = 45 // Consider planes on "similar" paths if within this angle
): { isRisk: boolean; fasterPlane: Plane | null; slowerPlane: Plane | null; catchUpTime: number } {
  // Check if headings are similar (planes going roughly same direction)
  const headingDiff = Math.abs(angleDifference(plane1.heading, plane2.heading));
  if (headingDiff > headingTolerance) {
    return { isRisk: false, fasterPlane: null, slowerPlane: null, catchUpTime: 0 };
  }

  // Determine which plane is "behind" the other based on their headings
  // Project positions onto the average heading direction
  const avgHeading = (plane1.heading + plane2.heading) / 2;
  const rad = degToRad(avgHeading);

  // Calculate how far each plane is along the heading direction
  const proj1 = plane1.position.x * Math.cos(rad) + plane1.position.y * Math.sin(rad);
  const proj2 = plane2.position.x * Math.cos(rad) + plane2.position.y * Math.sin(rad);

  // Determine which is ahead and which is behind
  const plane1Ahead = proj1 > proj2;
  const aheadPlane = plane1Ahead ? plane1 : plane2;
  const behindPlane = plane1Ahead ? plane2 : plane1;

  // Check if the behind plane is faster (will catch up)
  if (behindPlane.speed <= aheadPlane.speed) {
    return { isRisk: false, fasterPlane: null, slowerPlane: null, catchUpTime: 0 };
  }

  // Calculate lateral distance (perpendicular to heading)
  const perpRad = degToRad(avgHeading + 90);
  const lateralDist = Math.abs(
    (plane2.position.x - plane1.position.x) * Math.cos(perpRad) +
    (plane2.position.y - plane1.position.y) * Math.sin(perpRad)
  );

  // If planes are too far apart laterally, no risk
  if (lateralDist > 60) {
    return { isRisk: false, fasterPlane: null, slowerPlane: null, catchUpTime: 0 };
  }

  // Calculate time to catch up
  const distanceBetween = Math.abs(proj1 - proj2);
  const speedDiff = behindPlane.speed - aheadPlane.speed;
  const catchUpFrames = distanceBetween / speedDiff;

  // If catch-up will happen within 10 seconds (600 frames), it's a risk
  if (catchUpFrames < 600) {
    return {
      isRisk: true,
      fasterPlane: behindPlane,
      slowerPlane: aheadPlane,
      catchUpTime: Math.round(catchUpFrames / 60), // Convert to seconds
    };
  }

  return { isRisk: false, fasterPlane: null, slowerPlane: null, catchUpTime: 0 };
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
