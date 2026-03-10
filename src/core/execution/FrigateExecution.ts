import {
  Execution,
  Game,
  isUnit,
  MessageType,
  OwnerComp,
  Player,
  Unit,
  UnitParams,
  UnitType,
} from "../game/Game";
import { TileRef } from "../game/GameMap";
import { PathFinding } from "../pathfinding/PathFinder";
import { PathStatus, SteppingPathFinder } from "../pathfinding/types";
import { PseudoRandom } from "../PseudoRandom";
import { SAMMissileExecution } from "./SAMMissileExecution";
import { SAMTargetingSystem } from "./SAMLauncherExecution";
import { ShellExecution } from "./ShellExecution";

export class FrigateExecution implements Execution {
  private random!: PseudoRandom;
  private frigate!: Unit;
  private mg!: Game;
  private pathfinder!: SteppingPathFinder<TileRef>;
  private lastShellAttack = 0;
  private alreadySentShell = new Set<Unit>();
  private targetingSystem!: SAMTargetingSystem;
  private deployedBuoys: Unit[] = [];
  private lastSonarDeployTick = -Infinity;
  private readonly mirvWarheadSearchRadius = 400;
  private readonly mirvWarheadProtectionRadius = 50;

  constructor(
    private input: (UnitParams<UnitType.Frigate> & OwnerComp) | Unit,
  ) {}

  init(mg: Game, ticks: number): void {
    this.mg = mg;
    this.pathfinder = PathFinding.Water(mg);
    this.random = new PseudoRandom(mg.ticks());
    if (isUnit(this.input)) {
      this.frigate = this.input;
    } else {
      const spawn = this.input.owner.canBuild(
        UnitType.Frigate,
        this.input.patrolTile,
      );
      if (spawn === false) {
        console.warn(
          `Failed to spawn frigate for ${this.input.owner.name()} at ${this.input.patrolTile}`,
        );
        return;
      }
      this.frigate = this.input.owner.buildUnit(
        UnitType.Frigate,
        spawn,
        this.input,
      );
    }
    this.targetingSystem = new SAMTargetingSystem(
      this.mg,
      this.frigate,
      this.mg.config().frigateMissileInterceptRange(),
    );
  }

  tick(ticks: number): void {
    if (!this.frigate || !this.frigate.isActive()) {
      this.cleanupBuoys();
      return;
    }
    if (this.frigate.health() <= 0) {
      this.cleanupBuoys();
      this.frigate.delete();
      return;
    }

    const hasPort = this.frigate.owner().unitCount(UnitType.Port) > 0;
    if (hasPort) {
      this.frigate.modifyHealth(1);
    }

    this.reloadSamIfNeeded();
    this.deploySonarBuoyIfNeeded();
    this.tryInterceptMissiles(ticks);

    this.frigate.setTargetUnit(this.findTargetUnit());
    if (this.frigate.targetUnit()?.type() === UnitType.TradeShip) {
      this.huntDownTradeShip();
      return;
    }

    this.patrol();

    if (this.frigate.targetUnit() !== undefined) {
      this.shootTarget();
    }
  }

  private reloadSamIfNeeded() {
    if (!this.frigate.isInCooldown()) {
      return;
    }
    const frontTime = this.frigate.missileTimerQueue()[0];
    if (frontTime === undefined) {
      return;
    }
    const cooldown = this.mg.config().SAMCooldown() - (this.mg.ticks() - frontTime);
    if (cooldown <= 0) {
      this.frigate.reloadMissile();
    }
  }

  private deploySonarBuoyIfNeeded() {
    this.deployedBuoys = this.deployedBuoys.filter((buoy) => buoy.isActive());

    const cooldown = this.mg.config().frigateSonarDeployCooldown();
    if (this.mg.ticks() - this.lastSonarDeployTick < cooldown) {
      return;
    }

    const currentTile = this.frigate.tile();
    const minSpacingSquared = Math.max(1, this.mg.config().sonarBuoyRange() / 2) ** 2;
    const hasNearbyBuoy = this.deployedBuoys.some(
      (buoy) =>
        buoy.isActive() &&
        this.mg.euclideanDistSquared(buoy.tile(), currentTile) <= minSpacingSquared,
    );
    if (hasNearbyBuoy) {
      return;
    }

    const buoy = this.frigate.owner().buildUnit(UnitType.SonarBuoy, currentTile, {});
    buoy.setTargetable(false);
    this.deployedBuoys.push(buoy);
    this.lastSonarDeployTick = this.mg.ticks();

    const maxBuoys = this.mg.config().frigateMaxSonarBuoys();
    while (this.deployedBuoys.length > maxBuoys) {
      const expired = this.deployedBuoys.shift();
      if (expired?.isActive()) {
        expired.delete(false);
      }
    }
  }

  private tryInterceptMissiles(ticks: number) {
    if (this.frigate.isInCooldown()) {
      return;
    }

    const mirvWarheadTargets = this.mg.nearbyUnits(
      this.frigate.tile(),
      this.mirvWarheadSearchRadius,
      UnitType.MIRVWarhead,
      ({ unit }) => {
        if (!isUnit(unit)) return false;
        if (unit.owner() === this.frigate.owner()) return false;
        if (this.frigate.owner().isFriendly(unit.owner())) return false;
        const dst = unit.targetTile();
        return (
          dst !== undefined &&
          this.mg.manhattanDist(dst, this.frigate.tile()) <
            this.mirvWarheadProtectionRadius
        );
      },
    );

    if (mirvWarheadTargets.length > 0) {
      this.frigate.launch();
      const owner = this.frigate.owner();
      this.mg.displayMessage(
        "events_display.mirv_warheads_intercepted",
        MessageType.SAM_HIT,
        owner.id(),
        undefined,
        { count: mirvWarheadTargets.length },
      );
      mirvWarheadTargets.forEach(({ unit }) => unit.delete());
      this.mg
        .stats()
        .bombIntercept(owner, UnitType.MIRVWarhead, mirvWarheadTargets.length);
      return;
    }

    const target = this.targetingSystem.getSingleTarget(ticks);
    if (target === null) {
      return;
    }

    this.frigate.launch();
    target.unit.setTargetedBySAM(true);
    this.mg.addExecution(
      new SAMMissileExecution(
        this.frigate.tile(),
        this.frigate.owner(),
        this.frigate,
        target.unit,
        target.tile,
      ),
    );
  }

