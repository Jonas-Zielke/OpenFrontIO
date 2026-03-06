import { html, LitElement } from "lit";
import { customElement, state } from "lit/decorators.js";
import { EventBus } from "../../../core/EventBus";
import { UnitType } from "../../../core/game/Game";
import { GameView } from "../../../core/game/GameView";
import { SendSetAirPolicyIntentEvent } from "../../Transport";
import { TransformHandler } from "../TransformHandler";
import { Layer } from "./Layer";

type RelationKey = "friends" | "normal" | "enemies";
type AreaKey = "north" | "south" | "west" | "east";

@customElement("air-manager")
export class AirManager extends LitElement implements Layer {
  public game!: GameView;
  public eventBus!: EventBus;
  public transformHandler?: TransformHandler;

  @state() private visible = false;
  @state() private open = false;
  @state() private dirty = false;
  @state() private tradePermissions: Record<RelationKey, boolean> = {
    friends: true,
    normal: true,
    enemies: false,
  };
  @state() private interceptPermissions: Record<RelationKey, boolean> = {
    friends: false,
    normal: false,
    enemies: true,
  };
  @state() private interceptAreas: Record<AreaKey, boolean> = {
    north: true,
    south: true,
    west: true,
    east: true,
  };
  @state() private interceptNationSmallIds: Set<number> = new Set();

  createRenderRoot() {
    return this;
  }

  init(): void {}

  tick(): void {
    const player = this.game?.myPlayer();
    if (!player || !player.isAlive()) {
      this.visible = false;
      this.open = false;
      this.dirty = false;
      return;
    }

    const hasAirport =
      player.units(UnitType.Airport).length > 0 ||
      player.units(UnitType.MilitaryAirport).length > 0;
    this.visible = hasAirport;
    if (!hasAirport) {
      this.open = false;
      this.dirty = false;
      return;
    }

    if (!this.dirty) {
      const policy = player.airPolicy();
      this.tradePermissions = { ...policy.tradePermissions };
      this.interceptPermissions = { ...policy.interceptPermissions };
      this.interceptAreas = { ...policy.interceptAreas };
      this.interceptNationSmallIds = new Set(policy.interceptNationSmallIds);
    }
  }

  shouldTransform(): boolean {
    return false;
  }

  renderLayer(): void {}

  private toggleRelation(
    group: "trade" | "intercept",
    key: RelationKey,
    checked: boolean,
  ) {
    this.dirty = true;
    if (group === "trade") {
      this.tradePermissions = {
        ...this.tradePermissions,
        [key]: checked,
      };
      return;
    }
    this.interceptPermissions = {
      ...this.interceptPermissions,
      [key]: checked,
    };
  }

  private toggleArea(key: AreaKey, checked: boolean) {
    this.dirty = true;
    this.interceptAreas = {
      ...this.interceptAreas,
      [key]: checked,
    };
  }

  private toggleNation(smallID: number, checked: boolean) {
    this.dirty = true;
    const next = new Set(this.interceptNationSmallIds);
    if (checked) {
      next.add(smallID);
    } else {
      next.delete(smallID);
    }
    this.interceptNationSmallIds = next;
  }

  private savePolicy() {
    this.eventBus.emit(
      new SendSetAirPolicyIntentEvent(
        this.tradePermissions,
        this.interceptPermissions,
        Array.from(this.interceptNationSmallIds),
        this.interceptAreas,
      ),
    );
    this.open = false;
    this.dirty = false;
  }

