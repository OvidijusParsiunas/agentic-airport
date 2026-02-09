import { Plane, Position } from '../types/game';
import { randomInRange } from './geometry';

const CALLSIGNS = [
  'AA', 'UA', 'DL', 'SW', 'BA', 'LH', 'AF', 'KL', 'QF', 'EK',
];

const COLORS = [
  '#60a5fa', // blue
  '#f472b6', // pink
  '#4ade80', // green
  '#fbbf24', // amber
  '#a78bfa', // purple
  '#f87171', // red
  '#2dd4bf', // teal
  '#fb923c', // orange
];

let planeCounter = 0;

export function generateCallsign(): string {
  const prefix = CALLSIGNS[Math.floor(Math.random() * CALLSIGNS.length)];
  const number = Math.floor(Math.random() * 900) + 100;
  return `${prefix}${number}`;
}

export function createPlane(
  canvasWidth: number,
  canvasHeight: number,
): Plane {
  planeCounter++;

  // Spawn planes from edges, heading roughly toward center
  const edge = Math.floor(Math.random() * 4);
  let position: Position;
  let heading: number;

  const margin = 50;
  const variance = 30;

  switch (edge) {
    case 0: // Top
      position = { x: randomInRange(margin, canvasWidth - margin), y: margin };
      heading = randomInRange(90 - variance, 90 + variance);
      break;
    case 1: // Right
      position = { x: canvasWidth - margin, y: randomInRange(margin, canvasHeight - margin) };
      heading = randomInRange(180 - variance, 180 + variance);
      break;
    case 2: // Bottom
      position = { x: randomInRange(margin, canvasWidth - margin), y: canvasHeight - margin };
      heading = randomInRange(270 - variance, 270 + variance);
      break;
    case 3: // Left
    default:
      position = { x: margin, y: randomInRange(margin, canvasHeight - margin) };
      heading = randomInRange(-variance, variance);
      break;
  }

  return {
    id: `plane-${planeCounter}`,
    position,
    heading,
    speed: randomInRange(0.3, 0.6),
    status: 'flying',
    callsign: generateCallsign(),
    color: COLORS[planeCounter % COLORS.length],
  };
}

export function resetPlaneCounter(): void {
  planeCounter = 0;
}
