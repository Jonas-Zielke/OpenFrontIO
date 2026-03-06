import fs from "fs/promises";
import path from "path";
import { fileURLToPath } from "url";
import { GameMapType } from "src/core/game/Game";
import { logger } from "./Logger";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const mapLandTileCache = new Map<GameMapType, number>();

const log = logger.child({ component: "MapLandTiles" });

function getMapFolderName(map: GameMapType): string {
  const key = Object.keys(GameMapType).find(
    (k) => GameMapType[k as keyof typeof GameMapType] === map,
  );
  if (!key) {
    throw new Error(`Unknown map: ${map}`);
  }
  return key.toLowerCase();
}

async function loadMapLandTiles(map: GameMapType): Promise<number> {
  const mapFolder = getMapFolderName(map);
  const manifestPath = path.join(
    __dirname,
    "../../static/maps",
    mapFolder,
    "manifest.json",
  );
  const manifestRaw = await fs.readFile(manifestPath, "utf8");
  const manifest = JSON.parse(manifestRaw) as {
    map?: { num_land_tiles?: number };
  };
  const landTiles = manifest.map?.num_land_tiles;
  if (typeof landTiles !== "number" || !Number.isFinite(landTiles)) {
    throw new Error(`Invalid map manifest at ${manifestPath}`);
  }
  return landTiles;
}

// Gets the number of land tiles for a map
export async function getMapLandTiles(map: GameMapType): Promise<number> {
  const cached = mapLandTileCache.get(map);
  if (cached !== undefined) {
    return cached;
  }

  try {
    const landTiles = await loadMapLandTiles(map);
    mapLandTileCache.set(map, landTiles);
    return landTiles;
  } catch (error) {
    log.error(`Failed to load manifest for ${map}: ${error}`, { map });
    return 1_000_000; // Default fallback
  }
}
