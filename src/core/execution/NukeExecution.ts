import {
  Execution,
  Game,
  MessageType,
  NukeLaunchers,
  Player,
  Structures,
  TerraNullius,
  TrajectoryTile,
  Unit,
  UnitType,
} from "../game/Game";
import { TileRef } from "../game/GameMap";
import { UniversalPathFinding } from "../pathfinding/PathFinder";
import { ParabolaUniversalPathFinder } from "../pathfinding/PathFinder.Parabola";
import { PathStatus } from "../pathfinding/types";
import { PseudoRandom } from "../PseudoRandom";
import { NukeType } from "../StatsSchemas";
import { listNukeBreakAlliance } from "./Util";

const SPRITE_RADIUS = 16;
const BOMBER_DROP_RANGE_SQUARED = 9;

export class NukeExecution implements Execution {
  private active = true;
  private mg: Game;
  private nuke: Unit | null = null;
  private launcher: Unit | null = null;
  private bomberMissionActive = false;
  private bomberMissionOrigin: TileRef | null = null;
  private tilesToDestroyCache: Set<TileRef> | undefined;
  private pathFinder: ParabolaUniversalPathFinder;

  constructor(
    private nukeType: NukeType,
    private player: Player,
    private dst: TileRef,
    private src?: TileRef | null,
    private speed: number = -1,
    private waitTicks = 0,
    private rocketDirectionUp: boolean = true,
  ) {}

  init(mg: Game, ticks: number): void {
    this.mg = mg;
    if (this.speed === -1) {
      this.speed = this.mg.config().defaultNukeSpeed();
    }
    this.pathFinder = UniversalPathFinding.Parabola(mg, {
      increment: this.speed,
      distanceBasedHeight: this.nukeType !== UnitType.MIRVWarhead,
      directionUp: this.rocketDirectionUp,
    });
  }

  public target(): Player | TerraNullius {
    return this.mg.owner(this.dst);
  }

  private tilesToDestroy(): Set<TileRef> {
    if (this.tilesToDestroyCache !== undefined) {
      return this.tilesToDestroyCache;
    }
    if (this.nuke === null) {
      throw new Error("Not initialized");
    }
    const magnitude = this.mg.config().nukeMagnitudes(this.nuke.type());
    const rand = new PseudoRandom(this.mg.ticks());
    const inner2 = magnitude.inner * magnitude.inner;
    const outer2 = magnitude.outer * magnitude.outer;
    this.tilesToDestroyCache = this.mg.bfs(this.dst, (_, n: TileRef) => {
      const d2 = this.mg?.euclideanDistSquared(this.dst, n) ?? 0;
      return d2 <= outer2 && (d2 <= inner2 || rand.chance(2));
    });
    return this.tilesToDestroyCache;
  }

  /**
   * Break alliances with players significantly affected by the nuke strike.
   * Uses weighted tile counting (inner=1, outer=0.5) OR if any allied structure would be destroyed.
   */
  private maybeBreakAlliances() {
    if (this.nuke === null) {
      throw new Error("Not initialized");
    }
    if (this.nuke.type() === UnitType.MIRVWarhead) {
      // MIRV warheads shouldn't break alliances
      return;
    }

    const magnitude = this.mg.config().nukeMagnitudes(this.nuke.type());

    const playersToBreakAllianceWith = listNukeBreakAlliance({
      game: this.mg,
      targetTile: this.dst,
      magnitude,
      allySmallIds: new Set(this.player.allies().map((a) => a.smallID())),
      threshold: this.mg.config().nukeAllianceBreakThreshold(),
    });

    // Automatically reject incoming alliance requests.
    for (const incoming of this.player.incomingAllianceRequests()) {
      if (playersToBreakAllianceWith.has(incoming.requestor().smallID())) {
        incoming.reject();
      }
    }

    for (const playerSmallId of playersToBreakAllianceWith) {
      const attackedPlayer = this.mg.playerBySmallID(playerSmallId);
      if (!attackedPlayer.isPlayer()) {
        continue;
      }

      // Resolves exploit of alliance breaking in which a pending alliance request
      // was accepted in the middle of a missile attack.
      const outgoingAllianceRequest = attackedPlayer
        .incomingAllianceRequests()
        .find((ar) => ar.requestor() === this.player);
      if (outgoingAllianceRequest) {
        outgoingAllianceRequest.reject();
        continue;
      }

      const alliance = this.player.allianceWith(attackedPlayer);
      if (alliance !== null) {
        this.player.breakAlliance(alliance);
      }
      if (attackedPlayer !== this.player) {
        attackedPlayer.updateRelation(this.player, -100);
      }
    }
  }

