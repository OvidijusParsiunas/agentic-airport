export interface Position {
  x: number;
  y: number;
}

export interface Plane {
  id: string;
  position: Position;
  heading: number; // degrees, 0 = right, 90 = down
  speed: number; // pixels per frame
  status: 'flying' | 'approaching' | 'landed' | 'crashed';
  callsign: string;
  color: string;
}

export interface Airport {
  position: Position;
  runwayStart: Position;
  runwayEnd: Position;
  runwayWidth: number;
  runwayHeading: number;
}

export interface GameState {
  planes: Plane[];
  airport: Airport;
  canvasWidth: number;
  canvasHeight: number;
  isPaused: boolean;
  collisions: number;
  landings: number;
  gameTime: number;
}

export interface AICommand {
  planeId: string;
  action: 'turn' | 'speed' | 'hold' | 'approach';
  value?: number;
}

export interface AIResponse {
  commands: AICommand[];
  reasoning?: string;
}

export interface ConversationMessage {
  role: 'user' | 'assistant';
  content: string;
}

export interface GameConfig {
  initialPlaneCount: number;
  aiUpdateInterval: number;
  spawnInterval: number;
  minPlanes: number;
  maxPlanes: number;
  gameSpeed: number;
}
