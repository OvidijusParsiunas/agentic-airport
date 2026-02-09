import { movePosition, checkCollision, isOnRunway, angleDifference, normalizeAngle } from '../utils/geometry';
import { GameState, Plane, Airport, AICommand, GameConfig } from '../types/game';
import { createPlane, resetPlaneCounter } from '../utils/planeFactory';
import { useState, useCallback, useRef, useEffect } from 'react';
import { getAICommands } from '../services/openai';

const DEFAULT_CONFIG: GameConfig = {
  initialPlaneCount: 3,
  aiUpdateInterval: 5000, // 5 seconds
  spawnInterval: 15000, // 15 seconds
  maxPlanes: 5,
};

function createInitialAirport(canvasWidth: number, canvasHeight: number): Airport {
  const centerX = canvasWidth / 2;
  const centerY = canvasHeight / 2;
  const runwayLength = 200;

  return {
    position: { x: centerX, y: centerY },
    runwayStart: { x: centerX - runwayLength / 2, y: centerY },
    runwayEnd: { x: centerX + runwayLength / 2, y: centerY },
    runwayWidth: 40,
    runwayHeading: 0, // Planes should approach heading ~0 (from left to right) or ~180 (from right to left)
  };
}

export function useGame(canvasWidth: number, canvasHeight: number, apiKey: string) {
  const [gameState, setGameState] = useState<GameState>(() => ({
    planes: [],
    airport: createInitialAirport(canvasWidth, canvasHeight),
    canvasWidth,
    canvasHeight,
    isPaused: true,
    collisions: 0,
    landings: 0,
    gameTime: 0,
  }));

  const [aiLog, setAiLog] = useState<Array<{ time: string; message: string }>>([]);
  const [isAiProcessing, setIsAiProcessing] = useState(false);
  const lastAiCallRef = useRef<number>(0);
  const lastSpawnRef = useRef<number>(0);
  const configRef = useRef<GameConfig>(DEFAULT_CONFIG);

  // Initialize game
  const initGame = useCallback(() => {
    resetPlaneCounter();
    const airport = createInitialAirport(canvasWidth, canvasHeight);
    const planes: Plane[] = [];

    for (let i = 0; i < configRef.current.initialPlaneCount; i++) {
      planes.push(createPlane(canvasWidth, canvasHeight));
    }

    setGameState({
      planes,
      airport,
      canvasWidth,
      canvasHeight,
      isPaused: true,
      collisions: 0,
      landings: 0,
      gameTime: 0,
    });
    setAiLog([]);
    lastAiCallRef.current = 0;
    lastSpawnRef.current = 0;
  }, [canvasWidth, canvasHeight]);

  // Update airport when canvas size changes
  useEffect(() => {
    setGameState(prev => ({
      ...prev,
      airport: createInitialAirport(canvasWidth, canvasHeight),
      canvasWidth,
      canvasHeight,
    }));
  }, [canvasWidth, canvasHeight]);

  // Apply AI command to a plane
  const applyCommand = useCallback((plane: Plane, command: AICommand): Plane => {
    const updated = { ...plane };

    switch (command.action) {
      case 'turn':
        if (command.value !== undefined) {
          updated.heading = normalizeAngle(command.value);
        }
        break;
      case 'speed':
        if (command.value !== undefined) {
          updated.speed = Math.max(0.15, Math.min(0.8, command.value));
        }
        break;
      case 'approach':
        updated.status = 'approaching';
        updated.speed = Math.min(updated.speed, 0.4);
        break;
      case 'hold':
        // Plane will circle - slightly adjust heading
        updated.heading = normalizeAngle(updated.heading + 2);
        updated.speed = Math.max(0.3, updated.speed * 0.95);
        break;
    }

    return updated;
  }, []);

  // Check if plane can land
  const checkLanding = useCallback((plane: Plane, airport: Airport): Plane => {
    if (plane.status === 'landed' || plane.status === 'crashed') {
      return plane;
    }

    const onRunway = isOnRunway(
      plane.position,
      airport.runwayStart,
      airport.runwayEnd,
      airport.runwayWidth
    );

    if (onRunway && plane.status === 'approaching') {
      // Check if heading is aligned with runway
      const headingDiff = Math.abs(angleDifference(plane.heading, airport.runwayHeading));
      const reverseHeadingDiff = Math.abs(angleDifference(plane.heading, airport.runwayHeading + 180));

      if ((headingDiff < 25 || reverseHeadingDiff < 25) && plane.speed < 2) {
        return { ...plane, status: 'landed', speed: 0 };
      }
    }

    return plane;
  }, []);

  // Main game update
  const updateGame = useCallback((deltaTime: number) => {
    setGameState(prev => {
      if (prev.isPaused) return prev;

      const dt = deltaTime / 16.67; // Normalize to ~60fps
      let newPlanes = [...prev.planes];
      let newCollisions = prev.collisions;
      let newLandings = prev.landings;

      // Update plane positions
      newPlanes = newPlanes.map(plane => {
        if (plane.status === 'landed' || plane.status === 'crashed') {
          return plane;
        }

        // Move plane
        const newPosition = movePosition(plane.position, plane.heading, plane.speed * dt);

        // Keep in bounds (wrap around)
        if (newPosition.x < -50) newPosition.x = prev.canvasWidth + 50;
        if (newPosition.x > prev.canvasWidth + 50) newPosition.x = -50;
        if (newPosition.y < -50) newPosition.y = prev.canvasHeight + 50;
        if (newPosition.y > prev.canvasHeight + 50) newPosition.y = -50;

        return { ...plane, position: newPosition };
      });

      // Check for collisions
      for (let i = 0; i < newPlanes.length; i++) {
        for (let j = i + 1; j < newPlanes.length; j++) {
          if (checkCollision(newPlanes[i], newPlanes[j])) {
            if (newPlanes[i].status !== 'crashed' && newPlanes[j].status !== 'crashed') {
              newPlanes[i] = { ...newPlanes[i], status: 'crashed' };
              newPlanes[j] = { ...newPlanes[j], status: 'crashed' };
              newCollisions++;
            }
          }
        }
      }

      // Check for landings
      const previousLandedCount = newPlanes.filter(p => p.status === 'landed').length;
      newPlanes = newPlanes.map(plane => checkLanding(plane, prev.airport));
      const newLandedCount = newPlanes.filter(p => p.status === 'landed').length;
      newLandings += newLandedCount - previousLandedCount;

      return {
        ...prev,
        planes: newPlanes,
        collisions: newCollisions,
        landings: newLandings,
        gameTime: prev.gameTime + deltaTime / 1000,
      };
    });
  }, [checkLanding]);

  // AI control loop
  const callAI = useCallback(async () => {
    if (!apiKey || isAiProcessing) return;

    setIsAiProcessing(true);
    const timestamp = new Date().toLocaleTimeString();

    try {
      const response = await getAICommands(
        apiKey,
        gameState.planes,
        gameState.airport,
        canvasWidth,
        canvasHeight
      );

      setAiLog(prev => [
        { time: timestamp, message: response.reasoning || 'Commands issued.' },
        ...prev.slice(0, 9), // Keep last 10 entries
      ]);

      // Apply commands
      if (response.commands.length > 0) {
        setGameState(prev => {
          const updatedPlanes = prev.planes.map(plane => {
            const command = response.commands.find(c => c.planeId === plane.id);
            if (command) {
              return applyCommand(plane, command);
            }
            return plane;
          });
          return { ...prev, planes: updatedPlanes };
        });
      }
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      setAiLog(prev => [
        { time: timestamp, message: `Error: ${errorMessage}` },
        ...prev.slice(0, 9),
      ]);
    } finally {
      setIsAiProcessing(false);
    }
  }, [apiKey, gameState.planes, gameState.airport, canvasWidth, canvasHeight, applyCommand, isAiProcessing]);

  // Periodic AI calls and plane spawning
  useEffect(() => {
    if (gameState.isPaused) return;

    const now = Date.now();

    // AI call every 10 seconds
    if (now - lastAiCallRef.current >= configRef.current.aiUpdateInterval) {
      lastAiCallRef.current = now;
      callAI();
    }

    // Spawn new planes periodically
    if (now - lastSpawnRef.current >= configRef.current.spawnInterval) {
      const activeCount = gameState.planes.filter(
        p => p.status !== 'landed' && p.status !== 'crashed'
      ).length;

      if (activeCount < configRef.current.maxPlanes) {
        lastSpawnRef.current = now;
        setGameState(prev => ({
          ...prev,
          planes: [
            ...prev.planes,
            createPlane(canvasWidth, canvasHeight),
          ],
        }));
      }
    }
  }, [gameState.isPaused, gameState.planes, canvasWidth, canvasHeight, callAI]);

  // Toggle pause
  const togglePause = useCallback(() => {
    setGameState(prev => ({ ...prev, isPaused: !prev.isPaused }));
    if (gameState.isPaused) {
      lastAiCallRef.current = Date.now();
      lastSpawnRef.current = Date.now();
    }
  }, [gameState.isPaused]);

  // Force AI call
  const forceAiCall = useCallback(() => {
    callAI();
  }, [callAI]);

  return {
    gameState,
    aiLog,
    isAiProcessing,
    initGame,
    updateGame,
    togglePause,
    forceAiCall,
  };
}
