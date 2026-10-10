// server/app.ts
import express from "express";
import { randomUUID as randomUUID3 } from "node:crypto";
import { z as z2 } from "zod";
import { put, get, del } from "@vercel/blob";
import sharp from "sharp";

// server/db.ts
import pg from "pg";
var pool;
var database = {
  async query(sql, params) {
    if (!process.env.DATABASE_URL)
      throw Object.assign(new Error("Database setup is required."), {
        status: 503,
        code: "SETUP_REQUIRED"
      });
    pool ??= new pg.Pool({
      connectionString: process.env.DATABASE_URL,
      max: 3,
      idleTimeoutMillis: 1e4,
      connectionTimeoutMillis: 1e4
    });
    return pool.query(sql, params);
  },
  async transaction(fn) {
    await this.query("SELECT 1");
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      const result = await fn(client);
      await client.query("COMMIT");
      return result;
    } catch (e) {
      await client.query("ROLLBACK");
      throw e;
    } finally {
      client.release();
    }
  }
};

// server/auth.ts
import { cert, getApps, initializeApp } from "firebase-admin/app";
import { getAuth } from "firebase-admin/auth";
function firebaseAdmin() {
  if (!getApps().length) {
    if (!process.env.FIREBASE_PROJECT_ID || !process.env.FIREBASE_CLIENT_EMAIL || !process.env.FIREBASE_PRIVATE_KEY)
      throw Object.assign(new Error("Authentication setup is required."), {
        status: 503,
        code: "SETUP_REQUIRED"
      });
    initializeApp({
      credential: cert({
        projectId: process.env.FIREBASE_PROJECT_ID,
        clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
        privateKey: process.env.FIREBASE_PRIVATE_KEY.replace(/\\n/g, "\n")
      })
    });
  }
  return getAuth();
}
async function authenticate(req) {
  const h = req.headers.authorization;
  if (!h?.startsWith("Bearer "))
    throw Object.assign(new Error("Sign in to continue."), { status: 401 });
  const t = await firebaseAdmin().verifyIdToken(h.slice(7), true);
  if (!t.email || !t.email_verified)
    throw Object.assign(new Error("Verify your email before continuing."), {
      status: 403
    });
  return { uid: t.uid, email: t.email, verified: !!t.email_verified };
}

// server/domain.ts
import { randomBytes, randomUUID, createHash } from "node:crypto";

// server/validation.ts
import { z } from "zod";

// shared/sports.ts
var sports = [
  "Badminton",
  "Tennis",
  "Pickleball",
  "Table Tennis",
  "Squash",
  "Cricket",
  "Football",
  "Basketball",
  "Volleyball",
  "Hockey",
  "Kabaddi",
  "Kho Kho",
  "Handball",
  "Rugby",
  "Futsal",
  "Chess",
  "Carrom",
  "Athletics",
  "Swimming",
  "Boxing",
  "Wrestling",
  "Archery",
  "Esports"
];
function normalizeSport(value) {
  const name = value.trim().replace(/\s+/g, " ");
  return sports.find((s) => s.toLowerCase() === name.toLowerCase()) || name.toLowerCase().replace(new RegExp("(^|\\s)\\p{L}", "gu"), (c) => c.toUpperCase());
}