  private findTargetUnit(): Unit | undefined {
    const owner = this.frigate.owner();
    const hasPort = owner.unitCount(UnitType.Port) > 0;
    const patrolTile = this.frigate.patrolTile();
    if (patrolTile === undefined) {
      return undefined;
    }

    const patrolRangeSquared = this.mg.config().warshipPatrolRange() ** 2;
    const ships = this.mg.nearbyUnits(
      this.frigate.tile(),
      this.mg.config().warshipTargettingRange(),
      [UnitType.TransportShip, UnitType.Warship, UnitType.Frigate, UnitType.TradeShip],
    );

    let bestUnit: Unit | undefined;
    let bestTypePriority = 0;
    let bestDistSquared = 0;

    for (const { unit, distSquared } of ships) {
      if (
        unit.owner() === owner ||
        unit === this.frigate ||
        !owner.canAttackPlayer(unit.owner(), true) ||
        this.alreadySentShell.has(unit)
      ) {
        continue;
      }

      const type = unit.type();
      if (type === UnitType.TradeShip) {
        if (
          !hasPort ||
          unit.isSafeFromPirates() ||
          unit.targetUnit()?.owner() === owner ||
          unit.targetUnit()?.owner().isFriendly(owner)
        ) {
          continue;
        }
        if (
          this.mg.euclideanDistSquared(patrolTile, unit.tile()) > patrolRangeSquared
        ) {
          continue;
        }
      }

      const typePriority =
        type === UnitType.TransportShip
          ? 0
          : type === UnitType.Warship || type === UnitType.Frigate
            ? 1
            : 2;

      if (
        bestUnit === undefined ||
        typePriority < bestTypePriority ||
        (typePriority === bestTypePriority && distSquared < bestDistSquared)
      ) {
        bestUnit = unit;
        bestTypePriority = typePriority;
        bestDistSquared = distSquared;
      }
    }

    return bestUnit;
  }

  private shootTarget() {
    const shellAttackRate = this.mg.config().warshipShellAttackRate();
    if (this.mg.ticks() - this.lastShellAttack <= shellAttackRate) {
      return;
    }
    if (this.frigate.targetUnit()?.type() !== UnitType.TransportShip) {
      this.lastShellAttack = this.mg.ticks();
    }
    this.mg.addExecution(
      new ShellExecution(
        this.frigate.tile(),
        this.frigate.owner(),
        this.frigate,
        this.frigate.targetUnit()!,
      ),
    );
    if (!this.frigate.targetUnit()!.hasHealth()) {
      this.alreadySentShell.add(this.frigate.targetUnit()!);
      this.frigate.setTargetUnit(undefined);
    }
  }

  private huntDownTradeShip() {
    for (let i = 0; i < 2; i++) {
      const result = this.pathfinder.next(
        this.frigate.tile(),
        this.frigate.targetUnit()!.tile(),
        5,
      );
      switch (result.status) {
        case PathStatus.COMPLETE:
          this.frigate.owner().captureUnit(this.frigate.targetUnit()!);
          this.frigate.setTargetUnit(undefined);
          this.frigate.move(this.frigate.tile());
          return;
        case PathStatus.NEXT:
          this.frigate.move(result.node);
          break;
        case PathStatus.NOT_FOUND:
          return;
      }
    }
  }

  private patrol() {
    if (this.frigate.targetTile() === undefined) {
      this.frigate.setTargetTile(this.randomTile());
      if (this.frigate.targetTile() === undefined) {
        return;
      }
    }

    const result = this.pathfinder.next(
      this.frigate.tile(),
      this.frigate.targetTile()!,
    );
    switch (result.status) {
      case PathStatus.COMPLETE:
        this.frigate.setTargetTile(undefined);
        this.frigate.move(result.node);
        break;
      case PathStatus.NEXT:
        this.frigate.move(result.node);
        break;
      case PathStatus.NOT_FOUND:
        break;
    }
  }

  private randomTile(allowShoreline = false): TileRef | undefined {
    let patrolRange = this.mg.config().warshipPatrolRange();
    const maxAttemptBeforeExpand = 500;
    let attempts = 0;
    let expandCount = 0;
    const component = this.mg.getWaterComponent(this.frigate.tile());

    while (expandCount < 3) {
      const patrolTile = this.frigate.patrolTile();
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
      if (
        !this.mg.isOcean(tile) ||
        (!allowShoreline && this.mg.isShoreline(tile))
      ) {
        attempts++;
      } else if (component !== null && !this.mg.hasWaterComponent(tile, component)) {
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

  private cleanupBuoys() {
    for (const buoy of this.deployedBuoys) {
      if (buoy.isActive()) {
        buoy.delete(false);
      }
    }
    this.deployedBuoys = [];
  }

  isActive(): boolean {
    return this.frigate?.isActive() ?? false;
  }

  activeDuringSpawnPhase(): boolean {
    return false;
  }
}
