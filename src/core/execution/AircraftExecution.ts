import {
  Execution,
  Game,
  isUnit,
  OwnerComp,
  Unit,
  UnitType,
} from "../game/Game";
import { TileRef } from "../game/GameMap";
import { PathFinding } from "../pathfinding/PathFinder";
import { PathStatus, SteppingPathFinder } from "../pathfinding/types";
import { PseudoRandom } from "../PseudoRandom";

type AircraftType =
  | UnitType.Interceptor
  | UnitType.MultiFighter
  | UnitType.Bomber;

type AircraftSpawnInput = OwnerComp & {
  patrolTile: TileRef;
  aircraftType: AircraftType;
};

const AIR_TARGETS = [
  UnitType.CargoPlane,
  UnitType.Interceptor,
  UnitType.MultiFighter,
  UnitType.Bomber,
] as const;

const AIRCRAFT_TYPES = new Set<UnitType>([
  UnitType.Interceptor,
  UnitType.MultiFighter,
  UnitType.Bomber,
]);

export class AircraftExecution implements Execution {
  private random!: PseudoRandom;
  private aircraft!: Unit;
  private mg!: Game;
  private pathfinder!: SteppingPathFinder<TileRef>;
  private active = true;
  private lastAttackTick = 0;

  constructor(private input: AircraftSpawnInput | Unit) {}

  init(mg: Game): void {
    this.mg = mg;
    this.pathfinder = PathFinding.Air(mg);
    this.random = new PseudoRandom(mg.ticks());

    if (isUnit(this.input)) {
      if (!AIRCRAFT_TYPES.has(this.input.type())) {
        throw new Error(`invalid patrol aircraft type: ${this.input.type()}`);
      }
      this.aircraft = this.input;
      return;
    }

    const spawn = this.input.owner.canBuild(
      this.input.aircraftType,
      this.input.patrolTile,
    );
    if (spawn === false) {
      this.active = false;
      return;
    }
    this.aircraft = this.input.owner.buildUnit(this.input.aircraftType, spawn, {
      patrolTile: this.input.patrolTile,
    });
  }

  tick(): void {
    if (!this.active || !this.aircraft || !this.aircraft.isActive()) {
      this.active = false;
      return;
    }

    if (this.aircraft.health() <= 0) {
      this.aircraft.delete();
      this.active = false;
      return;
    }

    this.reloadBomberPayloadIfNeeded();

    const target = this.findTargetAircraft();
    this.aircraft.setTargetUnit(target);

    if (target !== undefined) {
      this.huntTarget(target);
      this.attackTarget();
      return;
    }

    this.patrol();
  }

  private reloadBomberPayloadIfNeeded() {
    if (this.aircraft.type() !== UnitType.Bomber) {
      return;
    }
    const frontTime = this.aircraft.missileTimerQueue()[0];
    if (frontTime === undefined) {
      return;
    }
    const cooldown = this.mg.config().SiloCooldown() - (this.mg.ticks() - frontTime);
    if (cooldown <= 0) {
      this.aircraft.reloadMissile();
    }
  }

  private findTargetAircraft(): Unit | undefined {
    if (this.aircraft.type() === UnitType.Bomber) {
      return undefined;
    }

    const owner = this.aircraft.owner();
    const searchRange = this.aircraft.type() === UnitType.Interceptor ? 120 : 90;
    const nearby = this.mg.nearbyUnits(
      this.aircraft.tile(),
      searchRange,
      AIR_TARGETS,
    );

    let best: { unit: Unit; distSquared: number } | undefined;
    for (const candidate of nearby) {
      const unit = candidate.unit;
      if (!unit.isActive() || unit === this.aircraft || unit.owner() === owner) {
        continue;
      }
      if (owner.isFriendly(unit.owner(), true)) {
        continue;
      }
      if (!owner.shouldInterceptAircraftFrom(unit.owner(), unit.tile())) {
        continue;
      }
      if (best === undefined || candidate.distSquared < best.distSquared) {
        best = candidate;
      }
    }

    return best?.unit;
  }

  private attackTarget() {
    const target = this.aircraft.targetUnit();
    if (!target || !target.isActive()) {
      return;
    }

    const attackCooldown = this.aircraft.type() === UnitType.Interceptor ? 20 : 25;
    if (this.mg.ticks() - this.lastAttackTick <= attackCooldown) {
      return;
    }
    if (this.mg.euclideanDistSquared(this.aircraft.tile(), target.tile()) > 16) {
      return;
    }

    this.lastAttackTick = this.mg.ticks();
    const damage = this.aircraft.type() === UnitType.Interceptor ? 250 : 180;
    target.modifyHealth(-damage, this.aircraft.owner());
    if (!target.isActive()) {
      this.aircraft.setTargetUnit(undefined);
    }
  }

  private huntTarget(target: Unit) {
    const speed = this.aircraft.type() === UnitType.Interceptor ? 3 : 2;
    const result = this.pathfinder.next(this.aircraft.tile(), target.tile(), speed);
    switch (result.status) {
      case PathStatus.NEXT:
      case PathStatus.COMPLETE:
        this.aircraft.move(result.node);
        break;
      case PathStatus.NOT_FOUND:
        this.aircraft.setTargetUnit(undefined);
        break;
    }
  }

  private patrol() {
    if (this.aircraft.targetTile() === undefined) {
      const tile = this.randomTile();
      if (tile === undefined) {
        return;
      }
      this.aircraft.setTargetTile(tile);
    }

    const result = this.pathfinder.next(
      this.aircraft.tile(),
      this.aircraft.targetTile()!,
      this.aircraft.type() === UnitType.Interceptor ? 2 : 1,
    );
    switch (result.status) {
      case PathStatus.COMPLETE:
        this.aircraft.setTargetTile(undefined);
        this.aircraft.move(result.node);
        break;
      case PathStatus.NEXT:
        this.aircraft.move(result.node);
        break;
      case PathStatus.NOT_FOUND:
        this.aircraft.setTargetTile(undefined);
        break;
    }
  }

  private randomTile(): TileRef | undefined {
    const center = this.aircraft.patrolTile() ?? this.aircraft.tile();
    const mapDiagonal = Math.hypot(this.mg.width(), this.mg.height());
    const baseRange =
      this.aircraft.type() === UnitType.Bomber
        ? Math.floor((mapDiagonal * 3) / 4)
        : this.aircraft.type() === UnitType.Interceptor
          ? Math.floor(mapDiagonal / 2)
          : Math.floor(mapDiagonal / 3);

    for (let i = 0; i < 1000; i++) {
      const x =
        this.mg.x(center) + this.random.nextInt(-baseRange / 2, baseRange / 2);
      const y =
        this.mg.y(center) + this.random.nextInt(-baseRange / 2, baseRange / 2);
      if (!this.mg.isValidCoord(x, y)) {
        continue;
      }
      return this.mg.ref(x, y);
    }
    return undefined;
  }

  isActive(): boolean {
    return this.active && this.aircraft?.isActive() === true;
  }

  activeDuringSpawnPhase(): boolean {
    return false;
  }
}
