import * as THREE from 'three';
import type { V3 } from './layout';

/**
 * Objectives: each region has a main objective (the chain the player follows)
 * and optional ones. Completion is evaluated from game state every half
 * second, so objectives never depend on scripted triggers firing.
 */
export interface GameFacts {
  shrinesLit: Set<string>;
  itemsTaken: Set<string>;
  regionsVisited: Set<string>;
  doorsOpen: Set<string>;
  bossesDefeated: Set<string>;
  notesRead: Set<string>;
}

export interface ObjectiveDef {
  id: string;
  region: string;
  title: string;
  detail: string;
  main: boolean;
  /** Where the lantern and the wisps point. */
  target: V3;
  done: (f: GameFacts) => boolean;
  /** Shown when the player has made no progress for a while. */
  hint: string;
}

const lit = (id: string) => (f: GameFacts): boolean => f.shrinesLit.has(id);
const took = (id: string) => (f: GameFacts): boolean => f.itemsTaken.has(id);

export const OBJECTIVES: ObjectiveDef[] = [
  // ---- main chain
  { id: 'm-ossuary', region: 'crypt', main: true, title: 'Kindle the First Wick', detail: 'Somewhere in the Wick Ossuary a candle shrine waits for the flame you carry.', target: [0, -9, 88.5], done: lit('ossuary'), hint: 'Follow the ossuary hall north past the sarcophagi; the shrine sits beneath the carved words.' },
  { id: 'm-brinemoor', region: 'village', main: true, title: 'Reach the Brinemoor Chapel', detail: 'Climb out of the crypt and head west, into the drowned village. Its chapel candle is still unlit.', target: [-97, 0.45, 44.5], done: lit('brinemoor'), hint: 'The chapel stands on the largest island. The boardwalks from the east shore reach it.' },
  { id: 'm-gallowwood', region: 'forest', main: true, title: 'Find the Gallowwood Wayside', detail: 'East of the Barrow Road the dead forest hides a wayside shrine.', target: [104, 1, 44], done: lit('gallowwood'), hint: 'Leave the road eastward. The wayside candle is near the forest edge, not deep in the hollow.' },
  { id: 'm-vigil', region: 'cathedral', main: true, title: 'Keep the Last Vigil', detail: 'Climb to the Cathedral of the Last Vigil and kindle the candle in its apse.', target: [7.5, 15.1, -114], done: lit('vigil'), hint: 'The causeway ramp climbs to the cathedral plateau. The shrine is behind the altar.' },
  { id: 'm-wickmother', region: 'arena', main: true, title: 'Unmake the Wick-Mother', detail: 'Beyond the fog south of the cathedral, Oskeline tends the dead god\'s wound.', target: [0, 4, -150.5], done: (f) => f.bossesDefeated.has('oskeline'), hint: 'The fog wall lies south of the cathedral. Notes found in the gallery speak of her weakness.' },
  { id: 'm-descend', region: 'arena', main: true, title: 'Descend into the Wound', detail: 'With the Wick-Mother unmade, a stair has opened at the heart of the Godwound.', target: [0, 4, -176], done: (f) => f.regionsVisited.has('catacombs'), hint: 'The stair opens where Oskeline fell, near the centre of the arena.' },
  { id: 'm-reliquary', region: 'catacombs', main: true, title: 'Kindle the Drowned Reliquary', detail: 'The flooded ossuary has a candle shrine near where you arrived.', target: [324, -20, 48], done: lit('reliquary'), hint: 'The shrine is close to the stair you came down, at the south end of the hall.' },
  { id: 'm-choir', region: 'catacombs', main: true, title: 'Silence the Bone Choir', detail: 'Something sings in the great hall to the north. The water rises and falls with it.', target: [320, -20, -40], done: (f) => f.bossesDefeated.has('choir'), hint: 'The corridor ahead is barred; go round through the Weeping Nave to the east.' },
  { id: 'm-bellspire', region: 'bellspire', main: true, title: 'Climb the Bellspire', detail: 'The bone stair leads up into wind and lightning, and a tower that tolls by itself.', target: [320, 0.5, 158], done: (f) => f.regionsVisited.has('bellspire'), hint: 'Climb the bone stair at the back of the Choir\'s hall.' },
  { id: 'm-warden', region: 'bellspire', main: true, title: 'Cut Down the Hanged Warden', detail: 'At the top of the tower, on the gibbet deck, the Warden still swings.', target: [320, 38, 127], done: (f) => f.bossesDefeated.has('warden'), hint: 'The stair winds up inside the tower; the deck is through the north doorway at the top.' },
  // ---- optional
  { id: 'o-bow', region: 'crypt', main: false, title: 'Claim the Gloamstring', detail: 'A bow lies with a fallen archer in the ossuary.', target: [14, -9, 104], done: took('crypt-bow'), hint: 'Search the east alcoves of the ossuary hall.' },
  { id: 'o-daggers', region: 'village', main: false, title: 'The Silent Sisters\' Needles', detail: 'Twin daggers were left in a Brinemoor house, far out on the water.', target: [-139, 0.4, 33], done: took('brine-daggers'), hint: 'The westernmost houses of Brinemoor. Wade carefully.' },
  { id: 'o-bell', region: 'village', main: false, title: 'Climb the Drowned Bell', detail: 'Something glints at the top of the Brinemoor bell tower.', target: [-128, 15.2, -12], done: took('bell-vessel'), hint: 'The bell tower\'s stair winds inside it; the door faces east.' },
  { id: 'o-slab', region: 'forest', main: false, title: 'The Coffin-Lid Slab', detail: 'A grave-iron blade rests in the sunken hollow of Gallowwood.', target: [146, -3.4, 121], done: took('hollow-slab'), hint: 'The hollow is north-east in the forest, below the ridge.' },
  { id: 'o-whetstone', region: 'forest', main: false, title: 'Atop the Watch Ruin', detail: 'The ruined watchtower on the ridge holds a gift for those who climb.', target: [96, 21.2, -98], done: took('watch-whetstone'), hint: 'The watch ruin stands on the ridge; its stair is inside.' },
  { id: 'o-charm', region: 'catacombs', main: false, title: 'The Humming Bone', detail: 'Something hums in a corner of the arrival hall.', target: [304, -20, 6], done: took('choir-charm'), hint: 'The north-west corner of the arrival hall.' },
  { id: 'o-catbar', region: 'catacombs', main: false, title: 'Unbar the Corridor', detail: 'The straight way to the Choir is barred from its side.', target: [320, -20, -20], done: (f) => f.doorsOpen.has('catacomb-bar'), hint: 'Reach the Choir\'s hall the long way, then lift the bar from inside.' },
  { id: 'o-ropewalk', region: 'bellspire', main: false, title: 'The Ropewalk Candle', detail: 'A shrine clings to the gibbet deck, near the top of the tower.', target: [310, 38, 139], done: lit('ropewalk'), hint: 'Through the north doorway at the top of the stair.' },
  { id: 'o-storm', region: 'bellspire', main: false, title: 'Stormglass', detail: 'Lightning has fused something at the foot of the tower.', target: [328, 0, 176], done: took('storm-whetstone'), hint: 'Search the ground near Bellfoot.' },
  { id: 'o-shortcut', region: 'cathedral', main: false, title: 'Lift the Undercroft Bar', detail: 'A door beneath the cathedral is barred from the inside. Open it for an easier way back.', target: [0, 0.6, -20.7], done: (f) => f.doorsOpen.has('undercroft'), hint: 'Descend through the cathedral\'s north tower to reach the Undercroft door from within.' },
];