// server/validation.ts
var text = z.string().trim().min(1).max(200);
var sport = z.string().trim().min(2).max(80).regex(/^[\p{L}\p{N}][\p{L}\p{N} &'().+-]*$/u, "Enter a sport name").transform(normalizeSport);
var levels = [
  "Beginner",
  "Amateur",
  "Competitive amateur",
  "Semi-professional",
  "Professional"
];
var optional = z.string().trim().max(250).default("");
var ranking = z.object({
  scope: z.enum(["state", "national"]),
  rank: z.number().int().positive().max(1e6),
  authority: text,
  category: text,
  date: z.iso.date(),
  player_id: optional,
  source: z.union([
    z.literal(""),
    z.url().refine((u) => u.startsWith("https://"), "Use an HTTPS source link")
  ]).default("")
});
var profileInput = z.object({
  kind: z.enum(["self", "junior"]),
  name: text,
  dob: z.iso.date(),
  gender: z.enum(["male", "female", "nonbinary", "prefer_not_to_say"]),
  state: text,
  city: text,
  phone: z.string().regex(/^\+?[0-9 ()-]{10,18}$/, "Enter a valid contact number"),
  guardian_name: optional,
  guardian_relationship: optional,
  consent: z.boolean().default(false),
  is_public: z.boolean().default(false),
  photo_url: z.string().max(1e3).nullable().optional(),
  academy: optional,
  coach: optional,
  goal: optional,
  sports: z.array(
    z.object({
      sport,
      level: z.enum(levels),
      years: z.number().int().min(0).max(90),
      primary_sport: z.boolean(),
      categories: z.array(z.enum(["singles", "doubles", "team"])).min(1),
      rankings: z.array(ranking).max(2).default([])
    })
  ).min(1).max(20)
}).superRefine((p, c) => {
  if (p.sports.filter((s) => s.primary_sport).length !== 1)
    c.addIssue({
      code: "custom",
      message: "Choose exactly one primary sport"
    });
  if (new Set(p.sports.map((s) => s.sport)).size !== p.sports.length)
    c.addIssue({
      code: "custom",
      message: "Each sport may be selected once"
    });
  for (const s of p.sports)
    if (new Set(s.rankings.map((r) => r.scope)).size !== s.rankings.length)
      c.addIssue({ code: "custom", message: "One claim per ranking scope" });
  if (p.kind === "junior" && (!p.consent || !p.guardian_name || !p.guardian_relationship))
    c.addIssue({
      code: "custom",
      message: "Guardian details and consent are required"
    });
});
var categoryInput = z.object({
  name: text,
  entry_type: z.enum(["singles", "doubles", "team"]),
  team_min: z.number().int().min(2).max(50).default(2),
  team_max: z.number().int().min(2).max(50).default(2),
  scoring_mode: z.enum(["sets", "score"]).default("sets"),
  league_points: z.object({
    win: z.number().int().min(0).max(100),
    draw: z.number().int().min(0).max(100),
    loss: z.number().int().min(0).max(100)
  }).default({ win: 3, draw: 1, loss: 0 }),
  format: z.enum(["knockout", "round_robin"]),
  capacity: z.number().int().min(2).max(128),
  fee: z.number().int().min(0).max(1e7),
  min_age: z.number().int().min(0).max(100),
  max_age: z.number().int().min(0).max(100),
  gender: z.enum(["any", "male", "female", "mixed"]),
  levels: z.array(z.enum(levels)).min(1),
  best_of: z.union([z.literal(1), z.literal(3), z.literal(5)]).default(3),
  school_required: z.boolean().default(false),
  points: z.object({
    winner: z.number().int().min(0).max(5e3),
    runner: z.number().int().min(0).max(5e3),
    semi: z.number().int().min(0).max(5e3),
    participation: z.number().int().min(0).max(5e3)
  }).default({ winner: 400, runner: 250, semi: 150, participation: 40 })
}).superRefine((v, c) => {
  if (v.team_max < v.team_min)
    c.addIssue({
      code: "custom",
      message: "Maximum roster size must be at least the minimum"
    });
  if (v.scoring_mode === "score" && v.best_of !== 1)
    c.addIssue({
      code: "custom",
      message: "Final-score matches must use best of 1"
    });
  if (v.max_age < v.min_age)
    c.addIssue({
      code: "custom",
      message: "Maximum age must be at least minimum age"
    });
  if (v.gender === "mixed" && v.entry_type === "singles")
    c.addIssue({
      code: "custom",
      message: "Mixed categories require doubles or teams"
    });
  if (v.format === "round_robin" && v.capacity > 24)
    c.addIssue({
      code: "custom",
      message: "Round-robin categories support up to 24 entries"
    });
});
var eventInput = z.object({
  name: text,
  sport,
  city: text,
  state: text,
  venue: text,
  details: z.object({
    description: z.string().trim().max(3e3).default(""),
    organizer_name: z.string().trim().max(200).default(""),
    contact_phone: z.string().trim().max(18).refine(
      (v) => !v || /^\+?[0-9 ()-]{10,18}$/.test(v),
      "Enter a valid organiser phone number"
    ).default(""),
    contact_email: z.union([z.literal(""), z.email()]).default(""),
    address: z.string().trim().max(500).default(""),
    map_url: z.union([
      z.literal(""),
      z.url().refine((v) => v.startsWith("https://"), "Use an HTTPS map link")
    ]).default(""),
    equipment: z.string().trim().max(2e3).default("")
  }).default({
    description: "",
    organizer_name: "",
    contact_phone: "",
    contact_email: "",
    address: "",
    map_url: "",
    equipment: ""
  }),
  starts_at: z.iso.datetime({ offset: true }),
  ends_at: z.iso.datetime({ offset: true }),
  registration_deadline: z.iso.datetime({ offset: true }),
  age_cutoff: z.iso.date(),
  withdrawal_deadline: z.iso.datetime({ offset: true }),
  refund_policy: z.string().trim().min(10).max(2e3),
  rules: z.string().trim().min(10).max(5e3),
  poster_url: z.string().max(1e3).default(""),
  categories: z.array(categoryInput).min(1).max(20)
}).superRefine((v, c) => {
  if (Date.parse(v.ends_at) < Date.parse(v.starts_at))
    c.addIssue({
      code: "custom",
      message: "Event end must follow event start"
    });
  if (Date.parse(v.registration_deadline) > Date.parse(v.starts_at) || Date.parse(v.withdrawal_deadline) > Date.parse(v.starts_at))
    c.addIssue({
      code: "custom",
      message: "Entry and withdrawal deadlines must precede the event"
    });
});
var entryInput = z.object({
  category_id: z.uuid(),
  athlete_id: z.uuid(),
  team_name: z.string().trim().min(2).max(100).optional(),
  roster_size: z.number().int().min(2).max(50).optional(),
  emergency_contact: text,
  school: optional,
  accepted_rules: z.literal(true),
  idempotency_key: z.uuid()
});
var paymentInput = z.object({
  reference: z.string().trim().regex(
    /^[a-zA-Z0-9-]{6,40}$/,
    "Reference must contain 6\u201340 letters, numbers or hyphens"
  ),
  payer_name: text,
  paid_at: z.iso.datetime({ offset: true }),
  proof_id: z.uuid().optional()
});
var resultInput = z.object({
  winner_id: z.uuid().nullable(),
  sets: z.array(
    z.tuple([
      z.number().int().min(0).max(1e5),
      z.number().int().min(0).max(1e5)
    ])
  ).max(5),
  outcome: z.enum([
    "played",
    "draw",
    "walkover",
    "withdrawal",
    "double_withdrawal"
  ]),
  version: z.number().int().min(0)
});
function ageAt(dob, cutoff) {
  const d = new Date(dob), c = new Date(cutoff);
  return c.getUTCFullYear() - d.getUTCFullYear() - Number(
    c.getUTCMonth() < d.getUTCMonth() || c.getUTCMonth() === d.getUTCMonth() && c.getUTCDate() < d.getUTCDate()
  );
}

// server/domain.ts
var AppError = class extends Error {
  constructor(status, message, code = "INVALID_REQUEST") {
    super(message);
    this.status = status;
    this.code = code;
  }
};
var fail = (status, message, code) => {
  throw new AppError(status, message, code);
};
var one = async (db, q, p = []) => {
  const r = await db.query(q, p);
  if (!r.rows[0]) fail(404, "Record not found.");
  return r.rows[0];
};
var j = (v) => JSON.stringify(v);
async function audit(db, a, action, id, details = {}) {
  await db.query(
    "INSERT INTO audit(id,account_id,action,entity_id,details) VALUES($1,$2,$3,$4,$5)",
    [randomUUID(), a.id, action, id, j(details)]
  );
}
async function tell(db, entryId, text2) {
  await db.query(
    `INSERT INTO notifications(id,account_id,text) SELECT gen_random_uuid(),x.owner_id,$2 FROM (SELECT owner_id FROM entries WHERE id=$1 UNION SELECT a.owner_id FROM entry_members m JOIN athletes a ON a.id=m.athlete_id WHERE m.entry_id=$1) x`,
    [entryId, text2]
  );
}
async function owned(db, a, id) {
  return one(db, "SELECT * FROM athletes WHERE id=$1 AND owner_id=$2", [
    id,
    a.id
  ]);
}
async function member(db, a, id) {
  return one(
    db,
    `SELECT e.* FROM entries e WHERE e.id=$1 AND (e.owner_id=$2 OR EXISTS(SELECT 1 FROM entry_members m JOIN athletes a ON a.id=m.athlete_id WHERE m.entry_id=e.id AND a.owner_id=$2))`,
    [id, a.id]
  );
}
async function profiles(db, a) {
  const r = await db.query(
    `SELECT a.*,COALESCE((SELECT jsonb_agg(s ORDER BY primary_sport DESC,sport) FROM athlete_sports s WHERE s.athlete_id=a.id),'[]') sports,COALESCE((SELECT jsonb_agg(r) FROM ranking_reviews r WHERE r.athlete_id=a.id),'[]') ranking_reviews,COALESCE((SELECT SUM(points) FROM awards WHERE athlete_id=a.id),0)::int points FROM athletes a WHERE owner_id=$1 ORDER BY created_at`,
    [a.id]
  );
  return r.rows;
}
async function saveProfile(db, a, input, id) {
  if (a.role !== "athlete")
    fail(403, "Athlete profiles are created and maintained by athletes only.");
  const p = profileInput.parse(input);
  const today = (/* @__PURE__ */ new Date()).toISOString().slice(0, 10);
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
      fail(400, "Years playing cannot exceed the athlete\u2019s age.");
    if (p.photo_url) {
      const photoId = p.photo_url.match(
        /^\/api\/v1\/me\/uploads\/([a-f0-9-]{36})$/
      )?.[1];
      if (!photoId) fail(400, "Use a private profile image uploaded to Rally.");
      await one(
        tx,
        "SELECT id FROM uploads WHERE id=$1 AND owner_id=$2 AND purpose='avatar'",
        [photoId, a.id]
      );
    }
    if (id && (await tx.query(
      `SELECT 1 FROM entry_members m JOIN entries e ON e.id=m.entry_id JOIN categories c ON c.id=e.category_id JOIN events ev ON ev.id=c.event_id WHERE m.athlete_id=$1 AND e.status IN ('partner_pending','awaiting_payment','awaiting_verification','confirmed') AND ev.status NOT IN ('completed','cancelled')`,
      [id]
    )).rows.length)
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
        p.consent ? /* @__PURE__ */ new Date() : null,
        p.is_public,
        p.photo_url || null,
        p.academy,
        p.coach,
        p.goal
      ]
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
          j(s.rankings)
        ]
      );
    await audit(tx, a, id ? "profile.updated" : "profile.created", pid);
    return pid;
  });
}
async function saveEvent(db, a, input, id) {
  if (a.role !== "admin") fail(403, "Only Admin can create tournaments.");
  const e = eventInput.parse(input);
  return db.transaction(async (tx) => {
    if (id) {
      await one(tx, "SELECT id FROM events WHERE id=$1 FOR UPDATE", [id]);
      if ((await tx.query(
        "SELECT 1 FROM entries en JOIN categories c ON c.id=en.category_id WHERE c.event_id=$1",
        [id]
      )).rows.length)
        fail(
          409,
          "An event with entries cannot have categories or eligibility rewritten. Manage schedules or cancel the event."
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
        j(e.details)
      ]
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
          j(c.league_points)
        ]
      );
    await audit(tx, a, id ? "event.updated" : "event.created", eid);
    return eid;
  });
}
async function expire(tx, categoryId) {
  await tx.query(
    `UPDATE entries SET status='expired' WHERE category_id=$1 AND status='awaiting_payment' AND reservation_expires_at<=now()`,
    [categoryId]
  );
}
async function capacity(tx, c, except) {
  await expire(tx, c.id);
  const r = await tx.query(
    `SELECT count(*)::int n FROM entries WHERE category_id=$1 AND ($2::uuid IS NULL OR id<>$2) AND status IN ('awaiting_payment','awaiting_verification','confirmed','withdrawal_requested')`,
    [c.id, except || null]
  );
  if (r.rows[0].n >= c.capacity)
    fail(409, "This category is full.", "CATEGORY_FULL");
}
async function eligibility(tx, c, e, p) {
  const s = await one(
    tx,
    "SELECT * FROM athlete_sports WHERE athlete_id=$1 AND sport=$2",
    [p.id, e.sport]
  );
  const cutoff = typeof e.age_cutoff === "string" ? e.age_cutoff : new Date(e.age_cutoff).toISOString().slice(0, 10);
  const years = ageAt(p.dob, cutoff);
  if (years < c.min_age || years > c.max_age)
    fail(400, "Athlete does not meet this category\u2019s age eligibility.");
  if (c.gender !== "any" && c.gender !== "mixed" && c.gender !== p.gender)
    fail(400, "Athlete does not meet this category\u2019s gender eligibility.");
  if (!c.levels.includes(s.level) || !s.categories.includes(c.entry_type))
    fail(400, "Sport level or preferred category does not match this entry.");
  if (p.kind === "junior" && !p.consent_at)
    fail(400, "Guardian consent is required.");
  if ((await tx.query(
    `SELECT 1 FROM entry_members m JOIN entries en ON en.id=m.entry_id WHERE m.athlete_id=$1 AND en.category_id=$2 AND en.status NOT IN ('expired','payment_rejected','withdrawn','cancelled')`,
    [p.id, c.id]
  )).rows.length)
    fail(409, "This athlete already has an entry in this category.");
}
var openEvent = (e) => {
  if (e.status !== "published" || new Date(e.registration_deadline).getTime() <= Date.now())
    fail(409, "Registration is closed.");
};
async function register(db, a, input) {
  if (a.role !== "athlete") fail(403, "Use an Athlete account to register.");
  const p = entryInput.parse(input);
  return db.transaction(async (tx) => {
    const c = await one(tx, "SELECT * FROM categories WHERE id=$1 FOR UPDATE", [
      p.category_id
    ]);
    const prior = await tx.query(
      "SELECT * FROM entries WHERE owner_id=$1 AND idempotency_key=$2",
      [a.id, p.idempotency_key]
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
    if (team && (!p.team_name || !target || target < c.team_min || target > c.team_max))
      fail(
        400,
        `Provide a team name and roster size from ${c.team_min} to ${c.team_max}.`
      );
    if (team && (await tx.query(
      "SELECT 1 FROM entries WHERE category_id=$1 AND lower(team_name)=lower($2) AND status NOT IN ('expired','withdrawn','cancelled','payment_rejected')",
      [c.id, p.team_name]
    )).rows.length)
      fail(409, "This team name already has an active entry in this category.");
    if (c.school_required && !p.school)
      fail(400, "School or college details are required.");
    await capacity(tx, c);
    const id = randomUUID(), doubles = c.entry_type === "doubles" || team;
    const expires = new Date(
      Math.min(
        Date.now() + 30 * 6e4,
        new Date(e.registration_deadline).getTime()
      )
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
        doubles ? new Date(
          Math.min(
            Date.now() + 24 * 36e5,
            new Date(e.registration_deadline).getTime()
          )
        ) : null,
        p.emergency_contact,
        p.school,
        p.idempotency_key
      ]
    );
    await tx.query(
      "INSERT INTO entry_members(entry_id,athlete_id) VALUES($1,$2)",
      [id, athlete.id]
    );
    await tx.query(
      "UPDATE entries SET team_name=$2,roster_size=$3 WHERE id=$1",
      [id, team ? p.team_name : null, target]
    );
    if (!doubles && c.fee === 0)
      await tx.query(`UPDATE entries SET status='confirmed' WHERE id=$1`, [id]);
    await audit(tx, a, "entry.created", id);
    return one(tx, "SELECT * FROM entries WHERE id=$1", [id]);
  });
}
async function acceptPartner(db, a, token, athleteId) {
  if (a.role !== "athlete")
    fail(403, "Only athletes or their guardians can join a roster.");
  return db.transaction(async (tx) => {
    const en = await one(tx, "SELECT * FROM entries WHERE invite_token=$1", [
      token
    ]);
    const c = await one(tx, "SELECT * FROM categories WHERE id=$1 FOR UPDATE", [
      en.category_id
    ]);
    const locked = await one(
      tx,
      "SELECT * FROM entries WHERE id=$1 FOR UPDATE",
      [en.id]
    );
    if (!["doubles", "team"].includes(c.entry_type))
      fail(409, "This category does not accept invitations.");
    if (locked.status !== "partner_pending" || new Date(locked.invite_expires_at).getTime() <= Date.now())
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
      [en.id]
    );
    if (first.id === p.id) fail(400, "Choose a different partner.");
    if (c.entry_type === "doubles" && c.gender === "mixed" && (/* @__PURE__ */ new Set([first.gender, p.gender])).size !== 2)
      fail(400, "Mixed doubles requires one male and one female athlete.");
    if (c.entry_type === "doubles" && c.gender === "mixed" && ![first.gender, p.gender].every((g) => ["male", "female"].includes(g)))
      fail(400, "Mixed doubles requires one male and one female athlete.");
    const count = (await tx.query(
      "SELECT count(*)::int n FROM entry_members WHERE entry_id=$1",
      [en.id]
    )).rows[0].n;
    const target = c.entry_type === "team" ? locked.roster_size : 2;
    if (count >= target) fail(409, "This roster is already complete.");
    if (c.entry_type === "team" && c.gender === "mixed" && count + 1 === target) {
      const genders = (await tx.query(
        "SELECT a.gender FROM entry_members m JOIN athletes a ON a.id=m.athlete_id WHERE m.entry_id=$1",
        [en.id]
      )).rows.map((row) => row.gender).concat(p.gender);
      if (!genders.includes("male") || !genders.includes("female"))
        fail(
          400,
          "Mixed teams require at least one male and one female athlete."
        );
    }
    if (count + 1 === target) await capacity(tx, c);
    await tx.query(
      "INSERT INTO entry_members(entry_id,athlete_id) VALUES($1,$2)",
      [en.id, p.id]
    );
    if (count + 1 < target) {
      await audit(tx, a, "team.member_accepted", en.id);
      await tell(
        tx,
        en.id,
        `A teammate joined ${locked.team_name}. ${count + 1} of ${target} players accepted.`
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
            Date.now() + 30 * 6e4,
            new Date(e.registration_deadline).getTime()
          )
        )
      ]
    );
    await audit(tx, a, "partner.accepted", en.id);
    await tell(
      tx,
      en.id,
      c.entry_type === "team" ? "Your team roster is complete. Your entry is ready." : "Your doubles partner accepted. Your entry is ready."
    );
    return en.id;
  });
}
async function submitPayment(db, a, id, input, mode) {
  const p = paymentInput.parse(input);
  if (Date.parse(p.paid_at) > Date.now() + 3e5)
    fail(400, "Payment time cannot be in the future.");
  return db.transaction(async (tx) => {
    const en = await member(tx, a, id);
    const c = await one(tx, "SELECT * FROM categories WHERE id=$1 FOR UPDATE", [
      en.category_id
    ]);
    const locked = await one(
      tx,
      "SELECT * FROM entries WHERE id=$1 FOR UPDATE",
      [id]
    );
    if (!["awaiting_payment", "expired", "payment_rejected"].includes(
      locked.status
    ))
      fail(409, "This entry cannot accept a new payment submission.");
    const e = await one(tx, "SELECT * FROM events WHERE id=$1", [c.event_id]);
    if (["cancelled", "completed", "draft"].includes(e.status))
      fail(409, "This event cannot accept payment submissions.");
    if (en.fee === 0)
      fail(400, "Free entries do not need a payment submission.");
    if (mode === "test" && !p.reference.toUpperCase().startsWith("TEST-"))
      fail(
        400,
        "Use a TEST- reference. Do not transfer real money during testing."
      );
    if (mode === "live" && p.reference.toUpperCase().startsWith("TEST-"))
      fail(400, "A live payment needs the bank reference.");
    const ref = p.reference.toUpperCase();
    const fingerprint = createHash("sha256").update(ref).digest("hex");
    if ((await tx.query(
      "SELECT 1 FROM payment_references WHERE reference_hash=$1",
      [fingerprint]
    )).rows.length)
      fail(
        409,
        "This reference cannot be reused. Check the transaction details."
      );
    if ((await tx.query("SELECT id FROM payments WHERE reference=$1", [ref])).rows.length)
      fail(
        409,
        "This reference cannot be reused. Check the transaction details."
      );
    let upload;
    if (p.proof_id) {
      upload = await one(
        tx,
        `SELECT * FROM uploads WHERE id=$1 AND owner_id=$2 AND purpose='proof' AND payment_id IS NULL`,
        [p.proof_id, a.id]
      );
    }
    const late = new Date(e.registration_deadline).getTime() <= Date.now() || !locked.reservation_expires_at || new Date(locked.reservation_expires_at).getTime() <= Date.now();
    const paymentId = randomUUID();
    await tx.query(
      `INSERT INTO payments(id,entry_id,reference,payer_name,paid_at,amount,mode,status) VALUES($1,$2,$3,$4,$5,$6,$7,'submitted')`,
      [paymentId, id, ref, p.payer_name, p.paid_at, en.fee, mode]
    );
    await tx.query(
      "INSERT INTO payment_references(reference_hash,payment_id) VALUES($1,$2)",
      [fingerprint, paymentId]
    );
    if (upload)
      await tx.query("UPDATE uploads SET payment_id=$2 WHERE id=$1", [
        upload.id,
        paymentId
      ]);
    await tx.query("UPDATE entries SET status=$2 WHERE id=$1", [
      id,
      late ? "needs_review_no_seat" : "awaiting_verification"
    ]);
    await tell(
      tx,
      id,
      late ? "Payment submitted after the reservation. Admin will check availability." : "Payment submitted. Awaiting admin verification."
    );
    await audit(tx, a, "payment.submitted", id, { mode, late });
    return paymentId;
  });
}
async function reviewPayment(db, a, pid, approve, reason2) {
  return db.transaction(async (tx) => {
    const p = await one(tx, "SELECT * FROM payments WHERE id=$1", [pid]);
    const en = await one(tx, "SELECT * FROM entries WHERE id=$1", [p.entry_id]);
    const c = await one(tx, "SELECT * FROM categories WHERE id=$1 FOR UPDATE", [
      en.category_id
    ]);
    const locked = await one(
      tx,
      "SELECT * FROM payments WHERE id=$1 FOR UPDATE",
      [pid]
    );
    const entry = await one(
      tx,
      "SELECT * FROM entries WHERE id=$1 FOR UPDATE",
      [en.id]
    );
    if ((await tx.query(
      "SELECT 1 FROM payment_corrections WHERE payment_id=$1 AND status='open'",
      [pid]
    )).rows.length)
      fail(
        409,
        "Resolve the athlete's correction request before reviewing payment."
      );
    if (locked.status !== "submitted")
      fail(409, "Payment has already been reviewed.");
    if (!["awaiting_verification", "needs_review_no_seat"].includes(entry.status))
      fail(409, "Entry has changed. Refresh before reviewing.");
    if (approve) {
      const e = await one(tx, "SELECT status FROM events WHERE id=$1", [
        c.event_id
      ]);
      if (["cancelled", "completed"].includes(e.status))
        fail(409, "This event no longer accepts entries.");
      if (c.draw_published)
        fail(
          409,
          "Draw is published. Resolve this late payment with a refund."
        );
      await capacity(tx, c, en.id);
    }
    await tx.query(
      "UPDATE payments SET status=$2,reason=$3,reviewed_by=$4,reviewed_at=now() WHERE id=$1",
      [pid, approve ? "confirmed" : "rejected", reason2, a.id]
    );
    await tx.query("UPDATE entries SET status=$2 WHERE id=$1", [
      en.id,
      approve ? "confirmed" : "payment_rejected"
    ]);
    await tell(
      tx,
      en.id,
      approve ? "Your entry is confirmed. See you on court." : "Payment review rejected: " + reason2
    );
    await audit(
      tx,
      a,
      approve ? "payment.confirmed" : "payment.rejected",
      pid,
      { reason: reason2 }
    );
    return en.id;
  });
}
async function refund(tx, en, reason2) {
  const confirmed = await tx.query(
    `SELECT amount FROM payments WHERE entry_id=$1 AND status='confirmed'`,
    [en.id]
  );
  if (confirmed.rows[0])
    await tx.query(
      `INSERT INTO refunds(id,entry_id,amount,reason) VALUES($1,$2,$3,$4) ON CONFLICT(entry_id) DO NOTHING`,
      [randomUUID(), en.id, confirmed.rows[0].amount, reason2]
    );
}
async function withdraw(db, a, id) {
  return db.transaction(async (tx) => {
    const en = await member(tx, a, id);
    await one(tx, "SELECT id FROM categories WHERE id=$1 FOR UPDATE", [
      en.category_id
    ]);
    const entry = await one(
      tx,
      "SELECT * FROM entries WHERE id=$1 FOR UPDATE",
      [id]
    );
    if (["withdrawn", "cancelled", "withdrawal_requested"].includes(entry.status))
      fail(409, "Withdrawal is already recorded.");
    if ((await tx.query(
      `SELECT 1 FROM matches WHERE (entry_a=$1 OR entry_b=$1) AND status IN ('completed','bye')`,
      [id]
    )).rows.length)
      fail(409, "Contact admin: this entry already has a match result.");
    if (["confirmed", "awaiting_verification", "needs_review_no_seat"].includes(
      entry.status
    )) {
      await tx.query(
        `UPDATE entries SET status='withdrawal_requested' WHERE id=$1`,
        [id]
      );
    } else
      await tx.query(`UPDATE entries SET status='withdrawn' WHERE id=$1`, [id]);
    await audit(tx, a, "withdrawal.requested", id);
    await tell(
      tx,
      id,
      "Withdrawal request recorded. Admin will review refund eligibility."
    );
  });
}
async function eventStatus(db, a, id, status) {
  return db.transaction(async (tx) => {
    const e = await one(tx, "SELECT * FROM events WHERE id=$1 FOR UPDATE", [
      id
    ]);
    const allowed = {
      draft: ["published"],
      published: ["closed", "cancelled"],
      closed: ["published", "completed", "cancelled"],
      completed: [],
      cancelled: []
    };
    if (!allowed[e.status]?.includes(status))
      fail(409, "This event status transition is not allowed.");
    if (status === "published") {
      const d = e.details || {};
      if (!d.description || d.description.length < 10 || !d.organizer_name || !d.contact_phone || !d.contact_email || !d.address)
        fail(
          400,
          "Add a description, organiser name, phone, email and full venue address before publishing."
        );
    }
    if (status === "published" && new Date(e.registration_deadline).getTime() <= Date.now())
      fail(400, "Set a future registration deadline before publishing.");
    if (status === "completed") {
      const cats = await tx.query(
        "SELECT * FROM categories WHERE event_id=$1 ORDER BY id FOR UPDATE",
        [id]
      );
      for (const c of cats.rows) {
        const remaining = await tx.query(
          `SELECT 1 FROM matches WHERE category_id=$1 AND status='pending'`,
          [c.id]
        );
        if (!c.draw_published || remaining.rows.length)
          fail(409, "Finish every category draw before completing the event.");
      }
      if ((await tx.query(
        `SELECT 1 FROM entries en JOIN categories c ON c.id=en.category_id WHERE c.event_id=$1 AND en.status IN ('awaiting_verification','needs_review_no_seat','withdrawal_requested')`,
        [id]
      )).rows.length)
        fail(409, "Resolve pending entries before completing the event.");
    }
    if (status === "cancelled") {
      const cats = await tx.query(
        "SELECT id FROM categories WHERE event_id=$1 ORDER BY id FOR UPDATE",
        [id]
      );
      for (const c of cats.rows) {
        const entries = await tx.query(
          `SELECT * FROM entries WHERE category_id=$1 AND status NOT IN ('withdrawn','cancelled') FOR UPDATE`,
          [c.id]
        );
        for (const en of entries.rows) {
          await refund(tx, en, "Event cancelled: full entry refund");
          await tx.query(`UPDATE entries SET status='cancelled' WHERE id=$1`, [
            en.id
          ]);
          await tell(
            tx,
            en.id,
            "The event was cancelled. Confirmed payments have a refund task."
          );
        }
      }
      await tx.query(
        "DELETE FROM awards WHERE category_id IN (SELECT id FROM categories WHERE event_id=$1)",
        [id]
      );
    }
    await tx.query("UPDATE events SET status=$2 WHERE id=$1", [id, status]);
    await audit(tx, a, "event." + status, id);
  });
}

