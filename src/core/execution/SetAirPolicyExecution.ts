import { Execution, Game, Player } from "../game/Game";
import { SetAirPolicyIntent } from "../Schemas";

export class SetAirPolicyExecution implements Execution {
  constructor(
    private readonly player: Player,
    private readonly intent: SetAirPolicyIntent,
  ) {}

  init(_mg: Game): void {
    this.player.setAirPolicy({
      tradePermissions: this.intent.tradePermissions,
      interceptPermissions: this.intent.interceptPermissions,
      interceptNationSmallIds: new Set(this.intent.interceptNationSmallIds ?? []),
      interceptAreas: this.intent.interceptAreas,
    });
  }

  tick(): void {}

  isActive(): boolean {
    return false;
  }

  activeDuringSpawnPhase(): boolean {
    return true;
  }
}