/** Notes left by the dead: read by walking up to them; kept in the journal. */
export interface NoteDef {
  id: string;
  p: V3;
  title: string;
  text: string;
}

export const NOTES: NoteDef[] = [
  { id: 'n-archer', p: [12, -9, 102], title: 'Scrap tucked in a quiver', text: 'I kept the bow when they took our lanterns. Aim for the skull; the rot there is thinnest. Arrows come back to you at every candle, as if the flame begrudges you nothing.' },
  { id: 'n-ferryman', p: [-86, 0.4, 30], title: 'A ferryman\'s tally', text: 'Nine crossings, nine drowned. The stalkers stand still when the lantern finds their faces. Keep it lit, keep looking, and back away.' },
  { id: 'n-woodcutter', p: [110, 1, 48], title: 'Bark, carved with a nail', text: 'The hollow floods with fog below the ridge. Something heavy was buried there with its blade. The watch ruin on the ridge still has its stair.' },
  { id: 'n-choirboy', p: [18, 21.3, -96], title: 'A hymn sheet, blotted', text: 'She is only wax until the mask falls. Strike her when she lifts the candelabrum high: the flame leaves her side bare. When the heart lights red, keep moving; her fire follows where you stood.' },
  { id: 'n-cantor', p: [322, -20, 30], title: 'A cantor\'s wax tablet', text: 'The Choir follows the Cantor, the head that sings highest. Break it and the rest lose the note. When it tears itself in three, the Cantor goes with one of them.' },
  { id: 'n-ringer', p: [318, 0.05, 172], title: 'A bell-ringer\'s rope, knotted with words', text: 'Its heart hangs in a cage beneath its ribs, and it glows before the toll. Arrows fly where blades cannot reach. When the chains break, stay behind the bell.' },
  { id: 'n-deacon', p: [-3, 14.3, -60], title: 'A deacon\'s last page', text: 'We barred the undercroft door from inside so the fog could not follow us down. If you come from the cathedral side, lift the bar; the road will be shorter for whoever comes after.' },
];

const _v = new THREE.Vector3();

export class ObjectiveTracker {
  readonly done = new Set<string>();
  /** Seconds since anything changed (objective, item, shrine, note). */
  idle = 0;
  private lastHintAt = -1e9;
  onComplete: ((o: ObjectiveDef) => void) | null = null;

  constructor(private facts: GameFacts) {}

  get current(): ObjectiveDef | null {
    return OBJECTIVES.find((o) => o.main && !this.done.has(o.id)) ?? null;
  }

  /** Main objective plus the nearest optional ones in the player's region. */
  tracked(region: string): ObjectiveDef[] {
    const out: ObjectiveDef[] = [];
    const c = this.current;
    if (c) out.push(c);
    for (const o of OBJECTIVES) if (!o.main && o.region === region && !this.done.has(o.id) && out.length < 3) out.push(o);
    return out;
  }

  /** Evaluate completion (silent on load). */
  evaluate(silent = false): void {
    for (const o of OBJECTIVES) {
      if (this.done.has(o.id) || !o.done(this.facts)) continue;
      this.done.add(o.id);
      this.idle = 0;
      if (!silent) this.onComplete?.(o);
    }
  }

  /** Returns a hint when the player has been stuck for a while. */
  update(dt: number, now: number): string | null {
    this.idle += dt;
    const c = this.current;
    if (!c || this.idle < 240 || now - this.lastHintAt < 180) return null;
    this.lastHintAt = now;
    return c.hint;
  }

  progressed(): void {
    this.idle = 0;
  }

  /** Horizontal direction from `from` to the current main objective, or null. */
  direction(from: THREE.Vector3, out: THREE.Vector3): THREE.Vector3 | null {
    const c = this.current;
    if (!c) return null;
    _v.set(...c.target);
    out.subVectors(_v, from);
    out.y = 0;
    if (out.lengthSq() < 4) return null;
    return out.normalize();
  }
}
