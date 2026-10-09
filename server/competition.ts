import { randomUUID } from "node:crypto";
import type { Account } from "./domain.js";
import { audit, expire, fail, one, tell } from "./domain.js";
import type { Database, Sql } from "./db.js";
import { resultInput } from "./validation.js";
export function seedSlots(size: number) {
  let slots = [1, 2];
  while (slots.length < size) {
    const sum = slots.length * 2 + 1;
    slots = slots.flatMap((n) => [n, sum - n]);
  }
  return slots;
}
export function roundRobin(ids: string[]) {
  const ring: [string | null, ...(string | null)[]] = [...ids] as any;
  if (ring.length % 2) ring.push(null);
  const fixtures: { round: number; a: string; b: string }[] = [];
  for (let round = 1; round < ring.length; round++) {
    for (let i = 0; i < ring.length / 2; i++) {
      const a = ring[i],
        b = ring[ring.length - 1 - i];
      if (a && b) fixtures.push({ round, a, b });
    }
    ring.splice(1, 0, ring.pop()!);
  }
  return fixtures;
}
export async function draw(
  db: Database,
  a: Account,
  id: string,
  seeds?: string[],
) {
  return db.transaction(async (tx) => {
    const c = await one(tx, "SELECT * FROM categories WHERE id=$1 FOR UPDATE", [
      id,
    ]);
    const e = await one(tx, "SELECT * FROM events WHERE id=$1", [c.event_id]);
    if (!["published", "closed"].includes(e.status))
      fail(409, "Draws require an active event.");
    await expire(tx, id);
    if (
      (
        await tx.query(
          "SELECT 1 FROM entries WHERE category_id=$1 AND status='awaiting_payment'",
          [id],
        )
      ).rows.length
    )
      fail(
        409,
        "Wait for active payment reservations to expire or resolve them before drawing.",
      );
    if (
      (
        await tx.query(
          `SELECT 1 FROM entries WHERE category_id=$1 AND status IN ('awaiting_verification','needs_review_no_seat','withdrawal_requested')`,
          [id],
        )
      ).rows.length
    )
      fail(409, "Review pending entries before publishing draws.");
    if (
      (
        await tx.query(
          `SELECT 1 FROM matches WHERE category_id=$1 AND status='completed'`,
          [id],
        )
      ).rows.length
    )
      fail(409, "A draw with match results cannot be regenerated.");
    const entries = (
      await tx.query(
        `SELECT en.id,COALESCE((SELECT sum(w.points) FROM entry_members m JOIN awards w ON w.athlete_id=m.athlete_id JOIN categories ac ON ac.id=w.category_id JOIN events ae ON ae.id=ac.event_id WHERE m.entry_id=en.id AND ae.sport=$2),0) seed FROM entries en WHERE category_id=$1 AND status='confirmed' ORDER BY seed DESC,created_at,id`,
        [id, e.sport],
      )
    ).rows;
    let ids = entries.map((r) => r.id);
    if (ids.length < 2)
      fail(409, "At least two confirmed entries are required.");
    if (seeds) {
      if (
        seeds.length !== ids.length ||
        new Set(seeds).size !== ids.length ||
        seeds.some((s) => !ids.includes(s))
      )
        fail(400, "Seeds must include every confirmed entry exactly once.");
      ids = seeds;
    }
    await tx.query("UPDATE matches SET next_match=NULL WHERE category_id=$1", [
      id,
    ]);
    await tx.query(
      "DELETE FROM disputes WHERE match_id IN (SELECT id FROM matches WHERE category_id=$1)",
      [id],
    );
    await tx.query("DELETE FROM matches WHERE category_id=$1", [id]);
    await tx.query("DELETE FROM awards WHERE category_id=$1", [id]);
    const fixtures: any[] = [];
    if (c.format === "round_robin") {
      let position = 0;
      for (const f of roundRobin(ids))
        fixtures.push({
          id: randomUUID(),
          round: f.round,
          position: ++position,
          entry_a: f.a,
          entry_b: f.b,
          next_match: null,
          next_slot: null,
          winner_id: null,
          status: "pending",
        });
    } else {
      const size = 2 ** Math.ceil(Math.log2(ids.length)),
        rounds = Math.log2(size),
        rows: string[][] = [];
      for (let r = 0; r < rounds; r++)
        rows.push(
          Array.from({ length: size / 2 ** (r + 1) }, () => randomUUID()),
        );
      const slots = seedSlots(size).map((n) => ids[n - 1] || null);
      for (let r = 0; r < rounds; r++)
        for (let position = 0; position < rows[r].length; position++)
          fixtures.push({
            id: rows[r][position],
            round: r + 1,
            position: position + 1,
            entry_a: r === 0 ? slots[position * 2] : null,
            entry_b: r === 0 ? slots[position * 2 + 1] : null,
            next_match: rows[r + 1]?.[Math.floor(position / 2)] || null,
            next_slot: r < rounds - 1 ? (position % 2 ? "b" : "a") : null,
            winner_id: null,
            status: "pending",
          });
      const byId = new Map(fixtures.map((m) => [m.id, m]));
      for (const m of fixtures.filter((m) => m.round === 1))
        if (!m.entry_a || !m.entry_b) {
          m.winner_id = m.entry_a || m.entry_b;
          m.status = "bye";
          if (m.next_match)
            byId.get(m.next_match)["entry_" + m.next_slot] = m.winner_id;
        }
    }
    await tx.query(
      `INSERT INTO matches(id,category_id,round,position,entry_a,entry_b,next_match,next_slot,winner_id,status) SELECT id,$2,round,position,entry_a,entry_b,next_match,next_slot,winner_id,status FROM jsonb_to_recordset($1::jsonb) AS x(id uuid,round integer,position integer,entry_a uuid,entry_b uuid,next_match uuid,next_slot text,winner_id uuid,status text)`,
      [JSON.stringify(fixtures), id],
    );
    await tx.query("UPDATE categories SET draw_published=true WHERE id=$1", [
      id,
    ]);
    await audit(tx, a, "draw.published", id, { seeds: ids, format: c.format });
    await tx.query(
      `INSERT INTO notifications(id,account_id,text) SELECT gen_random_uuid(),x.owner_id,$2 FROM (SELECT DISTINCT a.owner_id FROM entry_members em JOIN athletes a ON a.id=em.athlete_id WHERE em.entry_id=ANY($1::uuid[])) x`,
      [ids, "Draw published for " + e.name + ". Check your fixtures."],
    );
    return (
      await tx.query(
        "SELECT * FROM matches WHERE category_id=$1 ORDER BY round,position",
        [id],
      )
    ).rows;
  });
}
function scoreValid(s: any, m: any, bestOf: number) {
  if (s.outcome === "double_withdrawal") {
    if (s.winner_id !== null)
      fail(400, "Double withdrawal cannot declare a winner.");
    return;
  }
  if (![m.entry_a, m.entry_b].includes(s.winner_id) || !s.winner_id)
    fail(400, "Winner must be a participant in this match.");
  if (s.outcome !== "played") return;
  if (
    s.sets.length === 0 ||
    s.sets.length > bestOf ||
    s.sets.some((v: number[]) => v[0] === v[1])
  )
    fail(400, "Enter valid, untied set scores within the match format.");
  const need = Math.floor(bestOf / 2) + 1;
  let a = 0,
    b = 0;
  for (let i = 0; i < s.sets.length; i++) {
    if (a === need || b === need)
      fail(400, "Scores contain sets after the match was decided.");
    s.sets[i][0] > s.sets[i][1] ? a++ : b++;
  }
  if (
    Math.max(a, b) !== need ||
    (a > b ? m.entry_a : m.entry_b) !== s.winner_id
  )
    fail(400, "Set scores do not match the declared winner.");
}
export async function standings(tx: Sql, category: string) {
  const entries = (
    await tx.query(
      `SELECT id FROM entries WHERE id IN (SELECT entry_a FROM matches WHERE category_id=$1 UNION SELECT entry_b FROM matches WHERE category_id=$1) ORDER BY created_at,id`,
      [category],
    )
  ).rows;
  const table = new Map(
    entries.map((r) => [
      r.id,
      {
        entry_id: r.id,
        wins: 0,
        losses: 0,
        set_difference: 0,
        point_difference: 0,
      },
    ]),
  );
  const matches = (
    await tx.query(
      `SELECT * FROM matches WHERE category_id=$1 AND status='completed' ORDER BY round,position`,
      [category],
    )
  ).rows;
  for (const m of matches) {
    if (!m.winner_id) continue;
    for (const id of [m.entry_a, m.entry_b]) {
      const r = table.get(id);
      if (!r) continue;
      r.wins += Number(m.winner_id === id);
      r.losses += Number(m.winner_id !== id);
      for (const [a, b] of m.score?.sets || []) {
        const d = id === m.entry_a ? a - b : b - a;
        r.point_difference += d;
        r.set_difference += Math.sign(d);
      }
    }
  }
  return [...table.values()].sort(
    (a, b) =>
      b.wins - a.wins ||
      b.set_difference - a.set_difference ||
      b.point_difference - a.point_difference ||
      a.entry_id.localeCompare(b.entry_id),
  );
}
export async function recalculate(tx: Sql, c: any) {
  await tx.query("DELETE FROM awards WHERE category_id=$1", [c.id]);
  const ms = (
    await tx.query(
      "SELECT * FROM matches WHERE category_id=$1 ORDER BY round DESC,position",
      [c.id],
    )
  ).rows;
  if (!ms.length || ms.some((m) => m.status === "pending")) return;
  const points = c.points;
  const placements = new Map<string, { placement: string; points: number }>();
  const entries = (
    await tx.query(
      "SELECT id FROM entries WHERE id IN (SELECT entry_a FROM matches WHERE category_id=$1 UNION SELECT entry_b FROM matches WHERE category_id=$1)",
      [c.id],
    )
  ).rows;
  for (const e of entries)
    placements.set(e.id, {
      placement: "Participation",
      points: points.participation,
    });
  if (c.format === "round_robin") {
    const ranks = await standings(tx, c.id);
    ranks.forEach((r, i) =>
      placements.set(r.entry_id, {
        placement: i === 0 ? "Winner" : i === 1 ? "Runner-up" : "Participation",
        points:
          i === 0
            ? points.winner
            : i === 1
              ? points.runner
              : points.participation,
      }),
    );
  } else {
    const final = ms[0];
    if (final.winner_id) {
      placements.set(final.winner_id, {
        placement: "Winner",
        points: points.winner,
      });
      const loser = [final.entry_a, final.entry_b].find(
        (id) => id && id !== final.winner_id,
      );
      if (loser)
        placements.set(loser, {
          placement: "Runner-up",
          points: points.runner,
        });
    }
    for (const m of ms.filter((m) => m.round === final.round - 1))
      for (const loser of [m.entry_a, m.entry_b].filter(
        (x) => x && x !== m.winner_id,
      ))
        placements.set(loser, {
          placement: "Semifinalist",
          points: points.semi,
        });
  }
  const awarded = [...placements].map(([entry_id, p]) => ({ entry_id, ...p }));
  await tx.query(
    `INSERT INTO awards(category_id,athlete_id,points,placement) SELECT $2,em.athlete_id,x.points,x.placement FROM jsonb_to_recordset($1::jsonb) AS x(entry_id uuid,points integer,placement text) JOIN entry_members em ON em.entry_id=x.entry_id`,
    [JSON.stringify(awarded), c.id],
  );
}
export async function recordResult(
  db: Database,
  a: Account,
  id: string,
  input: any,
) {
  const s = resultInput.parse(input);
  return db.transaction(async (tx) => {
    const initial = await one(tx, "SELECT * FROM matches WHERE id=$1", [id]);
    const c = await one(tx, "SELECT * FROM categories WHERE id=$1 FOR UPDATE", [
      initial.category_id,
    ]);
    const e = await one(tx, "SELECT status FROM events WHERE id=$1", [
      c.event_id,
    ]);
    if (e.status === "cancelled")
      fail(409, "Results cannot be changed for cancelled events.");
    const m = await one(tx, "SELECT * FROM matches WHERE id=$1 FOR UPDATE", [
      id,
    ]);
    if (m.version !== s.version)
      fail(
        409,
        "This result changed. Refresh before saving.",
        "VERSION_CONFLICT",
      );
    if (m.status === "bye" || !m.entry_a || !m.entry_b)
      fail(409, "This match does not have two participants.");
    scoreValid(s, m, c.best_of);
    if (m.next_match && m.winner_id !== s.winner_id) {
      const next = await one(tx, "SELECT * FROM matches WHERE id=$1", [
        m.next_match,
      ]);
      if (next.status !== "pending")
        fail(
          409,
          "Correct downstream results first; this winner has already advanced.",
        );
      await tx.query(
        `UPDATE matches SET ${m.next_slot === "a" ? "entry_a" : "entry_b"}=$2,version=version+1 WHERE id=$1`,
        [m.next_match, s.winner_id],
      );
    }
    await tx.query(
      `UPDATE matches SET winner_id=$2,score=$3,status='completed',version=version+1 WHERE id=$1`,
      [id, s.winner_id, JSON.stringify(s)],
    );
    let nextId = m.next_match;
    while (nextId) {
      const next = await one(tx, "SELECT * FROM matches WHERE id=$1", [nextId]);
      const feeders = (
        await tx.query("SELECT * FROM matches WHERE next_match=$1", [next.id])
      ).rows;
      if (
        next.status !== "pending" ||
        feeders.some((f) => f.status === "pending") ||
        (next.entry_a && next.entry_b)
      )
        break;
      const win = next.entry_a || next.entry_b;
      await tx.query(
        `UPDATE matches SET winner_id=$2,status='bye',version=version+1 WHERE id=$1`,
        [next.id, win],
      );
      if (next.next_match)
        await tx.query(
          `UPDATE matches SET ${next.next_slot === "a" ? "entry_a" : "entry_b"}=$2 WHERE id=$1`,
          [next.next_match, win],
        );
      nextId = next.next_match;
    }
    await recalculate(tx, c);
    await audit(
      tx,
      a,
      m.status === "completed" ? "result.corrected" : "result.published",
      id,
      { previous: m.score, result: s },
    );
    for (const entry of [m.entry_a, m.entry_b])
      await tell(
        tx,
        entry,
        "A verified result was published. View your match history.",
      );
  });
}
