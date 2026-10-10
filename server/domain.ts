import { randomBytes, randomUUID, createHash } from "node:crypto";
import type { Database, Sql } from "./db.js";
import {
  ageAt,
  entryInput,
  eventInput,
  paymentInput,
  profileInput,
  resultInput,
} from "./validation.js";
export class AppError extends Error {
  constructor(
    public status: number,
    message: string,
    public code = "INVALID_REQUEST",
  ) {
    super(message);
  }
}
export const fail = (status: number, message: string, code?: string): never => {
  throw new AppError(status, message, code);
};
export interface Account {
  id: string;
  email: string;
  role: "athlete" | "admin";
}
export const one = async (db: Sql, q: string, p: any[] = []) => {
  const r = await db.query(q, p);
  if (!r.rows[0]) fail(404, "Record not found.");
  return r.rows[0];
};
const j = (v: any) => JSON.stringify(v);
export async function audit(
  db: Sql,
  a: Account,
  action: string,
  id: string,
  details: any = {},
) {
  await db.query(
    "INSERT INTO audit(id,account_id,action,entity_id,details) VALUES($1,$2,$3,$4,$5)",
    [randomUUID(), a.id, action, id, j(details)],
  );
}
export async function tell(db: Sql, entryId: string, text: string) {
  await db.query(
    `INSERT INTO notifications(id,account_id,text) SELECT gen_random_uuid(),x.owner_id,$2 FROM (SELECT owner_id FROM entries WHERE id=$1 UNION SELECT a.owner_id FROM entry_members m JOIN athletes a ON a.id=m.athlete_id WHERE m.entry_id=$1) x`,
    [entryId, text],
  );
}

