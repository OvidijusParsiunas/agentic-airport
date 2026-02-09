import React, { useRef, useEffect, useCallback } from 'react';
import { GameState } from '../types/game';
import { drawAirport, drawPlane, drawCollisionWarning, drawLandingZone } from '../utils/renderer';
import { distance } from '../utils/geometry';

interface GameCanvasProps {
  gameState: GameState;
  onResize: (width: number, height: number) => void;
}

export const GameCanvas: React.FC<GameCanvasProps> = ({ gameState, onResize }) => {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  // Handle resize
  useEffect(() => {
    const handleResize = () => {
      if (containerRef.current) {
        const { width, height } = containerRef.current.getBoundingClientRect();
        onResize(width, height);
      }
    };

    handleResize();
    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, [onResize]);

  // Render
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    // Set canvas size
    canvas.width = gameState.canvasWidth;
    canvas.height = gameState.canvasHeight;

    // Clear
    ctx.fillStyle = '#0a1628';
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    // Draw landing zone
    drawLandingZone(ctx, gameState.airport);

    // Draw airport
    drawAirport(ctx, gameState.airport, gameState.canvasWidth, gameState.canvasHeight);

    // Draw collision warnings
    const activePlanes = gameState.planes.filter(
      p => p.status !== 'landed' && p.status !== 'crashed'
    );
    for (let i = 0; i < activePlanes.length; i++) {
      for (let j = i + 1; j < activePlanes.length; j++) {
        const dist = distance(activePlanes[i].position, activePlanes[j].position);
        if (dist < 60) {
          drawCollisionWarning(ctx, activePlanes[i], activePlanes[j]);
        }
      }
    }

    // Draw planes
    gameState.planes.forEach(plane => {
      drawPlane(ctx, plane);
    });

    // Draw pause overlay
    if (gameState.isPaused) {
      ctx.fillStyle = 'rgba(0, 0, 0, 0.5)';
      ctx.fillRect(0, 0, canvas.width, canvas.height);

      ctx.fillStyle = '#ffffff';
      ctx.font = 'bold 24px sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText('PAUSED', canvas.width / 2, canvas.height / 2);
      ctx.font = '14px sans-serif';
      ctx.fillStyle = '#94a3b8';
      ctx.fillText('Click Start to begin', canvas.width / 2, canvas.height / 2 + 30);
    }
  }, [gameState]);

  return (
    <div ref={containerRef} className="canvas-container">
      <canvas ref={canvasRef} />
    </div>
  );
};
