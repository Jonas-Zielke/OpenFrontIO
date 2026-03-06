import { Execution, Game, NavalUnits, Player } from "../game/Game";
import { TileRef } from "../game/GameMap";

export class MoveWarshipExecution implements Execution {
  constructor(
    private readonly owner: Player,
    private readonly unitId: number,
    private readonly position: TileRef,
  ) {}

  init(mg: Game, ticks: number): void {
    if (!mg.isValidRef(this.position)) {
      console.warn(`MoveWarshipExecution: position ${this.position} not valid`);
      return;
    }
    const navalUnit = this.owner
      .units(...NavalUnits.types)
      .find((u) => u.id() === this.unitId);
    if (!navalUnit) {
      console.warn("MoveWarshipExecution: naval unit not found");
      return;
    }
    if (!navalUnit.isActive()) {
      console.warn("MoveWarshipExecution: naval unit is not active");
      return;
    }
    navalUnit.setPatrolTile(this.position);
    navalUnit.setTargetTile(undefined);
  }

  tick(ticks: number): void {}

  isActive(): boolean {
    return false;
  }

  activeDuringSpawnPhase(): boolean {
    return false;
  }
}