  tick(ticks: number): void {
    if (this.bomberMissionActive && this.nuke === null) {
      this.handleBomberMission();
      return;
    }

    if (this.nuke === null) {
      const spawn = this.player.canBuild(this.nukeType, this.dst);
      if (spawn === false) {
        console.warn(`cannot build Nuke`);
        this.active = false;
        return;
      }
      this.src = spawn;
      this.launcher = this.resolveLauncherAtSource(spawn);

      if (this.shouldUseBomberDelivery()) {
        this.startBomberMission();
        return;
      }
      this.launchNuke(spawn);
      this.markLauncherCooldown();
      return;
    }

    // make the nuke unactive if it was intercepted
    if (!this.nuke.isActive()) {
      console.log(`Nuke destroyed before reaching target`);
      this.active = false;
      return;
    }

    if (this.waitTicks > 0) {
      this.waitTicks--;
      return;
    }

    // Move to next tile
    const result = this.pathFinder.next(this.src!, this.dst, this.speed);
    if (result.status === PathStatus.COMPLETE) {
      this.detonate();
      return;
    } else if (result.status === PathStatus.NEXT) {
      this.updateNukeTargetable();
      this.nuke.move(result.node);
      // Update index so SAM can interpolate future position
      this.nuke.setTrajectoryIndex(this.pathFinder.currentIndex());
    }
  }

  public getNuke(): Unit | null {
    return this.nuke;
  }

  private resolveLauncherAtSource(source: TileRef): Unit | null {
    const candidates = this.player
      .units(...NukeLaunchers.types)
      .filter(
        (unit) =>
          unit.tile() === source &&
          !unit.isUnderConstruction() &&
          !unit.isInCooldown(),
      );

    if (candidates.length === 0) {
      return null;
    }

    if (
      this.nukeType === UnitType.AtomBomb ||
      this.nukeType === UnitType.HydrogenBomb
    ) {
      return (
        candidates.find((unit) => unit.type() === UnitType.Bomber) ??
        candidates.find((unit) => unit.type() === UnitType.NuclearSubmarine) ??
        candidates.find((unit) => unit.type() === UnitType.MissileSilo) ??
        candidates[0]
      );
    }

    return (
      candidates.find((unit) => unit.type() === UnitType.MissileSilo) ??
      candidates[0]
    );
  }

  private shouldUseBomberDelivery(): boolean {
    if (this.launcher === null) {
      return false;
    }
    if (this.launcher.type() !== UnitType.Bomber) {
      return false;
    }
    return (
      this.nukeType === UnitType.AtomBomb ||
      this.nukeType === UnitType.HydrogenBomb
    );
  }

  private startBomberMission() {
    if (this.launcher === null || this.src === null || this.src === undefined) {
      this.active = false;
      return;
    }
    this.bomberMissionActive = true;
    this.bomberMissionOrigin = this.src;
    // Bomber "takes off" toward target and payload is now committed.
    this.launcher.launch();
    this.launcher.setPatrolTile(this.dst);
    this.launcher.setTargetTile(this.dst);
  }

  private handleBomberMission() {
    if (this.launcher === null || this.launcher.type() !== UnitType.Bomber) {
      this.active = false;
      return;
    }
    if (!this.launcher.isActive() || this.launcher.owner() !== this.player) {
      this.active = false;
      return;
    }

    this.launcher.setPatrolTile(this.dst);
    if (this.launcher.targetTile() === undefined) {
      this.launcher.setTargetTile(this.dst);
    }

    if (
      this.mg.euclideanDistSquared(this.launcher.tile(), this.dst) >
      BOMBER_DROP_RANGE_SQUARED
    ) {
      return;
    }

    if (this.waitTicks > 0) {
      this.waitTicks--;
      return;
    }

    this.src = this.launcher.tile();
    this.launchNuke(this.src);
    if (this.nuke === null) {
      this.active = false;
      return;
    }

    if (this.bomberMissionOrigin !== null && this.launcher.isActive()) {
      // After dropping payload, send bomber back to base patrol.
      this.launcher.setPatrolTile(this.bomberMissionOrigin);
      this.launcher.setTargetTile(this.bomberMissionOrigin);
    }

    this.nuke.setReachedTarget();
    this.detonate();
  }

  private launchNuke(spawn: TileRef) {
    this.nuke = this.player.buildUnit(this.nukeType, spawn, {
      targetTile: this.dst,
      trajectory: this.getTrajectory(this.dst),
    });
    if (this.nuke.type() !== UnitType.MIRVWarhead) {
      this.maybeBreakAlliances();
    }
    this.displayNukeLaunchWarnings();
  }

  private displayNukeLaunchWarnings() {
    if (this.nuke === null) {
      return;
    }
    if (this.mg.hasOwner(this.dst)) {
      const target = this.mg.owner(this.dst);
      if (!target.isPlayer()) {
        // Ignore terra nullius
      } else if (this.nukeType === UnitType.AtomBomb) {
        this.mg.displayIncomingUnit(
          this.nuke.id(),
          // TODO TranslateText
          `${this.player.name()} - atom bomb inbound`,
          MessageType.NUKE_INBOUND,
          target.id(),
        );
      } else if (this.nukeType === UnitType.HydrogenBomb) {
        this.mg.displayIncomingUnit(
          this.nuke.id(),
          // TODO TranslateText
          `${this.player.name()} - hydrogen bomb inbound`,
          MessageType.HYDROGEN_BOMB_INBOUND,
          target.id(),
        );
      }

      // Record stats
      this.mg.stats().bombLaunch(this.player, target, this.nukeType);
    }
  }

