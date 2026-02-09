export interface Position {
  x: number;
  y: number;
}

export interface Plane {
  id: string;
  position: Position;
  heading: number; // degrees, 0 = right, 90 = down, etc.
  speed: number; // pixels per frame
  status: 'flying' | 'approaching' | 'landing' | 'landed' | 'crashed';
  callsign: string;
  color: string;
}

export interface Airport {
  position: Position;
  runwayStart: Position;
  runwayEnd: Position;
  runwayWidth: number;
  runwayHeading: number; // The heading planes need to have to land
}

export interface GameState {
  planes: Plane[];
  airport: Airport;
  canvasWidth: number;
  canvasHeight: number;
  isPaused: boolean;
  collisions: number;
  landings: number;
  gameTime: number; // seconds
}

export interface AICommand {
  planeId: string;
  action: 'turn' | 'speed' | 'hold' | 'approach';
  value?: number; // for turn: new heading, for speed: new speed
}

export interface AIResponse {
  commands: AICommand[];
  reasoning?: string;
}

export interface GameConfig {
  initialPlaneCount: number;
  aiUpdateInterval: number; // milliseconds
  spawnInterval: number; // milliseconds
  minPlanes: number; // Minimum active planes (new ones spawn immediately when below)
  maxPlanes: number; // Maximum active planes
  gameSpeed: number; // Multiplier for plane movement (1.0 = normal, 0.5 = half speed)
}
