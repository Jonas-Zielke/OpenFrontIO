import { html, LitElement } from "lit";
import { customElement, state } from "lit/decorators.js";
import { EventBus } from "../../../core/EventBus";
import { BuildableUnit, UnitType } from "../../../core/game/Game";
import { TileRef } from "../../../core/game/GameMap";
import { GameView, UnitView } from "../../../core/game/GameView";
import { CloseViewEvent, ContextMenuEvent } from "../../InputHandler";
import { BuildUnitIntentEvent, MoveWarshipIntentEvent } from "../../Transport";
import { renderNumber } from "../../Utils";
import { TransformHandler } from "../TransformHandler";
import { Layer } from "./Layer";

type RallyDirection = "north" | "south" | "west" | "east" | "center" | "home";

@customElement("military-airport-manager")
export class MilitaryAirportManager extends LitElement implements Layer {
  public game!: GameView;
  public eventBus!: EventBus;
  public transformHandler!: TransformHandler;

  @state() private open = false;
  @state() private selectedAirportId: number | null = null;
  @state() private buildables: Partial<Record<UnitType, BuildableUnit>> = {};

  private readonly BUILDABLE_REFRESH_MS = 300;
  private readonly ASSIGNED_RADIUS = 120;
  private nextBuildableRefreshAt = 0;
  private refreshingBuildables = false;

  createRenderRoot() {
    return this;
  }

  init(): void {
    this.eventBus.on(ContextMenuEvent, (event) => {
      this.handleContextMenu(event);
    });
    this.eventBus.on(CloseViewEvent, () => this.close());
  }

  tick(): void {
    const myPlayer = this.game.myPlayer();
    if (!myPlayer || !myPlayer.isAlive()) {
      this.close();
      return;
    }

    const airport = this.selectedAirport();
    if (!airport) {
      if (this.open) {
        this.close();
      }
      return;
    }

    if (this.open) {
      const now = performance.now();
      if (!this.refreshingBuildables && now >= this.nextBuildableRefreshAt) {
        this.refreshBuildables(airport.tile());
      }
    }
  }

  renderLayer(): void {}

  shouldTransform(): boolean {
    return false;
  }

  private handleContextMenu(event: ContextMenuEvent) {
    const worldCoords = this.transformHandler.screenToWorldCoordinates(
      event.x,
      event.y,
    );
    if (!this.game.isValidCoord(worldCoords.x, worldCoords.y)) {
      this.close();
      return;
    }

    const myPlayer = this.game.myPlayer();
    if (!myPlayer) {
      this.close();
      return;
    }

    const tile = this.game.ref(worldCoords.x, worldCoords.y);
    const airport = myPlayer
      .units(UnitType.MilitaryAirport)
      .find((unit) => unit.isActive() && unit.tile() === tile);

    if (!airport) {
      this.close();
      return;
    }

    this.selectedAirportId = airport.id();
    this.open = true;
    this.refreshBuildables(airport.tile());
  }

  private selectedAirport(): UnitView | null {
    if (this.selectedAirportId === null) {
      return null;
    }
    const airport = this.game.unit(this.selectedAirportId);
    const myPlayer = this.game.myPlayer();
    if (
      !airport ||
      !airport.isActive() ||
      airport.type() !== UnitType.MilitaryAirport ||
      !myPlayer ||
      airport.owner() !== myPlayer
    ) {
      return null;
    }
    return airport;
  }

  private refreshBuildables(tile: TileRef) {
    const myPlayer = this.game.myPlayer();
    if (!myPlayer) {
      return;
    }
    this.refreshingBuildables = true;
    this.nextBuildableRefreshAt = performance.now() + this.BUILDABLE_REFRESH_MS;
    myPlayer
      .buildables(tile, [UnitType.Interceptor, UnitType.MultiFighter, UnitType.Bomber])
      .then((buildables) => {
        const byType: Partial<Record<UnitType, BuildableUnit>> = {};
        for (const buildable of buildables) {
          byType[buildable.type] = buildable;
        }
        this.buildables = byType;
      })
      .finally(() => {
        this.refreshingBuildables = false;
      });
  }

  private close() {
    this.open = false;
    this.selectedAirportId = null;
    this.buildables = {};
  }

  private canBuild(type: UnitType): boolean {
    return this.buildables[type]?.canBuild !== false;
  }

  private cost(type: UnitType): bigint {
    return this.buildables[type]?.cost ?? 0n;
  }

  private build(type: UnitType) {
    const airport = this.selectedAirport();
    if (!airport || !this.canBuild(type)) {
      return;
    }
    this.eventBus.emit(new BuildUnitIntentEvent(type, airport.tile()));
    this.nextBuildableRefreshAt = 0;
  }

