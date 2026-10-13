import { useQuery } from "@tanstack/react-query";
import { useEffect, useId, useState } from "react";
import { useNavigate, useParams } from "react-router";
import {
  ArmoryApiError,
  getArmoryCharacter,
  getArmoryCharacters,
  type ArmoryItem,
  type ArmoryItemStat
} from "../api/armory.js";
import { useAuth } from "../auth/auth-context.js";
import { DocumentTitle } from "../components/DocumentTitle.js";

const STALE_TIME_MS = 30_000;

function signed(value: number): string { return value > 0 ? `+${value}` : String(value); }

function ItemStatLines({ stats }: { stats: ArmoryItemStat[] }) {
  return <>{stats.map((stat) => <div key={stat.name}>{signed(stat.value)} {stat.name}</div>)}</>;
}

function ItemDetails({ item }: { item: ArmoryItem }) {
  return <div className="armory-item-details">
    <strong className={`armory-quality-${item.quality}`}>{item.name}</strong>
    <div>Item Level {item.itemLevel}</div>
    {item.bonding && <div>{item.bonding}</div>}
    <div className="armory-tooltip-columns"><span>{item.inventoryType}</span></div>
    {item.armor > 0 && <div>{item.armor} Armor</div>}
    {item.block > 0 && <div>{item.block} Block</div>}
    {item.damage && <>
      <div className="armory-tooltip-columns">
        <span>{item.damage.minimum.toFixed(0)} - {item.damage.maximum.toFixed(0)} Damage</span>
        <span>Speed {item.damage.speedSeconds.toFixed(2)}</span>
      </div>
      <div>({item.damage.dps.toFixed(1)} damage per second)</div>
    </>}
    {item.damageScalesWithLevel && <div>Damage scales with character level</div>}
    <ItemStatLines stats={item.stats} />
    <ItemStatLines stats={item.resistances} />
    {item.sockets.map((socket, index) => <div className="armory-socket" key={`${socket}-${index}`}>
      <span aria-hidden="true" /> {socket} Socket
    </div>)}
    {item.requiredLevel > 0 && <div>Requires Level {item.requiredLevel}</div>}
    {item.durability && <div>Durability {item.durability.current} / {item.durability.maximum}</div>}
    {item.description && <div className="armory-item-description">“{item.description}”</div>}
  </div>;
}

function ItemSlot({ slotName, item, onOpen }: { slotName: string; item: ArmoryItem | null; onOpen(item: ArmoryItem): void }) {
  const tooltipId = useId();
  return <div className={`armory-slot ${item ? "is-equipped" : "is-empty"}`}>
    <span className="armory-slot-name">{slotName}</span>
    {item ? <div className="armory-item-hover">
      <button type="button" className={`armory-item-button armory-quality-border-${item.quality}`}
        aria-describedby={tooltipId} onClick={() => onOpen(item)}>
        <span className="armory-item-glyph" aria-hidden="true">{slotName.slice(0, 2).toUpperCase()}</span>
        <span><strong className={`armory-quality-${item.quality}`}>{item.name}</strong><small>Item level {item.itemLevel}</small></span>
      </button>
      <div id={tooltipId} className="armory-hover-tooltip" role="tooltip"><ItemDetails item={item} /></div>
    </div> : <span className="armory-empty-slot">Empty</span>}
  </div>;
}

function ItemDialog({ item, onClose }: { item: ArmoryItem; onClose(): void }) {
  useEffect(() => {
    const closeOnEscape = (event: KeyboardEvent) => { if (event.key === "Escape") onClose(); };
    window.addEventListener("keydown", closeOnEscape);
    return () => window.removeEventListener("keydown", closeOnEscape);
  }, [onClose]);
  return <div className="armory-dialog-backdrop" onMouseDown={(event) => {
    if (event.target === event.currentTarget) onClose();
  }}>
    <section className="armory-item-dialog" role="dialog" aria-modal="true" aria-labelledby="armory-item-dialog-title">
      <button type="button" className="armory-dialog-close" onClick={onClose} autoFocus aria-label="Close item details">×</button>
      <h2 id="armory-item-dialog-title" className="visually-hidden">{item.name}</h2>
      <ItemDetails item={item} />
      <a className="armory-wowhead-link" href={`https://www.wowhead.com/wotlk/item=${item.entry}`}
        target="_blank" rel="noreferrer">Open on Wowhead</a>
    </section>
  </div>;
}

