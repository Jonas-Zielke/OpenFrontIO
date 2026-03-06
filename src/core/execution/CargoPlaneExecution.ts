import { renderNumber } from "../../client/Utils";
import {
  Execution,
  Game,
  MessageType,
  Player,
  Unit,
  UnitType,
} from "../game/Game";
import { PathFinding } from "../pathfinding/PathFinder";
import { PathStatus, SteppingPathFinder } from "../pathfinding/types";

export class CargoPlaneExecution implements Execution {
  private active = true;
  private mg!: Game;
  private plane: Unit | undefined;
  private pathFinder!: SteppingPathFinder<number>;
  private tilesTraveled = 0;

  constructor(
    private readonly originOwner: Player,
    private readonly srcAirport: Unit,
    private dstAirport: Unit,
  ) {}

  init(mg: Game): void {
    this.mg = mg;
    this.pathFinder = PathFinding.Air(mg);
  }

  tick(): void {
    if (!this.active) {
      return;
    }

    if (this.plane === undefined) {
      const spawn = this.originOwner.canBuild(
        UnitType.CargoPlane,
        this.srcAirport.tile(),
      );
      if (spawn === false) {
        this.active = false;
        return;
      }
      this.plane = this.originOwner.buildUnit(UnitType.CargoPlane, spawn, {
        targetUnit: this.dstAirport,
        originOwner: this.originOwner,
      });
      return;
    }

    if (!this.plane.isActive()) {
      this.active = false;
      return;
    }

    const owner = this.plane.owner();
    const dstOwner = this.dstAirport.owner();
    if (
      !this.dstAirport.isActive() ||
      !owner.canAirTradeWith(dstOwner) ||
      !dstOwner.canAirTradeWith(owner)
    ) {
      this.plane.delete(false);
      this.active = false;
      return;
    }

    if (this.plane.tile() === this.dstAirport.tile()) {
      this.complete();
      return;
    }

    const dst = this.dstAirport.tile();
    const result = this.pathFinder.next(this.plane.tile(), dst, 2);
    switch (result.status) {
      case PathStatus.NEXT:
      case PathStatus.COMPLETE:
        this.plane.move(result.node);
        this.tilesTraveled++;
        break;
      case PathStatus.NOT_FOUND:
        this.plane.delete(false);
        this.active = false;
        break;
    }
  }

  private complete() {
    if (!this.plane) {
      this.active = false;
      return;
    }

    const distanceBonus = Math.max(1, this.tilesTraveled);
    const gold = this.mg.config().tradeShipGold(distanceBonus);
    this.srcAirport.owner().addGold(gold, this.srcAirport.tile());
    this.dstAirport.owner().addGold(gold, this.dstAirport.tile());

    this.mg.displayMessage(
      "events_display.received_gold_from_trade",
      MessageType.RECEIVED_GOLD_FROM_TRADE,
      this.srcAirport.owner().id(),
      gold,
      {
        gold: renderNumber(gold),
        name: this.dstAirport.owner().displayName(),
      },
    );
    this.mg.displayMessage(
      "events_display.received_gold_from_trade",
      MessageType.RECEIVED_GOLD_FROM_TRADE,
      this.dstAirport.owner().id(),
      gold,
      {
        gold: renderNumber(gold),
        name: this.srcAirport.owner().displayName(),
      },
    );

    this.plane.delete(false);
    this.active = false;
  }

  isActive(): boolean {
    return this.active;
  }

  activeDuringSpawnPhase(): boolean {
    return false;
  }
}
