import { CommandablePatrolUnits, Execution, Game, Player } from "../game/Game";
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
    const patrolUnit = this.owner
      .units(...CommandablePatrolUnits.types)
      .find((u) => u.id() === this.unitId);
    if (!patrolUnit) {
      console.warn("MoveWarshipExecution: patrol unit not found");
      return;
    }
    if (!patrolUnit.isActive()) {
      console.warn("MoveWarshipExecution: patrol unit is not active");
      return;
    }
    patrolUnit.setPatrolTile(this.position);
    patrolUnit.setTargetTile(undefined);
  }

  tick(ticks: number): void {}

  isActive(): boolean {
    return false;
  }

  activeDuringSpawnPhase(): boolean {
    return false;
  }
}