// server/competition.ts
import { randomUUID as randomUUID2 } from "node:crypto";
function seedSlots(size) {
  let slots = [1, 2];
  while (slots.length < size) {
    const sum = slots.length * 2 + 1;
    slots = slots.flatMap((n) => [n, sum - n]);
  }
  return slots;
}
function roundRobin(ids) {
  const ring = [...ids];
  if (ring.length % 2) ring.push(null);
  const fixtures = [];
  for (let round = 1; round < ring.length; round++) {
    for (let i = 0; i < ring.length / 2; i++) {
      const a = ring[i], b = ring[ring.length - 1 - i];
      if (a && b) fixtures.push({ round, a, b });
    }
    ring.splice(1, 0, ring.pop());
  }
  return fixtures;
}
async function draw(db, a, id, seeds) {
  return db.transaction(async (tx) => {
    const c = await one(tx, "SELECT * FROM categories WHERE id=$1 FOR UPDATE", [
      id
    ]);
    const e = await one(tx, "SELECT * FROM events WHERE id=$1", [c.event_id]);
    if (!["published", "closed"].includes(e.status))
      fail(409, "Draws require an active event.");
    await expire(tx, id);
    if ((await tx.query(
      "SELECT 1 FROM entries WHERE category_id=$1 AND status='awaiting_payment'",
      [id]
    )).rows.length)
      fail(
        409,
        "Wait for active payment reservations to expire or resolve them before drawing."
      );
    if ((await tx.query(
      `SELECT 1 FROM entries WHERE category_id=$1 AND status IN ('awaiting_verification','needs_review_no_seat','withdrawal_requested')`,
      [id]
    )).rows.length)
      fail(409, "Review pending entries before publishing draws.");
    if ((await tx.query(
      `SELECT 1 FROM matches WHERE category_id=$1 AND status='completed'`,
      [id]
    )).rows.length)
      fail(409, "A draw with match results cannot be regenerated.");
    const entries = (await tx.query(
      `SELECT en.id,COALESCE((SELECT sum(w.points) FROM entry_members m JOIN awards w ON w.athlete_id=m.athlete_id JOIN categories ac ON ac.id=w.category_id JOIN events ae ON ae.id=ac.event_id WHERE m.entry_id=en.id AND ae.sport=$2),0) seed FROM entries en WHERE category_id=$1 AND status='confirmed' ORDER BY seed DESC,created_at,id`,
      [id, e.sport]
    )).rows;
    let ids = entries.map((r) => r.id);
    if (ids.length < 2)
      fail(409, "At least two confirmed entries are required.");
    if (seeds) {
      if (seeds.length !== ids.length || new Set(seeds).size !== ids.length || seeds.some((s) => !ids.includes(s)))
        fail(400, "Seeds must include every confirmed entry exactly once.");
      ids = seeds;
    }
    await tx.query("UPDATE matches SET next_match=NULL WHERE category_id=$1", [
      id
    ]);
    await tx.query(
      "DELETE FROM disputes WHERE match_id IN (SELECT id FROM matches WHERE category_id=$1)",
      [id]
    );
    await tx.query("DELETE FROM matches WHERE category_id=$1", [id]);
    await tx.query("DELETE FROM awards WHERE category_id=$1", [id]);
    const fixtures = [];
    if (c.format === "round_robin") {
      let position = 0;
      for (const f of roundRobin(ids))
        fixtures.push({
          id: randomUUID2(),
          round: f.round,
          position: ++position,
          entry_a: f.a,
          entry_b: f.b,
          next_match: null,
          next_slot: null,
          winner_id: null,
          status: "pending"
        });
    } else {
      const size = 2 ** Math.ceil(Math.log2(ids.length)), rounds = Math.log2(size), rows = [];
      for (let r = 0; r < rounds; r++)
        rows.push(
          Array.from({ length: size / 2 ** (r + 1) }, () => randomUUID2())
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
            next_slot: r < rounds - 1 ? position % 2 ? "b" : "a" : null,
            winner_id: null,
            status: "pending"
          });
      const byId = new Map(fixtures.map((m) => [m.id, m]));
      for (const m of fixtures.filter((m2) => m2.round === 1))
        if (!m.entry_a || !m.entry_b) {
          m.winner_id = m.entry_a || m.entry_b;
          m.status = "bye";
          if (m.next_match)
            byId.get(m.next_match)["entry_" + m.next_slot] = m.winner_id;
        }
    }
    await tx.query(
      `INSERT INTO matches(id,category_id,round,position,entry_a,entry_b,next_match,next_slot,winner_id,status) SELECT id,$2,round,position,entry_a,entry_b,next_match,next_slot,winner_id,status FROM jsonb_to_recordset($1::jsonb) AS x(id uuid,round integer,position integer,entry_a uuid,entry_b uuid,next_match uuid,next_slot text,winner_id uuid,status text)`,
      [JSON.stringify(fixtures), id]
    );
    await tx.query("UPDATE categories SET draw_published=true WHERE id=$1", [
      id
    ]);
    await audit(tx, a, "draw.published", id, { seeds: ids, format: c.format });
    await tx.query(
      `INSERT INTO notifications(id,account_id,text) SELECT gen_random_uuid(),x.owner_id,$2 FROM (SELECT DISTINCT a.owner_id FROM entry_members em JOIN athletes a ON a.id=em.athlete_id WHERE em.entry_id=ANY($1::uuid[])) x`,
      [ids, "Draw published for " + e.name + ". Check your fixtures."]
    );
    return (await tx.query(
      "SELECT * FROM matches WHERE category_id=$1 ORDER BY round,position",
      [id]
    )).rows;
  });
}
function scoreValid(s, m, bestOf, category) {
  if (s.outcome === "draw") {
    if (category.format !== "round_robin" || category.scoring_mode !== "score" || s.winner_id !== null || s.sets.length !== 1 || s.sets[0][0] !== s.sets[0][1])
      fail(
        400,
        "Draws require a tied final score in a round-robin category, with no winner."
      );
    return;
  }
  if (s.outcome === "double_withdrawal") {
    if (s.winner_id !== null)
      fail(400, "Double withdrawal cannot declare a winner.");
    return;
  }
  if (![m.entry_a, m.entry_b].includes(s.winner_id) || !s.winner_id)
    fail(400, "Winner must be a participant in this match.");
  if (s.outcome !== "played") return;
  if (s.sets.length === 0 || s.sets.length > bestOf || s.sets.some((v) => v[0] === v[1]))
    fail(400, "Enter valid, untied set scores within the match format.");
  const need = Math.floor(bestOf / 2) + 1;
  let a = 0, b = 0;
  for (let i = 0; i < s.sets.length; i++) {
    if (a === need || b === need)
      fail(400, "Scores contain sets after the match was decided.");
    s.sets[i][0] > s.sets[i][1] ? a++ : b++;
  }
  if (Math.max(a, b) !== need || (a > b ? m.entry_a : m.entry_b) !== s.winner_id)
    fail(400, "Set scores do not match the declared winner.");
}
async function standings(tx, category) {
  const c = await one(
    tx,
    "SELECT scoring_mode,league_points FROM categories WHERE id=$1",
    [category]
  );
  const entries = (await tx.query(
    `SELECT id,team_name FROM entries WHERE id IN (SELECT entry_a FROM matches WHERE category_id=$1 UNION SELECT entry_b FROM matches WHERE category_id=$1) ORDER BY created_at,id`,
    [category]
  )).rows;
  const table = new Map(
    entries.map((r) => [
      r.id,
      {
        entry_id: r.id,
        label: r.team_name || "Entry " + r.id.slice(0, 8),
        wins: 0,
        losses: 0,
        draws: 0,
        table_points: 0,
        set_difference: 0,
        point_difference: 0
      }
    ])
  );
  const matches = (await tx.query(
    `SELECT * FROM matches WHERE category_id=$1 AND status='completed' ORDER BY round,position`,
    [category]
  )).rows;
  for (const m of matches) {
    const tied = m.score?.outcome === "draw";
    if (!m.winner_id && !tied) continue;
    for (const id of [m.entry_a, m.entry_b]) {
      const r = table.get(id);
      if (!r) continue;
      r.wins += Number(m.winner_id === id);
      r.losses += Number(!tied && m.winner_id !== id);
      r.draws += Number(tied);
      r.table_points += tied ? c.league_points.draw : m.winner_id === id ? c.league_points.win : c.league_points.loss;
      for (const [a, b] of m.score?.sets || []) {
        const d = id === m.entry_a ? a - b : b - a;
        r.point_difference += d;
        r.set_difference += Math.sign(d);
      }
    }
  }
  return [...table.values()].sort(
    (a, b) => (c.scoring_mode === "score" ? b.table_points - a.table_points : b.wins - a.wins) || (c.scoring_mode === "score" ? 0 : b.set_difference - a.set_difference) || b.point_difference - a.point_difference || a.entry_id.localeCompare(b.entry_id)
  );
}
async function recalculate(tx, c) {
  await tx.query("DELETE FROM awards WHERE category_id=$1", [c.id]);
  const ms = (await tx.query(
    "SELECT * FROM matches WHERE category_id=$1 ORDER BY round DESC,position",
    [c.id]
  )).rows;
  if (!ms.length || ms.some((m) => m.status === "pending")) return;
  const points = c.points;
  const placements = /* @__PURE__ */ new Map();
  const entries = (await tx.query(
    "SELECT id FROM entries WHERE id IN (SELECT entry_a FROM matches WHERE category_id=$1 UNION SELECT entry_b FROM matches WHERE category_id=$1)",
    [c.id]
  )).rows;
  for (const e of entries)
    placements.set(e.id, {
      placement: "Participation",
      points: points.participation
    });
  if (c.format === "round_robin") {
    const ranks = await standings(tx, c.id);
    ranks.forEach(
      (r, i) => placements.set(r.entry_id, {
        placement: i === 0 ? "Winner" : i === 1 ? "Runner-up" : "Participation",
        points: i === 0 ? points.winner : i === 1 ? points.runner : points.participation
      })
    );
  } else {
    const final = ms[0];
    if (final.winner_id) {
      placements.set(final.winner_id, {
        placement: "Winner",
        points: points.winner
      });
      const loser = [final.entry_a, final.entry_b].find(
        (id) => id && id !== final.winner_id
      );
      if (loser)
        placements.set(loser, {
          placement: "Runner-up",
          points: points.runner
        });
    }
    for (const m of ms.filter((m2) => m2.round === final.round - 1))
      for (const loser of [m.entry_a, m.entry_b].filter(
        (x) => x && x !== m.winner_id
      ))
        placements.set(loser, {
          placement: "Semifinalist",
          points: points.semi
        });
  }
  const awarded = [...placements].map(([entry_id, p]) => ({ entry_id, ...p }));
  await tx.query(
    `INSERT INTO awards(category_id,athlete_id,points,placement) SELECT $2,em.athlete_id,x.points,x.placement FROM jsonb_to_recordset($1::jsonb) AS x(entry_id uuid,points integer,placement text) JOIN entry_members em ON em.entry_id=x.entry_id`,
    [JSON.stringify(awarded), c.id]
  );
}
async function recordResult(db, a, id, input) {
  const s = resultInput.parse(input);
  return db.transaction(async (tx) => {
    const initial = await one(tx, "SELECT * FROM matches WHERE id=$1", [id]);
    const c = await one(tx, "SELECT * FROM categories WHERE id=$1 FOR UPDATE", [
      initial.category_id
    ]);
    const e = await one(tx, "SELECT status FROM events WHERE id=$1", [
      c.event_id
    ]);
    if (e.status === "cancelled")
      fail(409, "Results cannot be changed for cancelled events.");
    const m = await one(tx, "SELECT * FROM matches WHERE id=$1 FOR UPDATE", [
      id
    ]);
    if (m.version !== s.version)
      fail(
        409,
        "This result changed. Refresh before saving.",
        "VERSION_CONFLICT"
      );
    if (m.status === "bye" || !m.entry_a || !m.entry_b)
      fail(409, "This match does not have two participants.");
    scoreValid(s, m, c.best_of, c);
    if (m.next_match && m.winner_id !== s.winner_id) {
      const next = await one(tx, "SELECT * FROM matches WHERE id=$1", [
        m.next_match
      ]);
      if (next.status !== "pending")
        fail(
          409,
          "Correct downstream results first; this winner has already advanced."
        );
      await tx.query(
        `UPDATE matches SET ${m.next_slot === "a" ? "entry_a" : "entry_b"}=$2,version=version+1 WHERE id=$1`,
        [m.next_match, s.winner_id]
      );
    }
    await tx.query(
      `UPDATE matches SET winner_id=$2,score=$3,status='completed',version=version+1 WHERE id=$1`,
      [id, s.winner_id, JSON.stringify(s)]
    );
    let nextId = m.next_match;
    while (nextId) {
      const next = await one(tx, "SELECT * FROM matches WHERE id=$1", [nextId]);
      const feeders = (await tx.query("SELECT * FROM matches WHERE next_match=$1", [next.id])).rows;
      if (next.status !== "pending" || feeders.some((f) => f.status === "pending") || next.entry_a && next.entry_b)
        break;
      const win = next.entry_a || next.entry_b;
      await tx.query(
        `UPDATE matches SET winner_id=$2,status='bye',version=version+1 WHERE id=$1`,
        [next.id, win]
      );
      if (next.next_match)
        await tx.query(
          `UPDATE matches SET ${next.next_slot === "a" ? "entry_a" : "entry_b"}=$2 WHERE id=$1`,
          [next.next_match, win]
        );
      nextId = next.next_match;
    }
    await recalculate(tx, c);
    await audit(
      tx,
      a,
      m.status === "completed" ? "result.corrected" : "result.published",
      id,
      { previous: m.score, result: s }
    );
    for (const entry of [m.entry_a, m.entry_b])
      await tell(
        tx,
        entry,
        "A verified result was published. View your match history."
      );
  });
}

