import { Execution, Game, Unit, UnitType } from "../game/Game";
import { PseudoRandom } from "../PseudoRandom";
import { CargoPlaneExecution } from "./CargoPlaneExecution";

export class AirportExecution implements Execution {
  private active = true;
  private mg!: Game;
  private random!: PseudoRandom;
  private checkOffset = 0;
  private spawnRejections = 0;

  constructor(private readonly airport: Unit) {}

  init(mg: Game): void {
    this.mg = mg;
    this.random = new PseudoRandom(mg.ticks());
    this.checkOffset = mg.ticks() % 10;
  }

  tick(): void {
    if (!this.airport.isActive()) {
      this.active = false;
      return;
    }

    if (this.airport.isUnderConstruction()) {
      return;
    }

    if ((this.mg.ticks() + this.checkOffset) % 10 !== 0) {
      return;
    }

    if (!this.shouldSpawnCargoPlane()) {
      return;
    }

    const airports = this.tradingAirports();
    if (airports.length === 0) {
      return;
    }

    const destination = this.random.randElement(airports);
    this.mg.addExecution(
      new CargoPlaneExecution(this.airport.owner(), this.airport, destination),
    );
  }

  private shouldSpawnCargoPlane(): boolean {
    const numCargoPlanes = this.mg.unitCount(UnitType.CargoPlane);
    const spawnRate = this.mg
      .config()
      .tradeShipSpawnRate(this.spawnRejections, numCargoPlanes);
    for (let i = 0; i < this.airport.level(); i++) {
      if (this.random.chance(spawnRate)) {
        this.spawnRejections = 0;
        return true;
      }
      this.spawnRejections++;
    }
    return false;
  }

  private tradingAirports(): Unit[] {
    const owner = this.airport.owner();
    const airports = this.mg
      .players()
      .filter(
        (player) =>
          player !== owner &&
          owner.canAirTradeWith(player) &&
          player.canAirTradeWith(owner),
      )
      .flatMap((player) => player.units(UnitType.Airport))
      .filter((airport) => airport.isActive() && !airport.isUnderConstruction())
      .sort((a, b) => {
        return (
          this.mg.manhattanDist(this.airport.tile(), a.tile()) -
          this.mg.manhattanDist(this.airport.tile(), b.tile())
        );
      });

    const weighted: Unit[] = [];
    for (const [index, destination] of airports.entries()) {
      const expanded = new Array(destination.level()).fill(destination);
      weighted.push(...expanded);
      const closeBonus =
        index < this.mg.config().proximityBonusPortsNb(airports.length);
      if (closeBonus) {
        weighted.push(...expanded);
      }
      if (owner.isFriendly(destination.owner(), true)) {
        weighted.push(...expanded);
      }
    }

    return weighted;
  }

  isActive(): boolean {
    return this.active;
  }

  activeDuringSpawnPhase(): boolean {
    return false;
  }
}
