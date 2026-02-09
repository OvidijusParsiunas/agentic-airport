import { Plane, Airport } from '../types/game';
import { degToRad } from './geometry';

export function drawAirport(
  ctx: CanvasRenderingContext2D,
  airport: Airport,
  canvasWidth: number,
  canvasHeight: number
) {
  // Draw background grid (radar style)
  ctx.strokeStyle = '#1a3050';
  ctx.lineWidth = 1;

  const gridSize = 50;
  for (let x = 0; x < canvasWidth; x += gridSize) {
    ctx.beginPath();
    ctx.moveTo(x, 0);
    ctx.lineTo(x, canvasHeight);
    ctx.stroke();
  }
  for (let y = 0; y < canvasHeight; y += gridSize) {
    ctx.beginPath();
    ctx.moveTo(0, y);
    ctx.lineTo(canvasWidth, y);
    ctx.stroke();
  }

  // Draw runway
  ctx.save();
  ctx.strokeStyle = '#ffffff';
  ctx.lineWidth = airport.runwayWidth;
  ctx.lineCap = 'round';

  ctx.beginPath();
  ctx.moveTo(airport.runwayStart.x, airport.runwayStart.y);
  ctx.lineTo(airport.runwayEnd.x, airport.runwayEnd.y);
  ctx.stroke();

  // Draw runway center line (dashed)
  ctx.strokeStyle = '#fbbf24';
  ctx.lineWidth = 2;
  ctx.setLineDash([20, 15]);
  ctx.beginPath();
  ctx.moveTo(airport.runwayStart.x, airport.runwayStart.y);
  ctx.lineTo(airport.runwayEnd.x, airport.runwayEnd.y);
  ctx.stroke();
  ctx.setLineDash([]);
  ctx.restore();

  // Draw runway threshold markers
  const markerLength = 15;
  const markerSpacing = 8;
  const numMarkers = Math.floor(airport.runwayWidth / markerSpacing) - 1;
  const runwayAngle = Math.atan2(
    airport.runwayEnd.y - airport.runwayStart.y,
    airport.runwayEnd.x - airport.runwayStart.x
  );

  ctx.fillStyle = '#ffffff';
  for (let i = -numMarkers / 2; i <= numMarkers / 2; i++) {
    const offsetX = Math.sin(runwayAngle) * i * markerSpacing;
    const offsetY = -Math.cos(runwayAngle) * i * markerSpacing;

    ctx.fillRect(
      airport.runwayStart.x + offsetX - 2,
      airport.runwayStart.y + offsetY - markerLength / 2,
      4,
      markerLength
    );
  }

  // Draw control tower
  const towerX = airport.position.x;
  const towerY = airport.position.y - 60;

  ctx.fillStyle = '#2a4a6f';
  ctx.fillRect(towerX - 15, towerY, 30, 50);

  ctx.fillStyle = '#4ade80';
  ctx.fillRect(towerX - 20, towerY - 20, 40, 25);

  // Tower light (blinking effect based on time)
  const blink = Math.sin(Date.now() / 500) > 0;
  if (blink) {
    ctx.fillStyle = '#4ade80';
    ctx.beginPath();
    ctx.arc(towerX, towerY - 25, 5, 0, Math.PI * 2);
    ctx.fill();

    ctx.shadowColor = '#4ade80';
    ctx.shadowBlur = 15;
    ctx.fill();
    ctx.shadowBlur = 0;
  }

  // Label
  ctx.fillStyle = '#94a3b8';
  ctx.font = '10px monospace';
  ctx.textAlign = 'center';
  ctx.fillText('TOWER', towerX, towerY + 65);
}

