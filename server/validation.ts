import { z } from "zod";
import { normalizeSport } from "../shared/sports.js";
const text = z.string().trim().min(1).max(200);
export const sport = z
  .string()
  .trim()
  .min(2)
  .max(80)
  .regex(/^[\p{L}\p{N}][\p{L}\p{N} &'().+-]*$/u, "Enter a sport name")
  .transform(normalizeSport);
export const levels = [
  "Beginner",
  "Amateur",
  "Competitive amateur",
  "Semi-professional",
  "Professional",
] as const;
const optional = z.string().trim().max(250).default("");
const ranking = z.object({
  scope: z.enum(["state", "national"]),
  rank: z.number().int().positive().max(1000000),
  authority: text,
  category: text,
  date: z.iso.date(),
  player_id: optional,
  source: z
    .union([
      z.literal(""),
      z
        .url()
        .refine((u) => u.startsWith("https://"), "Use an HTTPS source link"),
    ])
    .default(""),
});
export const profileInput = z
  .object({
    kind: z.enum(["self", "junior"]),
    name: text,
    dob: z.iso.date(),
    gender: z.enum(["male", "female", "nonbinary", "prefer_not_to_say"]),
    state: text,
    city: text,
    phone: z
      .string()
      .regex(/^\+?[0-9 ()-]{10,18}$/, "Enter a valid contact number"),
    guardian_name: optional,
    guardian_relationship: optional,
    consent: z.boolean().default(false),
    is_public: z.boolean().default(false),
    photo_url: z.string().max(1000).nullable().optional(),
    academy: optional,
    coach: optional,
    goal: optional,
    sports: z
      .array(
        z.object({
          sport,
          level: z.enum(levels),
          years: z.number().int().min(0).max(90),
          primary_sport: z.boolean(),
          categories: z.array(z.enum(["singles", "doubles", "team"])).min(1),
          rankings: z.array(ranking).max(2).default([]),
        }),
      )
      .min(1)
      .max(20),
  })
  .superRefine((p, c) => {
    if (p.sports.filter((s) => s.primary_sport).length !== 1)
      c.addIssue({
        code: "custom",
        message: "Choose exactly one primary sport",
      });
    if (new Set(p.sports.map((s) => s.sport)).size !== p.sports.length)
      c.addIssue({
        code: "custom",
        message: "Each sport may be selected once",
      });
    for (const s of p.sports)
      if (new Set(s.rankings.map((r) => r.scope)).size !== s.rankings.length)
        c.addIssue({ code: "custom", message: "One claim per ranking scope" });
    if (
      p.kind === "junior" &&
      (!p.consent || !p.guardian_name || !p.guardian_relationship)
    )
      c.addIssue({
        code: "custom",
        message: "Guardian details and consent are required",
      });
  });
export const categoryInput = z
  .object({
    name: text,
    entry_type: z.enum(["singles", "doubles", "team"]),
    team_min: z.number().int().min(2).max(50).default(2),
    team_max: z.number().int().min(2).max(50).default(2),
    scoring_mode: z.enum(["sets", "score"]).default("sets"),
    league_points: z
      .object({
        win: z.number().int().min(0).max(100),
        draw: z.number().int().min(0).max(100),
        loss: z.number().int().min(0).max(100),
      })
      .default({ win: 3, draw: 1, loss: 0 }),
    format: z.enum(["knockout", "round_robin"]),
    capacity: z.number().int().min(2).max(128),
    fee: z.number().int().min(0).max(10000000),
    min_age: z.number().int().min(0).max(100),
    max_age: z.number().int().min(0).max(100),
    gender: z.enum(["any", "male", "female", "mixed"]),
    levels: z.array(z.enum(levels)).min(1),
    best_of: z.union([z.literal(1), z.literal(3), z.literal(5)]).default(3),
    school_required: z.boolean().default(false),
    points: z
      .object({
        winner: z.number().int().min(0).max(5000),
        runner: z.number().int().min(0).max(5000),
        semi: z.number().int().min(0).max(5000),
        participation: z.number().int().min(0).max(5000),
      })
      .default({ winner: 400, runner: 250, semi: 150, participation: 40 }),
  })
  .superRefine((v, c) => {
    if (v.team_max < v.team_min)
      c.addIssue({
        code: "custom",
        message: "Maximum roster size must be at least the minimum",
      });
    if (v.scoring_mode === "score" && v.best_of !== 1)
      c.addIssue({
        code: "custom",
        message: "Final-score matches must use best of 1",
      });
    if (v.max_age < v.min_age)
      c.addIssue({
        code: "custom",
        message: "Maximum age must be at least minimum age",
      });
    if (v.gender === "mixed" && v.entry_type === "singles")
      c.addIssue({
        code: "custom",
        message: "Mixed categories require doubles or teams",
      });
    if (v.format === "round_robin" && v.capacity > 24)
      c.addIssue({
        code: "custom",
        message: "Round-robin categories support up to 24 entries",
      });
  });
export const eventInput = z
  .object({
    name: text,
    sport,
    city: text,
    state: text,
    venue: text,
    details: z
      .object({
        description: z.string().trim().max(3000).default(""),
        organizer_name: z.string().trim().max(200).default(""),
        contact_phone: z
          .string()
          .trim()
          .max(18)
          .refine(
            (v) => !v || /^\+?[0-9 ()-]{10,18}$/.test(v),
            "Enter a valid organiser phone number",
          )
          .default(""),
        contact_email: z.union([z.literal(""), z.email()]).default(""),
        address: z.string().trim().max(500).default(""),
        map_url: z
          .union([
            z.literal(""),
            z
              .url()
              .refine((v) => v.startsWith("https://"), "Use an HTTPS map link"),
          ])
          .default(""),
        equipment: z.string().trim().max(2000).default(""),
      })
      .default({
        description: "",
        organizer_name: "",
        contact_phone: "",
        contact_email: "",
        address: "",
        map_url: "",
        equipment: "",
      }),
    starts_at: z.iso.datetime({ offset: true }),
    ends_at: z.iso.datetime({ offset: true }),
    registration_deadline: z.iso.datetime({ offset: true }),
    age_cutoff: z.iso.date(),
    withdrawal_deadline: z.iso.datetime({ offset: true }),
    refund_policy: z.string().trim().min(10).max(2000),
    rules: z.string().trim().min(10).max(5000),
    poster_url: z.string().max(1000).default(""),
    categories: z.array(categoryInput).min(1).max(20),
  })
  .superRefine((v, c) => {
    if (Date.parse(v.ends_at) < Date.parse(v.starts_at))
      c.addIssue({
        code: "custom",
        message: "Event end must follow event start",
      });
    if (
      Date.parse(v.registration_deadline) > Date.parse(v.starts_at) ||
      Date.parse(v.withdrawal_deadline) > Date.parse(v.starts_at)
    )
      c.addIssue({
        code: "custom",
        message: "Entry and withdrawal deadlines must precede the event",
      });
  });
export const entryInput = z.object({
  category_id: z.uuid(),
  athlete_id: z.uuid(),
  team_name: z.string().trim().min(2).max(100).optional(),
  roster_size: z.number().int().min(2).max(50).optional(),
  emergency_contact: text,
  school: optional,
  accepted_rules: z.literal(true),
  idempotency_key: z.uuid(),
});
export const paymentInput = z.object({
  reference: z
    .string()
    .trim()
    .regex(
      /^[a-zA-Z0-9-]{6,40}$/,
      "Reference must contain 6–40 letters, numbers or hyphens",
    ),
  payer_name: text,
  paid_at: z.iso.datetime({ offset: true }),
  proof_id: z.uuid().optional(),
});
export const resultInput = z.object({
  winner_id: z.uuid().nullable(),
  sets: z
    .array(
      z.tuple([
        z.number().int().min(0).max(100000),
        z.number().int().min(0).max(100000),
      ]),
    )
    .max(5),
  outcome: z.enum([
    "played",
    "draw",
    "walkover",
    "withdrawal",
    "double_withdrawal",
  ]),
  version: z.number().int().min(0),
});
export function ageAt(dob: string, cutoff: string) {
  const d = new Date(dob),
    c = new Date(cutoff);
  return (
    c.getUTCFullYear() -
    d.getUTCFullYear() -
    Number(
      c.getUTCMonth() < d.getUTCMonth() ||
        (c.getUTCMonth() === d.getUTCMonth() &&
          c.getUTCDate() < d.getUTCDate()),
    )
  );
}