// server/app.ts
var uuid = z2.uuid();
var reason = z2.string().trim().min(3).max(1e3);
function createApp(options = {}) {
  const app = express(), db = options.db || database, verify = options.authenticate || authenticate, storage = options.storage || { put, get, del };
  app.disable("x-powered-by");
  app.use((req, res, next) => {
    const route = new URL(req.url, "http://localhost").searchParams.get(
      "route"
    );
    if (route) req.url = "/api/v1/" + route;
    res.setHeader("Cache-Control", "no-store");
    res.setHeader("X-Content-Type-Options", "nosniff");
    next();
  });
  app.use(express.json({ limit: "3mb" }));
  const endpoint = (fn) => async (req, res, next) => {
    try {
      const result = await fn(req, res);
      if (!res.headersSent) res.json({ data: result });
    } catch (e) {
      next(e);
    }
  };
  const authenticateRequest = async (req, res, next) => {
    try {
      const i = await verify(req);
      if (!i.verified) fail(403, "Verify your email to continue.");
      const allow = (process.env.ADMIN_EMAILS || "").toLowerCase().split(",").map((v) => v.trim());
      const a = await one(
        db,
        `INSERT INTO accounts(id,firebase_uid,email,role) VALUES($1,$2,$3,$4) ON CONFLICT(firebase_uid) DO UPDATE SET email=CASE WHEN accounts.deleted_at IS NULL THEN excluded.email ELSE '' END RETURNING *`,
        [
          randomUUID3(),
          i.uid,
          i.email,
          allow.includes(i.email.toLowerCase()) ? "admin" : "athlete"
        ]
      );
      if (a.deleted_at && !(req.method === "DELETE" && req.originalUrl === "/api/v1/me/account"))
        fail(403, "This account has been deleted.");
      req.account = a;
      next();
    } catch (e) {
      next(e);
    }
  };
  const account = (req) => req.account;
  const admin = (req, res, next) => {
    if (account(req).role !== "admin")
      return next(new AppError(403, "Admin access is required."));
    next();
  };
  app.get(
    "/api/v1/health",
    endpoint(async () => ({
      status: process.env.DATABASE_URL ? "configured" : "setup_required",
      payments_mode: process.env.PAYMENTS_MODE === "live" && process.env.COMMERCIAL_LAUNCH_ENABLED === "true" ? "live" : "test",
      database_configured: !!options.db || !!process.env.DATABASE_URL,
      auth_configured: !!options.authenticate || !!(process.env.FIREBASE_PROJECT_ID && process.env.FIREBASE_CLIENT_EMAIL && process.env.FIREBASE_PRIVATE_KEY)
    }))
  );
  app.get(
    "/api/v1/events",
    endpoint(async (req) => {
      const rows = (await db.query(
        `SELECT e.*,COALESCE((SELECT jsonb_agg(c ORDER BY c.name) FROM categories c WHERE c.event_id=e.id),'[]') categories FROM events e WHERE status<>'draft' ORDER BY starts_at`
      )).rows;
      return rows.filter(
        (e) => (!req.query.sport || e.sport === req.query.sport) && (!req.query.city || e.city === req.query.city)
      );
    })
  );
  app.get(
    "/api/v1/events/:id",
    endpoint(async (req) => {
      const e = await one(
        db,
        `SELECT * FROM events WHERE id=$1 AND status<>'draft'`,
        [uuid.parse(req.params.id)]
      );
      const categories = (await db.query(
        `SELECT c.*,GREATEST(0,c.capacity-(SELECT count(*) FROM entries en WHERE en.category_id=c.id AND (en.status IN ('awaiting_verification','confirmed','withdrawal_requested') OR (en.status='awaiting_payment' AND en.reservation_expires_at>now()))))::int remaining FROM categories c WHERE event_id=$1 ORDER BY name`,
        [e.id]
      )).rows;
      return {
        ...e,
        categories,
        announcements: (await db.query(
          "SELECT * FROM announcements WHERE event_id=$1 ORDER BY created_at DESC",
          [e.id]
        )).rows
      };
    })
  );
  app.get(
    "/api/v1/events/:id/matches",
    endpoint(async (req) => {
      await one(db, `SELECT id FROM events WHERE id=$1 AND status<>'draft'`, [
        uuid.parse(req.params.id)
      ]);
      return (await db.query(
        `SELECT m.*,c.name category_name,c.format,c.scoring_mode, COALESCE((SELECT team_name FROM entries WHERE id=m.entry_a),(SELECT string_agg(CASE WHEN a.is_public AND a.kind='self' THEN a.name ELSE 'Player '||left(a.id::text,4) END,' / ' ORDER BY a.id) FROM entry_members em JOIN athletes a ON a.id=em.athlete_id WHERE em.entry_id=m.entry_a)) label_a,COALESCE((SELECT team_name FROM entries WHERE id=m.entry_b),(SELECT string_agg(CASE WHEN a.is_public AND a.kind='self' THEN a.name ELSE 'Player '||left(a.id::text,4) END,' / ' ORDER BY a.id) FROM entry_members em JOIN athletes a ON a.id=em.athlete_id WHERE em.entry_id=m.entry_b)) label_b FROM matches m JOIN categories c ON c.id=m.category_id WHERE c.event_id=$1 AND c.draw_published ORDER BY c.name,round,position`,
        [req.params.id]
      )).rows;
    })
  );
  app.get(
    "/api/v1/categories/:id/standings",
    endpoint(async (req) => {
      await one(
        db,
        `SELECT c.id FROM categories c JOIN events e ON e.id=c.event_id WHERE c.id=$1 AND e.status<>'draft' AND c.draw_published`,
        [uuid.parse(req.params.id)]
      );
      return standings(db, String(req.params.id));
    })
  );
  app.get(
    "/api/v1/rankings",
    endpoint(
      async (req) => (await db.query(
        `SELECT a.id,a.name,a.city,s.sport,COALESCE((SELECT sum(w.points) FROM awards w JOIN categories c ON c.id=w.category_id JOIN events e ON e.id=c.event_id WHERE w.athlete_id=a.id AND e.sport=s.sport),0)::int points FROM athletes a JOIN athlete_sports s ON s.athlete_id=a.id WHERE a.is_public AND a.kind='self' ORDER BY points DESC,a.name`
      )).rows.filter((a) => !req.query.sport || a.sport === req.query.sport)
    )
  );
  app.use("/api/v1/me", authenticateRequest);
  app.use("/api/v1/admin", authenticateRequest, admin);
  app.use("/api/v1/invites", authenticateRequest);
  app.use(
    ["/api/v1/me", "/api/v1/admin", "/api/v1/invites"],
    async (req, res, next) => {
      try {
        if (!["GET", "HEAD"].includes(req.method)) {
          const bucket = account(req).id + ":" + Math.floor(Date.now() / 6e4);
          await db.query("DELETE FROM api_limits WHERE resets_at<now()");
          const r = await one(
            db,
            `INSERT INTO api_limits(bucket,count,resets_at) VALUES($1,1,now()+interval '2 minutes') ON CONFLICT(bucket) DO UPDATE SET count=api_limits.count+1 RETURNING count`,
            [bucket]
          );
          if (r.count > 40)
            fail(429, "Too many changes. Please wait a minute.");
        }
        next();
      } catch (e) {
        next(e);
      }
    }
  );
  app.get(
    "/api/v1/me",
    endpoint(async (req) => ({
      account: account(req),
      profiles: await profiles(db, account(req)),
      notifications: (await db.query(
        "SELECT * FROM notifications WHERE account_id=$1 ORDER BY created_at DESC LIMIT 100",
        [account(req).id]
      )).rows,
      saved: (await db.query(
        "SELECT event_id FROM saved_events WHERE account_id=$1",
        [account(req).id]
      )).rows.map((r) => r.event_id)
    }))
  );
  app.post(
    "/api/v1/me/profiles",
    endpoint(async (req) => ({
      id: await saveProfile(db, account(req), req.body)
    }))
  );
  app.put(
    "/api/v1/me/profiles/:id",
    endpoint(async (req) => ({
      id: await saveProfile(
        db,
        account(req),
        req.body,
        uuid.parse(req.params.id)
      )
    }))
  );
  app.delete(
    "/api/v1/me/profiles/:id",
    (req, res, next) => account(req).role === "athlete" ? next() : next(new AppError(403, "Only athletes maintain profiles.")),
    endpoint(
      async (req) => db.transaction(async (tx) => {
        const p = await owned(tx, account(req), uuid.parse(req.params.id));
        if ((await tx.query("SELECT 1 FROM entry_members WHERE athlete_id=$1", [
          p.id
        ])).rows.length)
          fail(
            409,
            "A profile with competition history cannot be removed individually. Use account deletion or contact admin."
          );
        await tx.query("DELETE FROM athletes WHERE id=$1", [p.id]);
        await audit(tx, account(req), "profile.deleted", p.id);
        return { deleted: true };
      })
    )
  );
  app.post(
    "/api/v1/me/entries",
    endpoint(async (req) => register(db, account(req), req.body))
  );
  app.get(
    "/api/v1/me/entries",
    endpoint(
      async (req) => (await db.query(
        `SELECT en.*,ev.name event_name,ev.starts_at,ev.venue,ev.status event_status,c.name category_name,c.event_id,c.entry_type,c.format,(SELECT jsonb_agg(jsonb_build_object('id',p.id,'reference',p.reference,'status',p.status,'reason',p.reason,'mode',p.mode,'submitted_at',p.submitted_at)) FROM payments p WHERE p.entry_id=en.id) payments,(SELECT jsonb_agg(jsonb_build_object('name',a.name,'athlete_id',a.id)) FROM entry_members m JOIN athletes a ON a.id=m.athlete_id WHERE m.entry_id=en.id) members,(SELECT row_to_json(r) FROM refunds r WHERE r.entry_id=en.id) refund FROM entries en JOIN categories c ON c.id=en.category_id JOIN events ev ON ev.id=c.event_id WHERE en.owner_id=$1 OR EXISTS(SELECT 1 FROM entry_members m JOIN athletes a ON a.id=m.athlete_id WHERE m.entry_id=en.id AND a.owner_id=$1) ORDER BY en.created_at DESC`,
        [account(req).id]
      )).rows
    )
  );
  app.get(
    "/api/v1/me/payment-instructions",
    endpoint(async () => {
      const live = process.env.PAYMENTS_MODE === "live" && process.env.COMMERCIAL_LAUNCH_ENABLED === "true";
      if (live && !process.env.MERCHANT_UPI_ID)
        fail(503, "Merchant payment instructions have not been configured.");
      return {
        mode: live ? "live" : "test",
        merchant_name: live ? process.env.MERCHANT_NAME : null,
        upi_id: live ? process.env.MERCHANT_UPI_ID : null,
        instructions: live ? "Pay the entry amount to the merchant, then submit your transaction reference." : "TEST ONLY \u2014 do not send money. Submit a unique TEST- reference to exercise the admin review flow."
      };
    })
  );
  app.post(
    "/api/v1/me/entries/:id/payments",
    endpoint(async (req) => ({
      id: await submitPayment(
        db,
        account(req),
        uuid.parse(req.params.id),
        req.body,
        process.env.PAYMENTS_MODE === "live" && process.env.COMMERCIAL_LAUNCH_ENABLED === "true" ? "live" : "test"
      )
    }))
  );
  app.post(
    "/api/v1/me/entries/:id/withdraw",
    endpoint(async (req) => {
      await withdraw(db, account(req), uuid.parse(req.params.id));
      return { requested: true };
    })
  );
  app.post(
    "/api/v1/me/saved/:id",
    endpoint(async (req) => {
      const id = uuid.parse(req.params.id);
      await one(db, `SELECT id FROM events WHERE id=$1 AND status<>'draft'`, [
        id
      ]);
      if (req.body.saved === true)
        await db.query(
          "INSERT INTO saved_events(account_id,event_id) VALUES($1,$2) ON CONFLICT DO NOTHING",
          [account(req).id, id]
        );
      else
        await db.query(
          "DELETE FROM saved_events WHERE account_id=$1 AND event_id=$2",
          [account(req).id, id]
        );
      return { saved: req.body.saved === true };
    })
  );
  app.post(
    "/api/v1/me/notifications/read",
    endpoint(async (req) => {
      await db.query(
        "UPDATE notifications SET read_at=now() WHERE account_id=$1",
        [account(req).id]
      );
      return { read: true };
    })
  );
  app.get(
    "/api/v1/invites/:token",
    endpoint(async (req) => {
      if (!/^[a-f0-9]{48}$/.test(String(req.params.token)))
        fail(404, "Invitation not found.");
      const en = await one(
        db,
        `SELECT en.id,en.status,en.team_name,en.roster_size,(SELECT count(*)::int FROM entry_members WHERE entry_id=en.id) accepted_members,en.invite_expires_at,c.name category_name,c.entry_type,c.gender,c.event_id,ev.name event_name,ev.sport FROM entries en JOIN categories c ON c.id=en.category_id JOIN events ev ON ev.id=c.event_id WHERE invite_token=$1`,
        [req.params.token]
      );
      return en;
    })
  );
  app.post(
    "/api/v1/invites/:token/accept",
    endpoint(async (req) => {
      if (req.body.accepted_rules !== true)
        fail(400, "Accept the tournament rules to join.");
      return {
        id: await acceptPartner(
          db,
          account(req),
          String(req.params.token),
          uuid.parse(req.body.athlete_id)
        )
      };
    })
  );
  app.get(
    "/api/v1/me/history/:id",
    endpoint(async (req) => {
      const a = await owned(db, account(req), uuid.parse(req.params.id));
      return {
        awards: (await db.query(
          "SELECT w.*,c.name category_name,e.name event_name,e.ends_at FROM awards w JOIN categories c ON c.id=w.category_id JOIN events e ON e.id=c.event_id WHERE w.athlete_id=$1 ORDER BY e.ends_at DESC",
          [a.id]
        )).rows,
        matches: (await db.query(
          `SELECT m.*,e.name event_name,c.name category_name,em.entry_id my_entry FROM matches m JOIN categories c ON c.id=m.category_id JOIN events e ON e.id=c.event_id JOIN entry_members em ON em.entry_id=m.entry_a OR em.entry_id=m.entry_b WHERE em.athlete_id=$1 AND m.status IN ('completed','bye') ORDER BY e.starts_at DESC,m.round DESC`,
          [a.id]
        )).rows
      };
    })
  );
  app.post(
    "/api/v1/me/disputes",
    endpoint(async (req) => {
      const matchId = uuid.parse(req.body.match_id), r = reason.parse(req.body.reason);
      const m = await one(db, "SELECT * FROM matches WHERE id=$1", [matchId]);
      if (!(await db.query(
        `SELECT 1 FROM entry_members em JOIN athletes a ON a.id=em.athlete_id WHERE (em.entry_id=$1 OR em.entry_id=$2) AND a.owner_id=$3`,
        [m.entry_a, m.entry_b, account(req).id]
      )).rows.length)
        fail(403, "Only participants can dispute this match.");
      const id = randomUUID3();
      await db.query(
        "INSERT INTO disputes(id,account_id,match_id,reason) VALUES($1,$2,$3,$4)",
        [id, account(req).id, m.id, r]
      );
      await audit(db, account(req), "dispute.created", id);
      return { id };
    })
  );
  app.post(
    "/api/v1/me/payments/:id/correction",
    endpoint(
      async (req) => db.transaction(async (tx) => {
        const before = await one(tx, "SELECT * FROM payments WHERE id=$1", [
          uuid.parse(req.params.id)
        ]);
        const entry = await member(tx, account(req), before.entry_id);
        await one(tx, "SELECT id FROM categories WHERE id=$1 FOR UPDATE", [
          entry.category_id
        ]);
        const payment = await one(
          tx,
          "SELECT * FROM payments WHERE id=$1 FOR UPDATE",
          [before.id]
        );
        if (payment.status === "confirmed")
          fail(
            409,
            "Confirmed transactions require admin refund review, not a replacement submission."
          );
        const id = randomUUID3(), text2 = reason.parse(req.body.reason);
        await tx.query(
          "INSERT INTO payment_corrections(id,payment_id,account_id,reason) VALUES($1,$2,$3,$4)",
          [id, payment.id, account(req).id, text2]
        );
        await audit(
          tx,
          account(req),
          "payment.correction_requested",
          payment.id
        );
        await tell(
          tx,
          payment.entry_id,
          "A payment correction was requested. Admin will review it."
        );
        return { id };
      })
    )
  );
  app.post(
    "/api/v1/admin/corrections/:id/resolve",
    endpoint(
      async (req) => db.transaction(async (tx) => {
        const before = await one(
          tx,
          "SELECT pc.*,p.entry_id FROM payment_corrections pc JOIN payments p ON p.id=pc.payment_id WHERE pc.id=$1",
          [uuid.parse(req.params.id)]
        );
        const en = await one(tx, "SELECT * FROM entries WHERE id=$1", [
          before.entry_id
        ]);
        await one(tx, "SELECT id FROM categories WHERE id=$1 FOR UPDATE", [
          en.category_id
        ]);
        const correction = await one(
          tx,
          "SELECT * FROM payment_corrections WHERE id=$1 FOR UPDATE",
          [before.id]
        );
        if (correction.status !== "open")
          fail(409, "This correction was already reviewed.");
        const p = await one(
          tx,
          "SELECT * FROM payments WHERE id=$1 FOR UPDATE",
          [correction.payment_id]
        ), text2 = reason.parse(req.body.resolution);
        if (p.status === "confirmed")
          fail(409, "Payment already confirmed. Handle refund separately.");
        await tx.query(
          `UPDATE payment_corrections SET status='resolved',resolution=$2 WHERE id=$1`,
          [correction.id, text2]
        );
        if (req.body.allow_resubmit === true) {
          await tx.query(
            `UPDATE payments SET status='rejected',reason=$2,reviewed_by=$3,reviewed_at=now() WHERE id=$1`,
            [p.id, text2, account(req).id]
          );
          if (["awaiting_verification", "needs_review_no_seat"].includes(
            en.status
          ))
            await tx.query(
              `UPDATE entries SET status='payment_rejected' WHERE id=$1`,
              [en.id]
            );
        }
        await tell(tx, en.id, "Payment correction reviewed: " + text2);
        await audit(tx, account(req), "payment.correction_resolved", p.id, {
          allow_resubmit: req.body.allow_resubmit === true
        });
        return { resolved: true };
      })
    )
  );
  app.post(
    "/api/v1/admin/payments/:id/refund",
    endpoint(
      async (req) => db.transaction(async (tx) => {
        const p = await one(tx, "SELECT * FROM payments WHERE id=$1", [
          uuid.parse(req.params.id)
        ]), en = await one(tx, "SELECT * FROM entries WHERE id=$1", [p.entry_id]);
        await one(tx, "SELECT id FROM categories WHERE id=$1 FOR UPDATE", [
          en.category_id
        ]);
        const payment = await one(
          tx,
          "SELECT * FROM payments WHERE id=$1 FOR UPDATE",
          [p.id]
        );
        await one(tx, "SELECT id FROM entries WHERE id=$1 FOR UPDATE", [en.id]);
        if (![
          "needs_review_no_seat",
          "payment_rejected",
          "cancelled",
          "withdrawn"
        ].includes(en.status))
          fail(409, "Use the normal review or withdrawal flow for this entry.");
        if (req.body.bank_checked !== true)
          fail(
            400,
            "Check the actual incoming transaction before creating a refund."
          );
        const text2 = reason.parse(req.body.reason);
        if ((await tx.query(
          `SELECT 1 FROM payments WHERE entry_id=$1 AND status='confirmed' AND id<>$2`,
          [en.id, p.id]
        )).rows.length)
          fail(
            409,
            "Another confirmed transaction already exists for this entry."
          );
        await tx.query(
          `UPDATE payments SET status='confirmed',reason=$2,reviewed_by=$3,reviewed_at=now() WHERE id=$1`,
          [p.id, text2, account(req).id]
        );
        await tx.query(
          `UPDATE entries SET status='withdrawn' WHERE id=$1 AND status<>'cancelled'`,
          [en.id]
        );
        await refund(tx, en, text2);
        await tell(
          tx,
          en.id,
          "Your payment was bank-verified for refund. No tournament slot was added."
        );
        await audit(
          tx,
          account(req),
          "payment.refund_task_created",
          payment.id
        );
        return { pending_refund: true };
      })
    )
  );
  app.get(
    "/api/v1/admin/overview",
    endpoint(async () => ({
      events: (await db.query(
        `SELECT e.*,COALESCE((SELECT jsonb_agg(c) FROM categories c WHERE c.event_id=e.id),'[]') categories FROM events e ORDER BY starts_at DESC`
      )).rows,
      payments: (await db.query(
        `SELECT p.*,en.status entry_status,c.name category_name,ev.name event_name,extract(epoch FROM now()-p.submitted_at)>86400 overdue,(SELECT u.id FROM uploads u WHERE u.payment_id=p.id LIMIT 1) proof_id FROM payments p JOIN entries en ON en.id=p.entry_id JOIN categories c ON c.id=en.category_id JOIN events ev ON ev.id=c.event_id ORDER BY p.submitted_at DESC`
      )).rows,
      refunds: (await db.query(
        "SELECT r.*,ev.name event_name FROM refunds r JOIN entries en ON en.id=r.entry_id JOIN categories c ON c.id=en.category_id JOIN events ev ON ev.id=c.event_id ORDER BY r.created_at DESC"
      )).rows,
      disputes: (await db.query("SELECT * FROM disputes ORDER BY created_at DESC")).rows,
      corrections: (await db.query(
        `SELECT pc.*,p.reference,p.entry_id FROM payment_corrections pc JOIN payments p ON p.id=pc.payment_id ORDER BY pc.created_at DESC`
      )).rows,
      audit: (await db.query(
        "SELECT id,action,entity_id,created_at FROM audit ORDER BY created_at DESC LIMIT 100"
      )).rows
    }))
  );
  app.post(
    "/api/v1/admin/events",
    endpoint(async (req) => ({
      id: await saveEvent(db, account(req), req.body)
    }))
  );
  app.put(
    "/api/v1/admin/events/:id",
    endpoint(async (req) => ({
      id: await saveEvent(
        db,
        account(req),
        req.body,
        uuid.parse(req.params.id)
      )
    }))
  );
  app.post(
    "/api/v1/admin/events/:id/status",
    endpoint(async (req) => {
      const status = z2.enum(["published", "closed", "completed", "cancelled"]).parse(req.body.status);
      await eventStatus(db, account(req), uuid.parse(req.params.id), status);
      return { status };
    })
  );
  app.get(
    "/api/v1/admin/events/:id/entries",
    endpoint(
      async (req) => (await db.query(
        `SELECT en.*,c.name category_name,(SELECT jsonb_agg(jsonb_build_object('id',a.id,'name',a.name,'dob',a.dob,'kind',a.kind,'phone',a.phone,'consent_at',a.consent_at,'guardian_name',a.guardian_name)) FROM entry_members m JOIN athletes a ON a.id=m.athlete_id WHERE m.entry_id=en.id) members FROM entries en JOIN categories c ON c.id=en.category_id WHERE c.event_id=$1 ORDER BY en.created_at`,
        [uuid.parse(req.params.id)]
      )).rows
    )
  );
  app.post(
    "/api/v1/admin/payments/:id/review",
    endpoint(async (req) => {
      const p = z2.object({
        approved: z2.boolean(),
        bank_checked: z2.literal(true),
        reason
      }).parse(req.body);
      await reviewPayment(
        db,
        account(req),
        uuid.parse(req.params.id),
        p.approved,
        p.reason
      );
      return { reviewed: true };
    })
  );
  app.post(
    "/api/v1/admin/entries/:id/withdrawal",
    endpoint(
      async (req) => db.transaction(async (tx) => {
        const id = uuid.parse(req.params.id);
        const before = await one(tx, "SELECT * FROM entries WHERE id=$1", [id]);
        await one(tx, "SELECT id FROM categories WHERE id=$1 FOR UPDATE", [
          before.category_id
        ]);
        const en = await one(
          tx,
          "SELECT * FROM entries WHERE id=$1 FOR UPDATE",
          [id]
        );
        if (en.status !== "withdrawal_requested")
          fail(409, "Entry has no withdrawal request.");
        const r = reason.parse(req.body.reason);
        if (req.body.refund === true) await refund(tx, en, r);
        await tx.query(
          `UPDATE payments SET status='rejected',reason=$2,reviewed_at=now(),reviewed_by=$3 WHERE entry_id=$1 AND status='submitted'`,
          [id, "Withdrawal: " + r, account(req).id]
        );
        await tx.query(`UPDATE entries SET status='withdrawn' WHERE id=$1`, [
          id
        ]);
        await audit(tx, account(req), "withdrawal.resolved", id, {
          refund: !!req.body.refund,
          reason: r
        });
        await tell(tx, id, "Withdrawal completed: " + r);
        return { withdrawn: true };
      })
    )
  );
  app.post(
    "/api/v1/admin/refunds/:id",
    endpoint(
      async (req) => db.transaction(async (tx) => {
        const r = await one(
          tx,
          "SELECT * FROM refunds WHERE id=$1 FOR UPDATE",
          [uuid.parse(req.params.id)]
        );
        if (r.status !== "pending") fail(409, "Refund already processed.");
        const bank = reason.parse(req.body.bank_reference);
        if (req.body.bank_checked !== true)
          fail(400, "Confirm that the refund was sent.");
        await tx.query(
          `UPDATE refunds SET status='processed',bank_reference=$2,admin_id=$3,processed_at=now() WHERE id=$1`,
          [r.id, bank, account(req).id]
        );
        await tell(tx, r.entry_id, "Refund processed. Reference: " + bank);
        await audit(tx, account(req), "refund.processed", r.id);
        return { processed: true };
      })
    )
  );
  app.post(
    "/api/v1/admin/categories/:id/draw",
    endpoint(
      async (req) => draw(
        db,
        account(req),
        uuid.parse(req.params.id),
        req.body.seeds ? z2.array(uuid).parse(req.body.seeds) : void 0
      )
    )
  );
  app.get(
    "/api/v1/admin/events/:id/matches",
    endpoint(
      async (req) => (await db.query(
        `SELECT m.*,c.name category_name,c.best_of,c.format,c.scoring_mode,COALESCE((SELECT team_name FROM entries WHERE id=m.entry_a),(SELECT string_agg(a.name,' / ' ORDER BY a.id) FROM entry_members em JOIN athletes a ON a.id=em.athlete_id WHERE em.entry_id=m.entry_a)) label_a,COALESCE((SELECT team_name FROM entries WHERE id=m.entry_b),(SELECT string_agg(a.name,' / ' ORDER BY a.id) FROM entry_members em JOIN athletes a ON a.id=em.athlete_id WHERE em.entry_id=m.entry_b)) label_b FROM matches m JOIN categories c ON c.id=m.category_id WHERE c.event_id=$1 ORDER BY c.name,m.round,m.position`,
        [uuid.parse(req.params.id)]
      )).rows
    )
  );
  app.put(
    "/api/v1/admin/matches/:id/schedule",
    endpoint(async (req) => {
      const p = z2.object({
        court: z2.string().trim().min(1).max(100),
        scheduled_at: z2.iso.datetime({ offset: true })
      }).parse(req.body);
      await db.transaction(async (tx) => {
        const m = await one(
          tx,
          `SELECT m.*,ev.starts_at,ev.ends_at FROM matches m JOIN categories c ON c.id=m.category_id JOIN events ev ON ev.id=c.event_id WHERE m.id=$1 FOR UPDATE OF m`,
          [uuid.parse(req.params.id)]
        );
        const t = new Date(p.scheduled_at);
        if (t < new Date(m.starts_at) || t > new Date(m.ends_at))
          fail(400, "Schedule must be inside the event dates.");
        if (m.status !== "pending")
          fail(409, "Completed matches cannot be rescheduled.");
        await tx.query(
          "UPDATE matches SET scheduled_at=$2,court=$3 WHERE id=$1",
          [m.id, p.scheduled_at, p.court]
        );
        await audit(tx, account(req), "match.scheduled", m.id, p);
        for (const en of [m.entry_a, m.entry_b].filter(Boolean))
          await tell(
            tx,
            en,
            "Match schedule updated: " + p.court + " \xB7 " + p.scheduled_at
          );
      });
      return { scheduled: true };
    })
  );
  app.post(
    "/api/v1/admin/matches/:id/result",
    endpoint(async (req) => {
      await recordResult(db, account(req), uuid.parse(req.params.id), req.body);
      return { published: true };
    })
  );
  app.post(
    "/api/v1/admin/events/:id/announcements",
    endpoint(async (req) => {
      const id = uuid.parse(req.params.id), text2 = reason.parse(req.body.text);
      await db.transaction(async (tx) => {
        await one(tx, "SELECT id FROM events WHERE id=$1", [id]);
        await tx.query(
          "INSERT INTO announcements(id,event_id,text) VALUES($1,$2,$3)",
          [randomUUID3(), id, text2]
        );
        const entries = (await tx.query(
          "SELECT en.id FROM entries en JOIN categories c ON c.id=en.category_id WHERE c.event_id=$1",
          [id]
        )).rows;
        for (const en of entries) await tell(tx, en.id, text2);
        await audit(tx, account(req), "announcement.published", id);
      });
      return { published: true };
    })
  );
  app.post(
    "/api/v1/admin/disputes/:id/resolve",
    endpoint(async (req) => {
      const id = uuid.parse(req.params.id), text2 = reason.parse(req.body.resolution);
      await db.transaction(async (tx) => {
        const d = await one(
          tx,
          `SELECT * FROM disputes WHERE id=$1 AND status='open' FOR UPDATE`,
          [id]
        );
        await tx.query(
          `UPDATE disputes SET status='resolved',resolution=$2 WHERE id=$1`,
          [id, text2]
        );
        await tx.query(
          "INSERT INTO notifications(id,account_id,text) VALUES($1,$2,$3)",
          [randomUUID3(), d.account_id, "Dispute resolved: " + text2]
        );
        await audit(tx, account(req), "dispute.resolved", id);
      });
      return { resolved: true };
    })
  );
  app.get(
    "/api/v1/admin/events/:id/export",
    endpoint(async (req, res) => {
      const rows = (await db.query(
        `SELECT en.id,en.team_name,c.name category,en.status,en.fee fee_paise,(SELECT string_agg(a.name,' / ') FROM entry_members m JOIN athletes a ON a.id=m.athlete_id WHERE m.entry_id=en.id) athletes,p.reference,p.status payment_status FROM entries en JOIN categories c ON c.id=en.category_id LEFT JOIN payments p ON p.entry_id=en.id WHERE c.event_id=$1 ORDER BY en.created_at`,
        [uuid.parse(req.params.id)]
      )).rows;
      const cell = (v) => '"' + String(v ?? "").replace(/^[=+@-]/, "'$&").replaceAll('"', '""') + '"';
      const cols = [
        "id",
        "category",
        "status",
        "fee_paise",
        "athletes",
        "reference",
        "payment_status"
      ];
      res.setHeader("Content-Type", "text/csv");
      res.setHeader(
        "Content-Disposition",
        'attachment; filename="rally-event-report.csv"'
      );
      res.send(
        cols.join(",") + "\n" + rows.map((r) => cols.map((c) => cell(r[c])).join(",")).join("\n")
      );
    })
  );
  app.post(
    "/api/v1/me/uploads",
    endpoint(async (req) => {
      const a = account(req);
      const p = z2.object({
        purpose: z2.enum(["proof", "poster", "avatar"]),
        base64: z2.string().max(28e5)
      }).parse(req.body);
      if (p.purpose === "poster" && a.role !== "admin")
        fail(403, "Only admin can upload posters.");
      if (p.purpose === "avatar" && a.role !== "athlete")
        fail(403, "Only athletes can upload profile photos.");
      const bytes = Buffer.from(p.base64, "base64");
      if (bytes.length > 2 * 1024 * 1024 || bytes.length < 10)
        fail(400, "Upload an image smaller than 2 MB.");
      const img = sharp(bytes, { limitInputPixels: 16e6 });
      const meta = await img.metadata();
      if (!["jpeg", "png", "webp"].includes(meta.format || ""))
        fail(400, "Only JPEG, PNG and WebP images are supported.");
      const cleaned = await img.rotate().resize({
        width: 1600,
        height: 1600,
        fit: "inside",
        withoutEnlargement: true
      }).jpeg({ quality: 80 }).toBuffer();
      const token = p.purpose !== "poster" ? process.env.PRIVATE_BLOB_READ_WRITE_TOKEN : process.env.PUBLIC_BLOB_READ_WRITE_TOKEN;
      if (!token && !options.storage)
        fail(503, "Image storage has not been configured.", "SETUP_REQUIRED");
      const id = randomUUID3();
      const blob = await storage.put(
        `${p.purpose}/${a.id}/${id}.jpg`,
        cleaned,
        {
          access: p.purpose !== "poster" ? "private" : "public",
          contentType: "image/jpeg",
          token
        }
      );
      await db.query(
        "INSERT INTO uploads(id,owner_id,purpose,pathname,url,content_type) VALUES($1,$2,$3,$4,$5,$6)",
        [id, a.id, p.purpose, blob.pathname, blob.url, "image/jpeg"]
      );
      return { id, url: p.purpose !== "poster" ? null : blob.url };
    })
  );
  app.get(
    "/api/v1/me/uploads/:id",
    endpoint(async (req, res) => {
      const u = await one(db, "SELECT * FROM uploads WHERE id=$1", [
        uuid.parse(req.params.id)
      ]);
      if (u.owner_id !== account(req).id && account(req).role !== "admin")
        fail(404, "File not found.");
      if (u.purpose === "poster") return { url: u.url };
      const file = await storage.get(u.pathname, {
        access: "private",
        token: process.env.PRIVATE_BLOB_READ_WRITE_TOKEN
      });
      if (!file || file.statusCode !== 200 || !file.stream)
        fail(404, "File not found.");
      res.setHeader("Content-Type", u.content_type);
      res.setHeader("Cache-Control", "private,no-store");
      const reader = file.stream.getReader();
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        res.write(Buffer.from(value));
      }
      res.end();
    })
  );
  app.delete(
    "/api/v1/me/account",
    endpoint(async (req) => {
      const a = account(req);
      const i = await verify(req);
      if (a.role === "admin")
        fail(
          409,
          "Transfer platform administration before deleting the admin account."
        );
      const active = await db.query(
        `SELECT 1 FROM entries en JOIN categories c ON c.id=en.category_id JOIN events e ON e.id=c.event_id WHERE (en.owner_id=$1 OR EXISTS(SELECT 1 FROM entry_members m JOIN athletes p ON p.id=m.athlete_id WHERE m.entry_id=en.id AND p.owner_id=$1)) AND e.status NOT IN ('completed','cancelled') AND en.status NOT IN ('expired','withdrawn','cancelled','payment_rejected')`,
        [a.id]
      );
      if (active.rows.length)
        fail(409, "Withdraw active entries before deleting the account.");
      const uploads = (await db.query("SELECT * FROM uploads WHERE owner_id=$1", [a.id])).rows;
      for (const u of uploads)
        await storage.del(u.url, {
          token: u.purpose !== "poster" ? process.env.PRIVATE_BLOB_READ_WRITE_TOKEN : process.env.PUBLIC_BLOB_READ_WRITE_TOKEN
        });
      await db.transaction(async (tx) => {
        await tx.query("DELETE FROM uploads WHERE owner_id=$1", [a.id]);
        await tx.query(
          "DELETE FROM ranking_reviews WHERE athlete_id IN (SELECT id FROM athletes WHERE owner_id=$1)",
          [a.id]
        );
        await tx.query(
          `UPDATE athlete_sports SET rankings='[]' WHERE athlete_id IN (SELECT id FROM athletes WHERE owner_id=$1)`,
          [a.id]
        );
        await tx.query(
          `UPDATE athletes SET name='Deleted athlete',dob='1900-01-01',gender='prefer_not_to_say',state='',city='',phone='',guardian_name=NULL,guardian_relationship=NULL,consent_at=NULL,is_public=false,photo_url=NULL,academy=NULL,coach=NULL,goal=NULL WHERE owner_id=$1`,
          [a.id]
        );
        await tx.query(
          `UPDATE payments SET payer_name='Deleted account',reference='DELETED-'||id::text WHERE entry_id IN (SELECT id FROM entries WHERE owner_id=$1)`,
          [a.id]
        );
        await tx.query(
          `UPDATE entries SET emergency_contact='',school=NULL WHERE owner_id=$1`,
          [a.id]
        );
        await tx.query("DELETE FROM saved_events WHERE account_id=$1", [a.id]);
        await tx.query("DELETE FROM notifications WHERE account_id=$1", [a.id]);
        await tx.query(
          `UPDATE accounts SET email='',deleted_at=now() WHERE id=$1`,
          [a.id]
        );
        await tx.query(
          "UPDATE disputes SET reason='Deleted account',resolution=NULL WHERE account_id=$1",
          [a.id]
        );
        await tx.query(
          "UPDATE payment_corrections SET reason='Deleted account',resolution=NULL WHERE account_id=$1",
          [a.id]
        );
        await audit(tx, a, "account.deleted", a.id);
      });
      if (!options.authenticate) {
        try {
          await firebaseAdmin().deleteUser(i.uid);
        } catch (e) {
          if (e.code !== "auth/user-not-found")
            throw Object.assign(
              new Error(
                "Your data was removed. Retry deletion to finish removing sign-in access."
              ),
              { status: 503 }
            );
        }
      }
      return { deleted: true };
    })
  );
  app.use(
    (req, res) => res.status(404).json({ error: { code: "NOT_FOUND", message: "API route not found." } })
  );
  app.use((err, req, res, next) => {
    if (res.headersSent) return next(err);
    const status = err instanceof z2.ZodError ? 400 : err.status || (err.code === "23505" ? 409 : err.code?.startsWith("auth/") ? 401 : 500);
    if (status >= 500)
      console.error("api_error", {
        path: req.path,
        code: err.code || "SERVER_ERROR"
      });
    res.status(status).json({
      error: {
        code: err.code || "REQUEST_FAILED",
        message: err instanceof z2.ZodError ? err.issues.map((i) => i.message).join("; ") : status >= 500 && status !== 503 ? "Something went wrong. Please retry." : err.code === "23505" ? "This record already exists." : err.message || "Request failed."
      }
    });
  });
  return app;
}

// server/handler.ts
var handler_default = createApp();
export {
  handler_default as default
};