  private assignedAircraft(airportTile: TileRef): UnitView[] {
    const myPlayer = this.game.myPlayer();
    if (!myPlayer) {
      return [];
    }
    const rangeSquared = this.ASSIGNED_RADIUS * this.ASSIGNED_RADIUS;
    return myPlayer
      .units(UnitType.Interceptor, UnitType.MultiFighter, UnitType.Bomber)
      .filter((unit) => {
        if (!unit.isActive() || unit.isUnderConstruction()) {
          return false;
        }
        if (unit.patrolTile() === airportTile) {
          return true;
        }
        return (
          this.game.euclideanDistSquared(unit.tile(), airportTile) <= rangeSquared
        );
      });
  }

  private rally(direction: RallyDirection) {
    const airport = this.selectedAirport();
    if (!airport) {
      return;
    }

    const targetTile = this.rallyTarget(direction, airport.tile());
    const units = this.assignedAircraft(airport.tile());
    for (const unit of units) {
      this.eventBus.emit(new MoveWarshipIntentEvent(unit.id(), targetTile));
    }
  }

  private rallyTarget(direction: RallyDirection, homeTile: TileRef): TileRef {
    if (direction === "home") {
      return homeTile;
    }
    const mapWidth = this.game.width() - 1;
    const mapHeight = this.game.height() - 1;
    const homeX = this.game.x(homeTile);
    const homeY = this.game.y(homeTile);

    let x = homeX;
    let y = homeY;

    switch (direction) {
      case "north":
        y = Math.floor(mapHeight * 0.12);
        break;
      case "south":
        y = Math.floor(mapHeight * 0.88);
        break;
      case "west":
        x = Math.floor(mapWidth * 0.12);
        break;
      case "east":
        x = Math.floor(mapWidth * 0.88);
        break;
      case "center":
        x = Math.floor(mapWidth * 0.5);
        y = Math.floor(mapHeight * 0.5);
        break;
    }

    const clampedX = Math.max(0, Math.min(mapWidth, x));
    const clampedY = Math.max(0, Math.min(mapHeight, y));
    return this.game.ref(clampedX, clampedY);
  }

  private fleetCount(units: UnitView[], type: UnitType): number {
    return units.filter((unit) => unit.type() === type).length;
  }

  private renderBuildButton(label: string, type: UnitType) {
    const canBuild = this.canBuild(type);
    return html`
      <button
        class="rounded-md border px-3 py-2 text-left transition ${
          canBuild
            ? "border-slate-500 bg-slate-800 hover:bg-slate-700"
            : "border-slate-700 bg-slate-900 opacity-40 cursor-not-allowed"
        }"
        ?disabled=${!canBuild}
        @click=${() => this.build(type)}
      >
        <div class="font-semibold text-sm">${label}</div>
        <div class="text-xs text-amber-300">${renderNumber(this.cost(type))}</div>
      </button>
    `;
  }

  private renderRallyButton(label: string, direction: RallyDirection) {
    return html`
      <button
        class="rounded-md border border-slate-500 bg-slate-800 hover:bg-slate-700 px-2 py-1 text-xs"
        @click=${() => this.rally(direction)}
      >
        ${label}
      </button>
    `;
  }

  render() {
    if (!this.open) {
      return null;
    }

    const airport = this.selectedAirport();
    if (!airport) {
      return null;
    }

    const airportTile = airport.tile();
    const assignedAircraft = this.assignedAircraft(airportTile);
    const interceptors = this.fleetCount(assignedAircraft, UnitType.Interceptor);
    const multiFighters = this.fleetCount(assignedAircraft, UnitType.MultiFighter);
    const bombers = this.fleetCount(assignedAircraft, UnitType.Bomber);

    return html`
      <div
        class="fixed bottom-24 left-1/2 -translate-x-1/2 z-[1320] w-[96vw] max-w-3xl rounded-lg border border-slate-600 bg-slate-900/95 backdrop-blur-sm text-white p-3"
      >
        <div class="flex items-center justify-between mb-3">
          <div>
            <h3 class="font-semibold">Military Airport Fleet Manager</h3>
            <p class="text-xs text-slate-300">
              Base at (${this.game.x(airportTile)}, ${this.game.y(airportTile)})
            </p>
          </div>
          <button
            class="rounded-md border border-slate-500 px-2 py-1 text-xs hover:bg-slate-700"
            @click=${() => this.close()}
          >
            Close
          </button>
        </div>

        <div class="grid sm:grid-cols-3 gap-2 mb-3">
          ${this.renderBuildButton("Interceptor", UnitType.Interceptor)}
          ${this.renderBuildButton("Multi Fighter", UnitType.MultiFighter)}
          ${this.renderBuildButton("Bomber", UnitType.Bomber)}
        </div>

        <div class="text-xs text-slate-300 mb-2">
          Assigned fleet: ${interceptors} interceptors, ${multiFighters} multi
          fighters, ${bombers} bombers
        </div>

        <div class="flex flex-wrap gap-2">
          ${this.renderRallyButton("North", "north")}
          ${this.renderRallyButton("South", "south")}
          ${this.renderRallyButton("West", "west")}
          ${this.renderRallyButton("East", "east")}
          ${this.renderRallyButton("Center", "center")}
          ${this.renderRallyButton("Return", "home")}
        </div>
      </div>
    `;
  }
}
