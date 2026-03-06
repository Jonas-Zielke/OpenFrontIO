import {
  BuildableUnit,
  Cell,
  PlayerActions,
  PlayerBorderTiles,
  PlayerBuildableUnitType,
  PlayerID,
  PlayerProfile,
} from "../game/Game";
import { TileRef } from "../game/GameMap";
import { ErrorUpdate, GameUpdateViewData } from "../game/GameUpdates";
import { ClientID, GameStartInfo, Turn } from "../Schemas";
import { generateID } from "../Util";
import { WorkerMessage } from "./WorkerMessages";

export class WorkerClient {
  private worker: Worker;
  private isInitialized = false;
  private messageHandlers: Map<string, (message: WorkerMessage) => void>;
  private readonly workerMessageHandler: (
    event: MessageEvent<WorkerMessage>,
  ) => void;
  private readonly initTimeoutMs = 45_000;
  private readonly maxInitAttempts = 2;
  private gameUpdateCallback?: (
    update: GameUpdateViewData | ErrorUpdate,
  ) => void;

  constructor(
    private gameStartInfo: GameStartInfo,
    private clientID: ClientID,
  ) {
    this.messageHandlers = new Map();
    this.workerMessageHandler = this.handleWorkerMessage.bind(this);
    this.worker = this.createWorker();
  }

  private createWorker(): Worker {
    const worker = new Worker(new URL("./Worker.worker.ts", import.meta.url), {
      type: "module",
    });
    worker.addEventListener("message", this.workerMessageHandler);
    return worker;
  }

  private resetWorker(): void {
    this.worker.terminate();
    this.worker = this.createWorker();
    this.messageHandlers.clear();
    this.isInitialized = false;
  }

  private handleWorkerMessage(event: MessageEvent<WorkerMessage>) {
    const message = event.data;

    switch (message.type) {
      case "game_update":
        if (this.gameUpdateCallback && message.gameUpdate) {
          this.gameUpdateCallback(message.gameUpdate);
        }
        break;
      case "game_update_batch":
        if (this.gameUpdateCallback && message.gameUpdates) {
          for (const gu of message.gameUpdates) {
            this.gameUpdateCallback(gu);
          }
        }
        break;

      case "initialized":
      case "init_failed":
      default:
        if (message.id && this.messageHandlers.has(message.id)) {
          const handler = this.messageHandlers.get(message.id)!;
          handler(message);
          this.messageHandlers.delete(message.id);
        }
        break;
    }
  }

  async initialize(): Promise<void> {
    let lastError: Error | null = null;
    for (let attempt = 1; attempt <= this.maxInitAttempts; attempt++) {
      try {
        await this.initializeOnce();
        return;
      } catch (error) {
        lastError =
          error instanceof Error ? error : new Error(String(error));
        if (attempt >= this.maxInitAttempts) {
          throw lastError;
        }
        console.warn(
          `Worker init attempt ${attempt} failed: ${lastError.message}. Retrying...`,
        );
        this.resetWorker();
      }
    }
    throw lastError ?? new Error("Worker initialization failed");
  }

  private initializeOnce(): Promise<void> {
    return new Promise((resolve, reject) => {
      const messageId = generateID();
      let timeoutId: ReturnType<typeof setTimeout> | undefined;
      let isSettled = false;
      const complete = (fn: () => void) => {
        if (isSettled) {
          return;
        }
        isSettled = true;
        this.messageHandlers.delete(messageId);
        if (timeoutId !== undefined) {
          clearTimeout(timeoutId);
        }
        fn();
      };

      this.messageHandlers.set(messageId, (message) => {
        if (message.type === "initialized") {
          this.isInitialized = true;
          complete(() => resolve());
          return;
        }
        if (message.type === "init_failed") {
          const error = new Error(message.error);
          if (message.stack) {
            error.stack = message.stack;
          }
          complete(() => reject(error));
        }
      });

      this.worker.postMessage({
        type: "init",
        id: messageId,
        gameStartInfo: this.gameStartInfo,
        clientID: this.clientID,
      });

      timeoutId = setTimeout(() => {
        if (!this.isInitialized) {
          complete(() =>
            reject(
              new Error(
                `Worker initialization timeout after ${this.initTimeoutMs}ms`,
              ),
            ),
          );
        }
      }, this.initTimeoutMs);
    });
  }