  render() {
    if (!this.visible) {
      return null;
    }

    const myPlayer = this.game.myPlayer();
    const nations = this.game
      .players()
      .filter((player) => player !== myPlayer)
      .sort((a, b) => a.smallID() - b.smallID());

    return html`
      <div class="fixed bottom-24 left-1/2 -translate-x-1/2 z-[1300]">
        <button
          class="px-3 py-2 rounded-md bg-slate-900/80 border border-slate-500 text-xs text-white font-semibold hover:bg-slate-700"
          @click=${() => {
            this.open = !this.open;
            this.dirty = false;
          }}
        >
          Air Manager
        </button>
      </div>

      ${this.open
        ? html`
            <div
              class="fixed inset-0 bg-black/50 z-[1299]"
              @click=${() => {
                this.open = false;
                this.dirty = false;
              }}
            ></div>
            <div
              class="fixed z-[1300] left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 w-[95vw] max-w-3xl max-h-[85vh] overflow-auto bg-slate-900 border border-slate-500 rounded-lg p-4 text-white"
            >
              <h2 class="text-lg font-semibold mb-3">Air Manager</h2>

              <div class="space-y-4">
                <section class="border border-slate-700 rounded-md p-3">
                  <h3 class="font-semibold mb-2">Trade Permissions</h3>
                  ${(["friends", "normal", "enemies"] as RelationKey[]).map(
                    (key) => html`
                      <label class="flex items-center gap-2 text-sm mb-1">
                        <input
                          type="checkbox"
                          .checked=${this.tradePermissions[key]}
                          @change=${(e: Event) =>
                            this.toggleRelation(
                              "trade",
                              key,
                              (e.target as HTMLInputElement).checked,
                            )}
                        />
                        ${key === "friends"
                          ? "Friends / Alliance Partners"
                          : key === "normal"
                            ? "Trading Partners / Normal Players"
                            : "Enemies I don't trade with"}
                      </label>
                    `,
                  )}
                </section>

                <section class="border border-slate-700 rounded-md p-3">
                  <h3 class="font-semibold mb-2">Intercept Permissions</h3>
                  ${(["friends", "normal", "enemies"] as RelationKey[]).map(
                    (key) => html`
                      <label class="flex items-center gap-2 text-sm mb-1">
                        <input
                          type="checkbox"
                          .checked=${this.interceptPermissions[key]}
                          @change=${(e: Event) =>
                            this.toggleRelation(
                              "intercept",
                              key,
                              (e.target as HTMLInputElement).checked,
                            )}
                        />
                        ${key === "friends"
                          ? "Friends / Alliance Partners"
                          : key === "normal"
                            ? "Trading Partners / Normal Players"
                            : "Enemies I don't trade with"}
                      </label>
                    `,
                  )}
                </section>

                <section class="border border-slate-700 rounded-md p-3">
                  <h3 class="font-semibold mb-2">Intercept Areas</h3>
                  ${(["north", "south", "west", "east"] as AreaKey[]).map(
                    (key) => html`
                      <label class="inline-flex items-center gap-2 text-sm mr-4 mb-1">
                        <input
                          type="checkbox"
                          .checked=${this.interceptAreas[key]}
                          @change=${(e: Event) =>
                            this.toggleArea(
                              key,
                              (e.target as HTMLInputElement).checked,
                            )}
                        />
                        ${key[0].toUpperCase() + key.slice(1)}
                      </label>
                    `,
                  )}
                </section>

                <section class="border border-slate-700 rounded-md p-3">
                  <h3 class="font-semibold mb-2">Intercept Nations</h3>
                  <p class="text-xs text-slate-300 mb-2">
                    Leave empty to apply to all nations.
                  </p>
                  <div class="grid sm:grid-cols-2 gap-1">
                    ${nations.map(
                      (player) => html`
                        <label class="flex items-center gap-2 text-sm">
                          <input
                            type="checkbox"
                            .checked=${this.interceptNationSmallIds.has(
                              player.smallID(),
                            )}
                            @change=${(e: Event) =>
                              this.toggleNation(
                                player.smallID(),
                                (e.target as HTMLInputElement).checked,
                              )}
                          />
                          ${player.displayName()}
                        </label>
                      `,
                    )}
                  </div>
                </section>
              </div>

              <div class="flex justify-end gap-2 mt-4">
                <button
                  class="px-3 py-2 rounded-md border border-slate-500 hover:bg-slate-700"
                  @click=${() => {
                    this.open = false;
                    this.dirty = false;
                  }}
                >
                  Cancel
                </button>
                <button
                  class="px-3 py-2 rounded-md bg-emerald-600 hover:bg-emerald-500 text-white font-semibold"
                  @click=${() => this.savePolicy()}
                >
                  Save
                </button>
              </div>
            </div>
          `
        : null}
    `;
  }
}