  private markLauncherCooldown() {
    if (this.launcher !== null && this.launcher.isActive()) {
      this.launcher.launch();
      return;
    }

    if (this.src === undefined || this.src === null) {
      return;
    }
    const launcher = this.player
      .units(...NukeLaunchers.types)
      .find((unit) => unit.tile() === this.src);
    if (launcher) {
      launcher.launch();
    }
  }

  private getTrajectory(target: TileRef): TrajectoryTile[] {
    const trajectoryTiles: TrajectoryTile[] = [];
    const targetRangeSquared =
      this.mg.config().defaultNukeTargetableRange() ** 2;
    const allTiles = this.pathFinder.findPath(this.src!, target) ?? [];
    for (const tile of allTiles) {
      trajectoryTiles.push({
        tile,
        targetable: this.isTargetable(target, tile, targetRangeSquared),
      });
    }

    return trajectoryTiles;
  }

  private isTargetable(
    targetTile: TileRef,
    nukeTile: TileRef,
    targetRangeSquared: number,
  ): boolean {
    return (
      this.mg.euclideanDistSquared(nukeTile, targetTile) < targetRangeSquared ||
      (this.src !== undefined &&
        this.src !== null &&
        this.mg.euclideanDistSquared(this.src, nukeTile) < targetRangeSquared)
    );
  }

  private updateNukeTargetable() {
    if (this.nuke === null || this.nuke.targetTile() === undefined) {
      return;
    }
    const targetRangeSquared =
      this.mg.config().defaultNukeTargetableRange() ** 2;
    const targetTile = this.nuke.targetTile();
    this.nuke.setTargetable(
      this.isTargetable(targetTile!, this.nuke.tile(), targetRangeSquared),
    );
  }

  private detonate() {
    if (this.nuke === null) {
      throw new Error("Not initialized");
    }

    const mg = this.mg;
    const config = mg.config();

    const magnitude = config.nukeMagnitudes(this.nuke.type());
    const toDestroy = this.tilesToDestroy();

    // Retrieve all impacted players and the number of tiles
    const tilesPerPlayers = new Map<Player, number>();
    for (const tile of toDestroy) {
      const owner = mg.owner(tile);
      if (owner.isPlayer()) {
        owner.relinquish(tile);
        tilesPerPlayers.set(owner, (tilesPerPlayers.get(owner) ?? 0) + 1);
      }

      if (mg.isLand(tile)) {
        mg.setFallout(tile, true);
      }
    }

    // Then compute the explosion effect on each player
    for (const [player, numImpactedTiles] of tilesPerPlayers) {
      const tilesBeforeNuke = player.numTilesOwned() + numImpactedTiles;
      const transportShips = player.units(UnitType.TransportShip);
      const outgoingAttacks = player.outgoingAttacks();
      const maxTroops = config.maxTroops(player);
      // nukeDeathFactor could compute the complete fallout in a single call instead
      for (let i = 0; i < numImpactedTiles; i++) {
        // Diminishing effect as each affected tile has been nuked
        const numTilesLeft = tilesBeforeNuke - i;
        player.removeTroops(
          config.nukeDeathFactor(
            this.nukeType,
            player.troops(),
            numTilesLeft,
            maxTroops,
          ),
        );
        for (const attack of outgoingAttacks) {
          const attackTroops = attack.troops();
          const deaths = config.nukeDeathFactor(
            this.nukeType,
            attackTroops,
            numTilesLeft,
            maxTroops,
          );
          attack.setTroops(attackTroops - deaths);
        }
        for (const unit of transportShips) {
          const unitTroops = unit.troops();
          const deaths = config.nukeDeathFactor(
            this.nukeType,
            unitTroops,
            numTilesLeft,
            maxTroops,
          );
          unit.setTroops(unitTroops - deaths);
        }
      }
    }

    const outer2 = magnitude.outer * magnitude.outer;
    const dst = this.dst;
    const destroyer = this.player;
    for (const unit of mg.units()) {
      const type = unit.type();
      if (
        type === UnitType.AtomBomb ||
        type === UnitType.HydrogenBomb ||
        type === UnitType.MIRVWarhead ||
        type === UnitType.MIRV ||
        type === UnitType.SAMMissile
      ) {
        continue;
      }
      if (mg.euclideanDistSquared(dst, unit.tile()) < outer2) {
        unit.delete(true, destroyer);
      }
    }

    this.redrawBuildings(magnitude.outer + SPRITE_RADIUS);
    this.active = false;
    this.nuke.setReachedTarget();
    this.nuke.delete(false);

    // Record stats
    this.mg
      .stats()
      .bombLand(this.player, this.target(), this.nuke.type() as NukeType);
  }

  private redrawBuildings(range: number) {
    const rangeSquared = range * range;
    for (const unit of this.mg.units()) {
      if (Structures.has(unit.type())) {
        if (
          this.mg.euclideanDistSquared(this.dst, unit.tile()) < rangeSquared
        ) {
          unit.touch();
        }
      }
    }
  }

  owner(): Player {
    return this.player;
  }

  isActive(): boolean {
    return this.active;
  }

  activeDuringSpawnPhase(): boolean {
    return false;
  }
}