export async function owned(db: Sql, a: Account, id: string) {
  return one(db, "SELECT * FROM athletes WHERE id=$1 AND owner_id=$2", [
    id,
    a.id,
  ]);
}
export async function member(db: Sql, a: Account, id: string) {
  return one(
    db,
    `SELECT e.* FROM entries e WHERE e.id=$1 AND (e.owner_id=$2 OR EXISTS(SELECT 1 FROM entry_members m JOIN athletes a ON a.id=m.athlete_id WHERE m.entry_id=e.id AND a.owner_id=$2))`,
    [id, a.id],
  );
}
export async function profiles(db: Sql, a: Account) {
  const r = await db.query(
    `SELECT a.*,COALESCE((SELECT jsonb_agg(s ORDER BY primary_sport DESC,sport) FROM athlete_sports s WHERE s.athlete_id=a.id),'[]') sports,COALESCE((SELECT jsonb_agg(r) FROM ranking_reviews r WHERE r.athlete_id=a.id),'[]') ranking_reviews,COALESCE((SELECT SUM(points) FROM awards WHERE athlete_id=a.id),0)::int points FROM athletes a WHERE owner_id=$1 ORDER BY created_at`,
    [a.id],
  );
  return r.rows;
}
export async function saveProfile(
  db: Database,
  a: Account,
  input: any,
  id?: string,
) {
  if (a.role !== "athlete")
    fail(403, "Athlete profiles are created and maintained by athletes only.");
  const p = profileInput.parse(input);
  const today = new Date().toISOString().slice(0, 10);
  const age = ageAt(p.dob, today);
  if (age < 0 || age > 100)
    fail(400, "Date of birth must give an age between 0 and 100.");
  if (p.kind === "self" && age < 18)
    fail(400, "A guardian must manage athletes under 18.");
  if (p.kind === "junior" && age >= 18)
    fail(400, "Junior profiles must be under 18.");
  if (p.kind === "junior" && p.is_public)
    fail(400, "Junior profiles are private in this release.");
  return db.transaction(async (tx) => {
    if (id) await owned(tx, a, id);
    const pid = id || randomUUID();
    if (p.sports.some((s) => s.years > age))
      fail(400, "Years playing cannot exceed the athlete’s age.");
    if (p.photo_url) {
      const photoId = p.photo_url.match(
        /^\/api\/v1\/me\/uploads\/([a-f0-9-]{36})$/,
      )?.[1];
      if (!photoId) fail(400, "Use a private profile image uploaded to Rally.");
      await one(
        tx,
        "SELECT id FROM uploads WHERE id=$1 AND owner_id=$2 AND purpose='avatar'",
        [photoId, a.id],
      );
    }
    if (
      id &&
      (
        await tx.query(
          `SELECT 1 FROM entry_members m JOIN entries e ON e.id=m.entry_id JOIN categories c ON c.id=e.category_id JOIN events ev ON ev.id=c.event_id WHERE m.athlete_id=$1 AND e.status IN ('partner_pending','awaiting_payment','awaiting_verification','confirmed') AND ev.status NOT IN ('completed','cancelled')`,
          [id],
        )
      ).rows.length
    )
      fail(409, "Withdraw active entries before changing eligibility details.");
    await tx.query(
      `INSERT INTO athletes(id,owner_id,kind,name,dob,gender,state,city,phone,guardian_name,guardian_relationship,consent_at,is_public,photo_url,academy,coach,goal) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17) ON CONFLICT(id) DO UPDATE SET kind=excluded.kind,name=excluded.name,dob=excluded.dob,gender=excluded.gender,state=excluded.state,city=excluded.city,phone=excluded.phone,guardian_name=excluded.guardian_name,guardian_relationship=excluded.guardian_relationship,consent_at=excluded.consent_at,is_public=excluded.is_public,photo_url=excluded.photo_url,academy=excluded.academy,coach=excluded.coach,goal=excluded.goal`,
      [
        pid,
        a.id,
        p.kind,
        p.name,
        p.dob,
        p.gender,
        p.state,
        p.city,
        p.phone,
        p.guardian_name,
        p.guardian_relationship,
        p.consent ? new Date() : null,
        p.is_public,
        p.photo_url || null,
        p.academy,
        p.coach,
        p.goal,
      ],
    );
    await tx.query("DELETE FROM ranking_reviews WHERE athlete_id=$1", [pid]);
    await tx.query("DELETE FROM athlete_sports WHERE athlete_id=$1", [pid]);
    for (const s of p.sports)
      await tx.query(
        "INSERT INTO athlete_sports(athlete_id,sport,level,years,primary_sport,categories,rankings) VALUES($1,$2,$3,$4,$5,$6,$7)",
        [
          pid,
          s.sport,
          s.level,
          s.years,
          s.primary_sport,
          j(s.categories),
          j(s.rankings),
        ],
      );
    await audit(tx, a, id ? "profile.updated" : "profile.created", pid);
    return pid;
  });
}
export async function saveEvent(
  db: Database,
  a: Account,
  input: any,
  id?: string,
) {
  if (a.role !== "admin") fail(403, "Only Admin can create tournaments.");
  const e = eventInput.parse(input);
  return db.transaction(async (tx) => {
    if (id) {
      await one(tx, "SELECT id FROM events WHERE id=$1 FOR UPDATE", [id]);
      if (
        (
          await tx.query(
            "SELECT 1 FROM entries en JOIN categories c ON c.id=en.category_id WHERE c.event_id=$1",
            [id],
          )
        ).rows.length
      )
        fail(
          409,
          "An event with entries cannot have categories or eligibility rewritten. Manage schedules or cancel the event.",
        );
    }
    const eid = id || randomUUID();
    await tx.query(
      `INSERT INTO events(id,name,sport,city,state,venue,starts_at,ends_at,registration_deadline,age_cutoff,withdrawal_deadline,refund_policy,rules,poster_url,created_by,details) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16) ON CONFLICT(id) DO UPDATE SET name=excluded.name,sport=excluded.sport,city=excluded.city,state=excluded.state,venue=excluded.venue,starts_at=excluded.starts_at,ends_at=excluded.ends_at,registration_deadline=excluded.registration_deadline,age_cutoff=excluded.age_cutoff,withdrawal_deadline=excluded.withdrawal_deadline,refund_policy=excluded.refund_policy,rules=excluded.rules,poster_url=excluded.poster_url,details=excluded.details`,
      [
        eid,
        e.name,
        e.sport,
        e.city,
        e.state,
        e.venue,
        e.starts_at,
        e.ends_at,
        e.registration_deadline,
        e.age_cutoff,
        e.withdrawal_deadline,
        e.refund_policy,
        e.rules,
        e.poster_url,
        a.id,
        j(e.details),
      ],
    );
    await tx.query("DELETE FROM categories WHERE event_id=$1", [eid]);
    for (const c of e.categories)
      await tx.query(
        "INSERT INTO categories(id,event_id,name,entry_type,format,capacity,fee,min_age,max_age,gender,levels,best_of,school_required,points,team_min,team_max,scoring_mode,league_points) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18)",
        [
          randomUUID(),
          eid,
          c.name,
          c.entry_type,
          c.format,
          c.capacity,
          c.fee,
          c.min_age,
          c.max_age,
          c.gender,
          j(c.levels),
          c.best_of,
          c.school_required,
          j(c.points),
          c.team_min,
          c.team_max,
          c.scoring_mode,
          j(c.league_points),
        ],
      );
    await audit(tx, a, id ? "event.updated" : "event.created", eid);
    return eid;
  });
}
export async function expire(tx: Sql, categoryId: string) {
  await tx.query(
    `UPDATE entries SET status='expired' WHERE category_id=$1 AND status='awaiting_payment' AND reservation_expires_at<=now()`,
    [categoryId],
  );
}
export async function capacity(tx: Sql, c: any, except?: string) {
  await expire(tx, c.id);
  const r = await tx.query(
    `SELECT count(*)::int n FROM entries WHERE category_id=$1 AND ($2::uuid IS NULL OR id<>$2) AND status IN ('awaiting_payment','awaiting_verification','confirmed','withdrawal_requested')`,
    [c.id, except || null],
  );
  if (r.rows[0].n >= c.capacity)
    fail(409, "This category is full.", "CATEGORY_FULL");
}
export async function eligibility(tx: Sql, c: any, e: any, p: any) {
  const s = await one(
    tx,
    "SELECT * FROM athlete_sports WHERE athlete_id=$1 AND sport=$2",
    [p.id, e.sport],
  );
  const cutoff =
    typeof e.age_cutoff === "string"
      ? e.age_cutoff
      : new Date(e.age_cutoff).toISOString().slice(0, 10);
  const years = ageAt(p.dob, cutoff);
  if (years < c.min_age || years > c.max_age)
    fail(400, "Athlete does not meet this category’s age eligibility.");
  if (c.gender !== "any" && c.gender !== "mixed" && c.gender !== p.gender)
    fail(400, "Athlete does not meet this category’s gender eligibility.");
  if (!c.levels.includes(s.level) || !s.categories.includes(c.entry_type))
    fail(400, "Sport level or preferred category does not match this entry.");
  if (p.kind === "junior" && !p.consent_at)
    fail(400, "Guardian consent is required.");
  if (
    (
      await tx.query(
        `SELECT 1 FROM entry_members m JOIN entries en ON en.id=m.entry_id WHERE m.athlete_id=$1 AND en.category_id=$2 AND en.status NOT IN ('expired','payment_rejected','withdrawn','cancelled')`,
        [p.id, c.id],
      )
    ).rows.length
  )
    fail(409, "This athlete already has an entry in this category.");
}
const openEvent = (e: any) => {
  if (
    e.status !== "published" ||
    new Date(e.registration_deadline).getTime() <= Date.now()
  )
    fail(409, "Registration is closed.");
};
export async function register(db: Database, a: Account, input: any) {
  if (a.role !== "athlete") fail(403, "Use an Athlete account to register.");
  const p = entryInput.parse(input);
  return db.transaction(async (tx) => {
    const c = await one(tx, "SELECT * FROM categories WHERE id=$1 FOR UPDATE", [
      p.category_id,
    ]);
    const prior = await tx.query(
      "SELECT * FROM entries WHERE owner_id=$1 AND idempotency_key=$2",
      [a.id, p.idempotency_key],
    );
    if (prior.rows[0]) return prior.rows[0];
    const e = await one(tx, "SELECT * FROM events WHERE id=$1", [c.event_id]);
    openEvent(e);
    if (c.draw_published)
      fail(409, "Draw is published. Registration is closed for this category.");
    const athlete = await owned(tx, a, p.athlete_id);
    await eligibility(tx, c, e, athlete);
    const team = c.entry_type === "team";
    const target = team ? p.roster_size : c.entry_type === "doubles" ? 2 : 1;
    if (
      team &&
      (!p.team_name || !target || target < c.team_min || target > c.team_max)
    )
      fail(
        400,
        `Provide a team name and roster size from ${c.team_min} to ${c.team_max}.`,
      );
    if (
      team &&
      (
        await tx.query(
          "SELECT 1 FROM entries WHERE category_id=$1 AND lower(team_name)=lower($2) AND status NOT IN ('expired','withdrawn','cancelled','payment_rejected')",
          [c.id, p.team_name],
        )
      ).rows.length
    )
      fail(409, "This team name already has an active entry in this category.");
    if (c.school_required && !p.school)
      fail(400, "School or college details are required.");
    await capacity(tx, c);
    const id = randomUUID(),
      doubles = c.entry_type === "doubles" || team;
    const expires = new Date(
      Math.min(
        Date.now() + 30 * 60000,
        new Date(e.registration_deadline).getTime(),
      ),
    );
    const token = doubles ? randomBytes(24).toString("hex") : null;
    await tx.query(
      "INSERT INTO entries(id,category_id,owner_id,status,fee,reservation_expires_at,invite_token,invite_expires_at,emergency_contact,school,rules_accepted_at,idempotency_key) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,now(),$11)",
      [
        id,
        c.id,
        a.id,
        doubles ? "partner_pending" : "awaiting_payment",
        c.fee,
        doubles ? null : expires,
        token,
        doubles
          ? new Date(
              Math.min(
                Date.now() + 24 * 3600000,
                new Date(e.registration_deadline).getTime(),
              ),
            )
          : null,
        p.emergency_contact,
        p.school,
        p.idempotency_key,
      ],
    );
    await tx.query(
      "INSERT INTO entry_members(entry_id,athlete_id) VALUES($1,$2)",
      [id, athlete.id],
    );
    await tx.query(
      "UPDATE entries SET team_name=$2,roster_size=$3 WHERE id=$1",
      [id, team ? p.team_name : null, target],
    );
    if (!doubles && c.fee === 0)
      await tx.query(`UPDATE entries SET status='confirmed' WHERE id=$1`, [id]);
    await audit(tx, a, "entry.created", id);
    return one(tx, "SELECT * FROM entries WHERE id=$1", [id]);
  });
}
export async function acceptPartner(
  db: Database,
  a: Account,
  token: string,
  athleteId: string,
) {
  if (a.role !== "athlete")
    fail(403, "Only athletes or their guardians can join a roster.");
  return db.transaction(async (tx) => {
    const en = await one(tx, "SELECT * FROM entries WHERE invite_token=$1", [
      token,
    ]);
    const c = await one(tx, "SELECT * FROM categories WHERE id=$1 FOR UPDATE", [
      en.category_id,
    ]);
    const locked = await one(
      tx,
      "SELECT * FROM entries WHERE id=$1 FOR UPDATE",
      [en.id],
    );
    if (!["doubles", "team"].includes(c.entry_type))
      fail(409, "This category does not accept invitations.");
    if (
      locked.status !== "partner_pending" ||
      new Date(locked.invite_expires_at).getTime() <= Date.now()
    )
      fail(409, "This invitation is closed or expired.");
    const e = await one(tx, "SELECT * FROM events WHERE id=$1", [c.event_id]);
    openEvent(e);
    if (c.draw_published)
      fail(409, "Draw is published. Registration is closed for this category.");
    const p = await owned(tx, a, athleteId);
    await eligibility(tx, c, e, p);
    const first = await one(
      tx,
      "SELECT a.* FROM entry_members m JOIN athletes a ON a.id=m.athlete_id WHERE m.entry_id=$1",
      [en.id],
    );
    if (first.id === p.id) fail(400, "Choose a different partner.");
    if (
      c.entry_type === "doubles" &&
      c.gender === "mixed" &&
      new Set([first.gender, p.gender]).size !== 2
    )
      fail(400, "Mixed doubles requires one male and one female athlete.");
    if (
      c.entry_type === "doubles" &&
      c.gender === "mixed" &&
      ![first.gender, p.gender].every((g) => ["male", "female"].includes(g))
    )
      fail(400, "Mixed doubles requires one male and one female athlete.");
    const count = (
      await tx.query(
        "SELECT count(*)::int n FROM entry_members WHERE entry_id=$1",
        [en.id],
      )
    ).rows[0].n;
    const target = c.entry_type === "team" ? locked.roster_size : 2;
    if (count >= target) fail(409, "This roster is already complete.");
    if (
      c.entry_type === "team" &&
      c.gender === "mixed" &&
      count + 1 === target
    ) {
      const genders = (
        await tx.query(
          "SELECT a.gender FROM entry_members m JOIN athletes a ON a.id=m.athlete_id WHERE m.entry_id=$1",
          [en.id],
        )
      ).rows
        .map((row) => row.gender)
        .concat(p.gender);
      if (!genders.includes("male") || !genders.includes("female"))
        fail(
          400,
          "Mixed teams require at least one male and one female athlete.",
        );
    }
    if (count + 1 === target) await capacity(tx, c);
    await tx.query(
      "INSERT INTO entry_members(entry_id,athlete_id) VALUES($1,$2)",
      [en.id, p.id],
    );
    if (count + 1 < target) {
      await audit(tx, a, "team.member_accepted", en.id);
      await tell(
        tx,
        en.id,
        `A teammate joined ${locked.team_name}. ${count + 1} of ${target} players accepted.`,
      );
      return en.id;
    }
    await tx.query(
      "UPDATE entries SET status=$2,reservation_expires_at=$3 WHERE id=$1",
      [
        en.id,
        c.fee === 0 ? "confirmed" : "awaiting_payment",
        new Date(
          Math.min(
            Date.now() + 30 * 60000,
            new Date(e.registration_deadline).getTime(),
          ),
        ),
      ],
    );
    await audit(tx, a, "partner.accepted", en.id);
    await tell(
      tx,
      en.id,
      c.entry_type === "team"
        ? "Your team roster is complete. Your entry is ready."
        : "Your doubles partner accepted. Your entry is ready.",
    );
    return en.id;
  });
}
export async function submitPayment(
  db: Database,
  a: Account,
  id: string,
  input: any,
  mode: "test" | "live",
) {
  const p = paymentInput.parse(input);
  if (Date.parse(p.paid_at) > Date.now() + 300000)
    fail(400, "Payment time cannot be in the future.");
  return db.transaction(async (tx) => {
    const en = await member(tx, a, id);
    const c = await one(tx, "SELECT * FROM categories WHERE id=$1 FOR UPDATE", [
      en.category_id,
    ]);
    const locked = await one(
      tx,
      "SELECT * FROM entries WHERE id=$1 FOR UPDATE",
      [id],
    );
    if (
      !["awaiting_payment", "expired", "payment_rejected"].includes(
        locked.status,
      )
    )
      fail(409, "This entry cannot accept a new payment submission.");
    const e = await one(tx, "SELECT * FROM events WHERE id=$1", [c.event_id]);
    if (["cancelled", "completed", "draft"].includes(e.status))
      fail(409, "This event cannot accept payment submissions.");
    if (en.fee === 0)
      fail(400, "Free entries do not need a payment submission.");
    if (mode === "test" && !p.reference.toUpperCase().startsWith("TEST-"))
      fail(
        400,
        "Use a TEST- reference. Do not transfer real money during testing.",
      );
    if (mode === "live" && p.reference.toUpperCase().startsWith("TEST-"))
      fail(400, "A live payment needs the bank reference.");
    const ref = p.reference.toUpperCase();
    const fingerprint = createHash("sha256").update(ref).digest("hex");
    if (
      (
        await tx.query(
          "SELECT 1 FROM payment_references WHERE reference_hash=$1",
          [fingerprint],
        )
      ).rows.length
    )
      fail(
        409,
        "This reference cannot be reused. Check the transaction details.",
      );
    if (
      (await tx.query("SELECT id FROM payments WHERE reference=$1", [ref])).rows
        .length
    )
      fail(
        409,
        "This reference cannot be reused. Check the transaction details.",
      );
    let upload;
    if (p.proof_id) {
      upload = await one(
        tx,
        `SELECT * FROM uploads WHERE id=$1 AND owner_id=$2 AND purpose='proof' AND payment_id IS NULL`,
        [p.proof_id, a.id],
      );
    }
    const late =
      new Date(e.registration_deadline).getTime() <= Date.now() ||
      !locked.reservation_expires_at ||
      new Date(locked.reservation_expires_at).getTime() <= Date.now();
    const paymentId = randomUUID();
    await tx.query(
      `INSERT INTO payments(id,entry_id,reference,payer_name,paid_at,amount,mode,status) VALUES($1,$2,$3,$4,$5,$6,$7,'submitted')`,
      [paymentId, id, ref, p.payer_name, p.paid_at, en.fee, mode],
    );
    await tx.query(
      "INSERT INTO payment_references(reference_hash,payment_id) VALUES($1,$2)",
      [fingerprint, paymentId],
    );
    if (upload)
      await tx.query("UPDATE uploads SET payment_id=$2 WHERE id=$1", [
        upload.id,
        paymentId,
      ]);
    await tx.query("UPDATE entries SET status=$2 WHERE id=$1", [
      id,
      late ? "needs_review_no_seat" : "awaiting_verification",
    ]);
    await tell(
      tx,
      id,
      late
        ? "Payment submitted after the reservation. Admin will check availability."
        : "Payment submitted. Awaiting admin verification.",
    );
    await audit(tx, a, "payment.submitted", id, { mode, late });
    return paymentId;
  });
}
export async function reviewPayment(
  db: Database,
  a: Account,
  pid: string,
  approve: boolean,
  reason: string,
) {
  return db.transaction(async (tx) => {
    const p = await one(tx, "SELECT * FROM payments WHERE id=$1", [pid]);
    const en = await one(tx, "SELECT * FROM entries WHERE id=$1", [p.entry_id]);
    const c = await one(tx, "SELECT * FROM categories WHERE id=$1 FOR UPDATE", [
      en.category_id,
    ]);
    const locked = await one(
      tx,
      "SELECT * FROM payments WHERE id=$1 FOR UPDATE",
      [pid],
    );
    const entry = await one(
      tx,
      "SELECT * FROM entries WHERE id=$1 FOR UPDATE",
      [en.id],
    );
    if (
      (
        await tx.query(
          "SELECT 1 FROM payment_corrections WHERE payment_id=$1 AND status='open'",
          [pid],
        )
      ).rows.length
    )
      fail(
        409,
        "Resolve the athlete's correction request before reviewing payment.",
      );
    if (locked.status !== "submitted")
      fail(409, "Payment has already been reviewed.");
    if (
      !["awaiting_verification", "needs_review_no_seat"].includes(entry.status)
    )
      fail(409, "Entry has changed. Refresh before reviewing.");
    if (approve) {
      const e = await one(tx, "SELECT status FROM events WHERE id=$1", [
        c.event_id,
      ]);
      if (["cancelled", "completed"].includes(e.status))
        fail(409, "This event no longer accepts entries.");
      if (c.draw_published)
        fail(
          409,
          "Draw is published. Resolve this late payment with a refund.",
        );
      await capacity(tx, c, en.id);
    }
    await tx.query(
      "UPDATE payments SET status=$2,reason=$3,reviewed_by=$4,reviewed_at=now() WHERE id=$1",
      [pid, approve ? "confirmed" : "rejected", reason, a.id],
    );
    await tx.query("UPDATE entries SET status=$2 WHERE id=$1", [
      en.id,
      approve ? "confirmed" : "payment_rejected",
    ]);
    await tell(
      tx,
      en.id,
      approve
        ? "Your entry is confirmed. See you on court."
        : "Payment review rejected: " + reason,
    );
    await audit(
      tx,
      a,
      approve ? "payment.confirmed" : "payment.rejected",
      pid,
      { reason },
    );
    return en.id;
  });
}
export async function refund(tx: Sql, en: any, reason: string) {
  const confirmed = await tx.query(
    `SELECT amount FROM payments WHERE entry_id=$1 AND status='confirmed'`,
    [en.id],
  );
  if (confirmed.rows[0])
    await tx.query(
      `INSERT INTO refunds(id,entry_id,amount,reason) VALUES($1,$2,$3,$4) ON CONFLICT(entry_id) DO NOTHING`,
      [randomUUID(), en.id, confirmed.rows[0].amount, reason],
    );
}
export async function withdraw(db: Database, a: Account, id: string) {
  return db.transaction(async (tx) => {
    const en = await member(tx, a, id);
    await one(tx, "SELECT id FROM categories WHERE id=$1 FOR UPDATE", [
      en.category_id,
    ]);
    const entry = await one(
      tx,
      "SELECT * FROM entries WHERE id=$1 FOR UPDATE",
      [id],
    );
    if (
      ["withdrawn", "cancelled", "withdrawal_requested"].includes(entry.status)
    )
      fail(409, "Withdrawal is already recorded.");
    if (
      (
        await tx.query(
          `SELECT 1 FROM matches WHERE (entry_a=$1 OR entry_b=$1) AND status IN ('completed','bye')`,
          [id],
        )
      ).rows.length
    )
      fail(409, "Contact admin: this entry already has a match result.");
    if (
      ["confirmed", "awaiting_verification", "needs_review_no_seat"].includes(
        entry.status,
      )
    ) {
      await tx.query(
        `UPDATE entries SET status='withdrawal_requested' WHERE id=$1`,
        [id],
      );
    } else
      await tx.query(`UPDATE entries SET status='withdrawn' WHERE id=$1`, [id]);
    await audit(tx, a, "withdrawal.requested", id);
    await tell(
      tx,
      id,
      "Withdrawal request recorded. Admin will review refund eligibility.",
    );
  });
}
export async function eventStatus(
  db: Database,
  a: Account,
  id: string,
  status: string,
) {
  return db.transaction(async (tx) => {
    const e = await one(tx, "SELECT * FROM events WHERE id=$1 FOR UPDATE", [
      id,
    ]);
    const allowed: Record<string, string[]> = {
      draft: ["published"],
      published: ["closed", "cancelled"],
      closed: ["published", "completed", "cancelled"],
      completed: [],
      cancelled: [],
    };
    if (!allowed[e.status]?.includes(status))
      fail(409, "This event status transition is not allowed.");
    if (status === "published") {
      const d = e.details || {};
      if (
        !d.description ||
        d.description.length < 10 ||
        !d.organizer_name ||
        !d.contact_phone ||
        !d.contact_email ||
        !d.address
      )
        fail(
          400,
          "Add a description, organiser name, phone, email and full venue address before publishing.",
        );
    }
    if (
      status === "published" &&
      new Date(e.registration_deadline).getTime() <= Date.now()
    )
      fail(400, "Set a future registration deadline before publishing.");
    if (status === "completed") {
      const cats = await tx.query(
        "SELECT * FROM categories WHERE event_id=$1 ORDER BY id FOR UPDATE",
        [id],
      );
      for (const c of cats.rows) {
        const remaining = await tx.query(
          `SELECT 1 FROM matches WHERE category_id=$1 AND status='pending'`,
          [c.id],
        );
        if (!c.draw_published || remaining.rows.length)
          fail(409, "Finish every category draw before completing the event.");
      }
      if (
        (
          await tx.query(
            `SELECT 1 FROM entries en JOIN categories c ON c.id=en.category_id WHERE c.event_id=$1 AND en.status IN ('awaiting_verification','needs_review_no_seat','withdrawal_requested')`,
            [id],
          )
        ).rows.length
      )
        fail(409, "Resolve pending entries before completing the event.");
    }
    if (status === "cancelled") {
      const cats = await tx.query(
        "SELECT id FROM categories WHERE event_id=$1 ORDER BY id FOR UPDATE",
        [id],
      );
      for (const c of cats.rows) {
        const entries = await tx.query(
          `SELECT * FROM entries WHERE category_id=$1 AND status NOT IN ('withdrawn','cancelled') FOR UPDATE`,
          [c.id],
        );
        for (const en of entries.rows) {
          await refund(tx, en, "Event cancelled: full entry refund");
          await tx.query(`UPDATE entries SET status='cancelled' WHERE id=$1`, [
            en.id,
          ]);
          await tell(
            tx,
            en.id,
            "The event was cancelled. Confirmed payments have a refund task.",
          );
        }
      }
      await tx.query(
        "DELETE FROM awards WHERE category_id IN (SELECT id FROM categories WHERE event_id=$1)",
        [id],
      );
    }
    await tx.query("UPDATE events SET status=$2 WHERE id=$1", [id, status]);
    await audit(tx, a, "event." + status, id);
  });
}