  start(gameUpdate: (gu: GameUpdateViewData | ErrorUpdate) => void) {
    if (!this.isInitialized) {
      throw new Error("Failed to initialize pathfinder");
    }
    this.gameUpdateCallback = gameUpdate;
  }

  sendTurn(turn: Turn) {
    if (!this.isInitialized) {
      throw new Error("Worker not initialized");
    }

    this.worker.postMessage({
      type: "turn",
      turn,
    });
  }

  playerProfile(playerID: number): Promise<PlayerProfile> {
    return new Promise((resolve, reject) => {
      if (!this.isInitialized) {
        reject(new Error("Worker not initialized"));
        return;
      }

      const messageId = generateID();

      this.messageHandlers.set(messageId, (message) => {
        if (
          message.type === "player_profile_result" &&
          message.result !== undefined
        ) {
          resolve(message.result);
        }
      });

      this.worker.postMessage({
        type: "player_profile",
        id: messageId,
        playerID: playerID,
      });
    });
  }

  playerBorderTiles(playerID: PlayerID): Promise<PlayerBorderTiles> {
    return new Promise((resolve, reject) => {
      if (!this.isInitialized) {
        reject(new Error("Worker not initialized"));
        return;
      }

      const messageId = generateID();

      this.messageHandlers.set(messageId, (message) => {
        if (
          message.type === "player_border_tiles_result" &&
          message.result !== undefined
        ) {
          resolve(message.result);
        }
      });

      this.worker.postMessage({
        type: "player_border_tiles",
        id: messageId,
        playerID: playerID,
      });
    });
  }

  playerInteraction(
    playerID: PlayerID,
    x?: number,
    y?: number,
    units?: readonly PlayerBuildableUnitType[] | null,
  ): Promise<PlayerActions> {
    return new Promise((resolve, reject) => {
      if (!this.isInitialized) {
        reject(new Error("Worker not initialized"));
        return;
      }

      const messageId = generateID();

      this.messageHandlers.set(messageId, (message) => {
        if (
          message.type === "player_actions_result" &&
          message.result !== undefined
        ) {
          resolve(message.result);
        }
      });

      this.worker.postMessage({
        type: "player_actions",
        id: messageId,
        playerID,
        x,
        y,
        units,
      });
    });
  }

  playerBuildables(
    playerID: PlayerID,
    x?: number,
    y?: number,
    units?: readonly PlayerBuildableUnitType[],
  ): Promise<BuildableUnit[]> {
    return new Promise((resolve, reject) => {
      if (!this.isInitialized) {
        reject(new Error("Worker not initialized"));
        return;
      }

      const messageId = generateID();

      this.messageHandlers.set(messageId, (message) => {
        if (
          message.type === "player_buildables_result" &&
          message.result !== undefined
        ) {
          resolve(message.result);
        }
      });

      this.worker.postMessage({
        type: "player_buildables",
        id: messageId,
        playerID,
        x,
        y,
        units,
      });
    });
  }

  attackAveragePosition(
    playerID: number,
    attackID: string,
  ): Promise<Cell | null> {
    return new Promise((resolve, reject) => {
      if (!this.isInitialized) {
        reject(new Error("Worker not initialized"));
        return;
      }

      const messageId = generateID();

      this.messageHandlers.set(messageId, (message) => {
        if (
          message.type === "attack_average_position_result" &&
          message.x !== undefined &&
          message.y !== undefined
        ) {
          if (message.x === null || message.y === null) {
            resolve(null);
          } else {
            resolve(new Cell(message.x, message.y));
          }
        }
      });

      this.worker.postMessage({
        type: "attack_average_position",
        id: messageId,
        playerID: playerID,
        attackID: attackID,
      });
    });
  }

  transportShipSpawn(
    playerID: PlayerID,
    targetTile: TileRef,
  ): Promise<TileRef | false> {
    return new Promise((resolve, reject) => {
      if (!this.isInitialized) {
        reject(new Error("Worker not initialized"));
        return;
      }

      const messageId = generateID();

      this.messageHandlers.set(messageId, (message) => {
        if (
          message.type === "transport_ship_spawn_result" &&
          message.result !== undefined
        ) {
          resolve(message.result);
        }
      });

      this.worker.postMessage({
        type: "transport_ship_spawn",
        id: messageId,
        playerID: playerID,
        targetTile: targetTile,
      });
    });
  }

  cleanup() {
    this.worker.terminate();
    this.messageHandlers.clear();
    this.isInitialized = false;
    this.gameUpdateCallback = undefined;
  }
}
