import {
  Nukes,
  RadarStations,
  Submarines,
  UnitType,
} from "../../core/game/Game";
import { GameView, UnitView } from "../../core/game/GameView";

const MISSILE_UNIT_TYPES: readonly UnitType[] = [
  UnitType.SAMMissile,
  ...Nukes.types,
];
const RADAR_SOURCE_TYPES: readonly UnitType[] = [
  ...RadarStations.types,
  UnitType.Frigate,
];
const SONAR_SOURCE_TYPES: readonly UnitType[] = [
  UnitType.Frigate,
  UnitType.SonarBuoy,
];

function isMissileUnit(type: UnitType): boolean {
  return MISSILE_UNIT_TYPES.includes(type);
}

function radarRange(game: GameView, unit: UnitView): number {
  switch (unit.type()) {
    case UnitType.SmallRadar:
      return game.config().smallRadarRange();
    case UnitType.MediumRadar:
      return game.config().mediumRadarRange();
    case UnitType.LargeRadar:
      return game.config().largeRadarRange();
    case UnitType.Frigate:
      return game.config().frigateRadarRange();
    default:
      return 0;
  }
}

function sonarRange(game: GameView, unit: UnitView): number {
  switch (unit.type()) {
    case UnitType.Frigate:
      return game.config().frigateSonarRange();
    case UnitType.SonarBuoy:
      return game.config().sonarBuoyRange();
    default:
      return 0;
  }
}

function hasDetectionSource(
  game: GameView,
  target: UnitView,
  sourceTypes: readonly UnitType[],
  rangeForUnit: (game: GameView, unit: UnitView) => number,
): boolean {
  const myPlayer = game.myPlayer();
  if (myPlayer === null) {
    return true;
  }

  return game.units(...sourceTypes).some((source) => {
    if (!source.isActive() || source.isUnderConstruction()) {
      return false;
    }
    if (
      source.owner() !== myPlayer &&
      !myPlayer.isFriendly(source.owner())
    ) {
      return false;
    }
    const range = rangeForUnit(game, source);
    return (
      range > 0 &&
      game.euclideanDistSquared(source.tile(), target.tile()) <= range * range
    );
  });
}

export function isUnitVisible(game: GameView, unit: UnitView): boolean {
  const myPlayer = game.myPlayer();
  if (myPlayer === null) {
    return true;
  }

  if (unit.owner() === myPlayer || myPlayer.isFriendly(unit.owner())) {
    return true;
  }

  if (Submarines.has(unit.type())) {
    return hasDetectionSource(game, unit, SONAR_SOURCE_TYPES, sonarRange);
  }

  if (isMissileUnit(unit.type())) {
    return hasDetectionSource(game, unit, RADAR_SOURCE_TYPES, radarRange);
  }

  return true;
}

export function visibilitySensitiveUnitIds(game: GameView): number[] {
  return game
    .units(
      ...Submarines.types,
      ...MISSILE_UNIT_TYPES,
      ...RadarStations.types,
      UnitType.Frigate,
      UnitType.SonarBuoy,
    )
    .map((unit) => unit.id());
}