export function ArmoryPage() {
  const { characterId } = useParams();
  const navigate = useNavigate();
  const auth = useAuth();
  const [openItem, setOpenItem] = useState<ArmoryItem | undefined>();
  const charactersQuery = useQuery({
    queryKey: ["account-visible", "armory", "characters"],
    queryFn: ({ signal }) => getArmoryCharacters(signal),
    retry: false,
    staleTime: STALE_TIME_MS,
    refetchOnWindowFocus: false
  });
  const detailQuery = useQuery({
    queryKey: ["account-visible", "armory", "character", characterId],
    queryFn: ({ signal }) => getArmoryCharacter(characterId!, signal),
    enabled: characterId !== undefined,
    retry: false,
    staleTime: STALE_TIME_MS,
    refetchOnWindowFocus: false
  });

  useEffect(() => {
    const error = charactersQuery.error ?? detailQuery.error;
    if (error instanceof ArmoryApiError && error.httpStatus === 401) auth.setSignedOut();
  }, [auth, charactersQuery.error, detailQuery.error]);
  useEffect(() => setOpenItem(undefined), [characterId]);

  const character = detailQuery.data;
  const unavailable = (charactersQuery.isError && !(charactersQuery.error instanceof ArmoryApiError && charactersQuery.error.httpStatus === 401)) ||
    (detailQuery.isError && !(detailQuery.error instanceof ArmoryApiError && [401, 404].includes(detailQuery.error.httpStatus)));
  const notFound = detailQuery.error instanceof ArmoryApiError && detailQuery.error.httpStatus === 404;
  const pageTitle = character ? `${character.name} | Armory | DaBoysZeroth` : "Armory | DaBoysZeroth";

  return <main>
    <DocumentTitle>{pageTitle}</DocumentTitle>
    <header className="hero"><div>
      <p className="eyebrow">CHARACTER INSPECTION</p>
      <h1>Armory</h1>
      <p className="lede">Inspect saved equipment and talent loadouts for player characters.</p>
    </div></header>

    <section className="panel armory-picker" aria-labelledby="armory-picker-title">
      <h2 id="armory-picker-title">Character</h2>
      <label>Choose a character
        <select value={characterId ?? ""} disabled={charactersQuery.isPending || charactersQuery.isError}
          onChange={(event) => navigate(event.target.value ? `/armory/${event.target.value}` : "/armory")}>
          <option value="">Select a character</option>
          {charactersQuery.data?.map((entry) => <option key={entry.id} value={entry.id}>
            {entry.name} — Level {entry.level} {entry.class}
          </option>)}
        </select>
      </label>
      {charactersQuery.isPending && <p className="players-message" role="status">Loading characters...</p>}
      {charactersQuery.data?.length === 0 && <p className="players-message">No characters are available in the armory.</p>}
    </section>

    {detailQuery.isPending && characterId && <p className="players-message" role="status" aria-live="polite">Loading character...</p>}
    {notFound && <p className="message error" role="status">That character is not available in the armory.</p>}
    {unavailable && <p className="message error" role="status">The armory is temporarily unavailable.</p>}
    {!characterId && !charactersQuery.isPending && !charactersQuery.isError && charactersQuery.data && charactersQuery.data.length > 0 &&
      <p className="players-message armory-prompt">Choose a character to inspect their equipment and talents.</p>}

    {character && <>
      <section className="armory-character-header" aria-labelledby="armory-character-name">
        <div><p className="eyebrow">LEVEL {character.level}</p><h2 id="armory-character-name">{character.name}</h2>
          <p>{character.race} {character.class}</p></div>
        <p className="armory-saved-note">Latest saved server state</p>
      </section>

      <div className="armory-layout">
        <section className="panel armory-equipment" aria-labelledby="armory-equipment-title">
          <div className="armory-section-heading"><div><p className="eyebrow">EQUIPMENT</p><h2 id="armory-equipment-title">Gear</h2></div>
            <p>Hover, focus, or tap an item for details.</p></div>
          <div className="armory-equipment-grid">
            {character.equipment.map((slot) => <ItemSlot key={slot.slot} slotName={slot.name} item={slot.item} onOpen={setOpenItem} />)}
          </div>
        </section>

        <section className="panel armory-talents" aria-labelledby="armory-talents-title">
          <div className="armory-section-heading"><div><p className="eyebrow">SPECIALIZATION</p><h2 id="armory-talents-title">Talents</h2></div></div>
          <div className="armory-loadouts">{character.talentLoadouts.map((loadout) => <section className="armory-loadout" key={loadout.index}>
            <h3>{loadout.name} {loadout.active && <span className="armory-active-badge">Active</span>}</h3>
            <p>{loadout.points} talent {loadout.points === 1 ? "point" : "points"}</p>
            {loadout.trees.length === 0 ? <p className="players-message">No talents have been spent.</p> :
              <div className="armory-talent-trees">{loadout.trees.map((tree) => <section key={tree.name}>
                <h4>{tree.name} <span>{tree.points}</span></h4>
                <ul>{tree.talents.map((talent) => <li key={talent.spellId}>
                  <a href={`https://www.wowhead.com/wotlk/spell=${talent.spellId}`} target="_blank" rel="noreferrer">
                    {talent.name}
                  </a>
                  <span>{talent.rank}/{talent.maximumRank}</span>
                </li>)}</ul>
              </section>)}</div>}
          </section>)}</div>
        </section>
      </div>
    </>}
    {openItem && <ItemDialog item={openItem} onClose={() => setOpenItem(undefined)} />}
  </main>;
}