export function drawPlane(ctx: CanvasRenderingContext2D, plane: Plane) {
  ctx.save();
  ctx.translate(plane.position.x, plane.position.y);
  ctx.rotate(degToRad(plane.heading + 90)); // +90 because our heading 0 = right, but we draw pointing up

  // Plane body
  ctx.fillStyle = plane.status === 'crashed' ? '#ef4444' : plane.color;
  ctx.strokeStyle = plane.status === 'crashed' ? '#7f1d1d' : '#ffffff';
  ctx.lineWidth = 1;

  // Main body (triangle/arrow shape)
  ctx.beginPath();
  ctx.moveTo(0, -15); // nose
  ctx.lineTo(-8, 10); // left wing back
  ctx.lineTo(0, 5); // tail indent
  ctx.lineTo(8, 10); // right wing back
  ctx.closePath();
  ctx.fill();
  ctx.stroke();

  // Tail
  ctx.beginPath();
  ctx.moveTo(-5, 8);
  ctx.lineTo(0, 12);
  ctx.lineTo(5, 8);
  ctx.closePath();
  ctx.fill();
  ctx.stroke();

  ctx.restore();

  // Status indicator
  if (plane.status === 'approaching') {
    ctx.strokeStyle = '#fbbf24';
    ctx.lineWidth = 2;
    ctx.setLineDash([5, 5]);
    ctx.beginPath();
    ctx.arc(plane.position.x, plane.position.y, 20, 0, Math.PI * 2);
    ctx.stroke();
    ctx.setLineDash([]);
  }

  // Callsign label
  ctx.fillStyle = '#e5e7eb';
  ctx.font = '10px monospace';
  ctx.textAlign = 'center';
  ctx.fillText(plane.callsign, plane.position.x, plane.position.y + 28);

  // Heading and speed info
  ctx.fillStyle = '#94a3b8';
  ctx.font = '8px monospace';
  ctx.fillText(
    `${Math.round(plane.heading)}° ${plane.speed.toFixed(1)}`,
    plane.position.x,
    plane.position.y + 38
  );
}

export function drawCollisionWarning(
  ctx: CanvasRenderingContext2D,
  plane1: Plane,
  plane2: Plane
) {
  ctx.strokeStyle = '#ef4444';
  ctx.lineWidth = 2;
  ctx.setLineDash([5, 5]);

  ctx.beginPath();
  ctx.moveTo(plane1.position.x, plane1.position.y);
  ctx.lineTo(plane2.position.x, plane2.position.y);
  ctx.stroke();

  ctx.setLineDash([]);

  // Warning icon at midpoint
  const midX = (plane1.position.x + plane2.position.x) / 2;
  const midY = (plane1.position.y + plane2.position.y) / 2;

  ctx.fillStyle = '#ef4444';
  ctx.font = 'bold 16px sans-serif';
  ctx.textAlign = 'center';
  ctx.fillText('⚠', midX, midY);
}

export function drawLandingZone(
  ctx: CanvasRenderingContext2D,
  airport: Airport
) {
  // Draw approach path
  const approachLength = 150;
  const runwayAngle = Math.atan2(
    airport.runwayEnd.y - airport.runwayStart.y,
    airport.runwayEnd.x - airport.runwayStart.x
  );

  // Extend from runway start backwards
  const approachStartX = airport.runwayStart.x - Math.cos(runwayAngle) * approachLength;
  const approachStartY = airport.runwayStart.y - Math.sin(runwayAngle) * approachLength;

  ctx.strokeStyle = '#4ade8040';
  ctx.lineWidth = airport.runwayWidth * 1.5;
  ctx.lineCap = 'round';

  ctx.beginPath();
  ctx.moveTo(approachStartX, approachStartY);
  ctx.lineTo(airport.runwayStart.x, airport.runwayStart.y);
  ctx.stroke();

  // Approach guide lights
  ctx.fillStyle = '#4ade80';
  const numLights = 5;
  for (let i = 1; i <= numLights; i++) {
    const t = i / (numLights + 1);
    const x = approachStartX + (airport.runwayStart.x - approachStartX) * t;
    const y = approachStartY + (airport.runwayStart.y - approachStartY) * t;

    ctx.beginPath();
    ctx.arc(x, y, 3, 0, Math.PI * 2);
    ctx.fill();
  }
}
