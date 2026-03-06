import {
  Execution,
  Game,
  isUnit,
  OwnerComp,
  Submarines,
  Unit,
  UnitType,
} from "../game/Game";
import { TileRef } from "../game/GameMap";
import { PathFinding } from "../pathfinding/PathFinder";
import { PathStatus, SteppingPathFinder } from "../pathfinding/types";
import { PseudoRandom } from "../PseudoRandom";
import { ShellExecution } from "./ShellExecution";

type SubmarineType = (typeof Submarines.types)[number];

type SubmarineSpawnInput = OwnerComp & {
  patrolTile: TileRef;
  submarineType: SubmarineType;
};

export class SubmarineExecution implements Execution {
  private random: PseudoRandom;
  private submarine!: Unit;
  private mg!: Game;
  private pathfinder!: SteppingPathFinder<TileRef>;
  private lastShellAttack = 0;
  private alreadySentShell = new Set<Unit>();

  constructor(private input: SubmarineSpawnInput | Unit) {}

  init(mg: Game, ticks: number): void {
    this.mg = mg;
    this.pathfinder = PathFinding.Water(mg);
    this.random = new PseudoRandom(mg.ticks());
    if (isUnit(this.input)) {
      if (!Submarines.has(this.input.type())) {
        throw new Error(`invalid submarine type: ${this.input.type()}`);
      }
      this.submarine = this.input;
      return;
    }

    const spawn = this.input.owner.canBuild(
      this.input.submarineType,
      this.input.patrolTile,
    );
    if (spawn === false) {
      console.warn(
        `Failed to spawn ${this.input.submarineType} for ${this.input.owner.name()}`,
      );
      return;
    }
    this.submarine = this.input.owner.buildUnit(this.input.submarineType, spawn, {
      patrolTile: this.input.patrolTile,
    });
  }

  tick(ticks: number): void {
    if (!this.submarine || !this.submarine.isActive()) {
      return;
    }
    if (this.submarine.health() <= 0) {
      this.submarine.delete();
      return;
    }

    this.reloadNuclearPayloadIfNeeded();

    const target = this.findTargetSubmarine();
    this.submarine.setTargetUnit(target);

    if (target !== undefined) {
      this.huntTarget(target);
      this.shootTarget();
      return;
    }

    this.patrol();
  }

  private reloadNuclearPayloadIfNeeded() {
    if (this.submarine.type() !== UnitType.NuclearSubmarine) {
      return;
    }
    const frontTime = this.submarine.missileTimerQueue()[0];
    if (frontTime === undefined) {
      return;
    }
    const cooldown = this.mg.config().SiloCooldown() - (this.mg.ticks() - frontTime);
    if (cooldown <= 0) {
      this.submarine.reloadMissile();
    }
  }

  private findTargetSubmarine(): Unit | undefined {
    const owner = this.submarine.owner();
    const patrolTile = this.submarine.patrolTile();
    if (patrolTile === undefined) {
      return undefined;
    }

    const patrolRangeSquared = this.mg.config().warshipPatrolRange() ** 2;
    const nearby = this.mg.nearbyUnits(
      this.submarine.tile(),
      this.mg.config().warshipTargettingRange(),
      Submarines.types,
    );

    let best: { unit: Unit; distSquared: number } | undefined;
    for (const candidate of nearby) {
      const unit = candidate.unit;
      if (unit === this.submarine || unit.owner() === owner) {
        continue;
      }
      if (owner.isFriendly(unit.owner()) || !owner.canAttackPlayer(unit.owner(), true)) {
        continue;
      }
      if (this.alreadySentShell.has(unit)) {
        continue;
      }
      if (this.mg.euclideanDistSquared(patrolTile, unit.tile()) > patrolRangeSquared) {
        continue;
      }
      if (best === undefined || candidate.distSquared < best.distSquared) {
        best = candidate;
      }
    }

    return best?.unit;
  }

  private shootTarget() {
    const target = this.submarine.targetUnit();
    if (!target) {
      return;
    }
    const shellAttackRate = this.mg.config().warshipShellAttackRate();
    if (this.mg.ticks() - this.lastShellAttack <= shellAttackRate) {
      return;
    }

    this.lastShellAttack = this.mg.ticks();
    this.mg.addExecution(
      new ShellExecution(this.submarine.tile(), this.submarine.owner(), this.submarine, target),
    );
    if (!target.hasHealth()) {
      this.alreadySentShell.add(target);
      this.submarine.setTargetUnit(undefined);
    }
  }

  private huntTarget(target: Unit) {
    const result = this.pathfinder.next(this.submarine.tile(), target.tile(), 3);
    if (result.status === PathStatus.COMPLETE || result.status === PathStatus.NEXT) {
      this.submarine.move(result.node);
      return;
    }
    if (result.status === PathStatus.NOT_FOUND) {
      this.submarine.setTargetUnit(undefined);
    }
  }

  private patrol() {
    if (this.submarine.targetTile() === undefined) {
      this.submarine.setTargetTile(this.randomTile());
      if (this.submarine.targetTile() === undefined) {
        return;
      }
    }

    const result = this.pathfinder.next(
      this.submarine.tile(),
      this.submarine.targetTile()!,
    );
    switch (result.status) {
      case PathStatus.COMPLETE:
        this.submarine.setTargetTile(undefined);
        this.submarine.move(result.node);
        break;
      case PathStatus.NEXT:
        this.submarine.move(result.node);
        break;
      case PathStatus.NOT_FOUND:
        this.submarine.setTargetTile(undefined);
        break;
    }
  }

  private randomTile(allowShoreline: boolean = false): TileRef | undefined {
    let patrolRange = this.mg.config().warshipPatrolRange();
    const maxAttemptBeforeExpand = 500;
    let attempts = 0;
    let expandCount = 0;

    const component = this.mg.getWaterComponent(this.submarine.tile());

    while (expandCount < 3) {
      const patrolTile = this.submarine.patrolTile();
      if (patrolTile === undefined) {
        return undefined;
      }
      const x =
        this.mg.x(patrolTile) + this.random.nextInt(-patrolRange / 2, patrolRange / 2);
      const y =
        this.mg.y(patrolTile) + this.random.nextInt(-patrolRange / 2, patrolRange / 2);

      if (!this.mg.isValidCoord(x, y)) {
        continue;
      }
      const tile = this.mg.ref(x, y);
      if (!this.mg.isOcean(tile) || (!allowShoreline && this.mg.isShoreline(tile))) {
        attempts++;
      } else if (
        component !== null &&
        !this.mg.hasWaterComponent(tile, component)
      ) {
        attempts++;
      } else {
        return tile;
      }

      if (attempts === maxAttemptBeforeExpand) {
        expandCount++;
        attempts = 0;
        patrolRange += Math.floor(patrolRange / 2);
      }
    }

    if (!allowShoreline) {
      return this.randomTile(true);
    }
    return undefined;
  }

  isActive(): boolean {
    return this.submarine?.isActive() ?? false;
  }

  activeDuringSpawnPhase(): boolean {
    return false;
  }
}
