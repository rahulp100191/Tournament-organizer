import express, { type Request, type Response } from "express";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import { put, get, del } from "@vercel/blob";
import sharp from "sharp";
import { database, type Database } from "./db.js";
import { authenticate, firebaseAdmin, type Identity } from "./auth.js";
import {
  acceptPartner,
  AppError,
  audit,
  capacity,
  eventStatus,
  fail,
  member,
  one,
  owned,
  profiles,
  refund,
  register,
  reviewPayment,
  saveEvent,
  saveProfile,
  submitPayment,
  tell,
  withdraw,
  type Account,
} from "./domain.js";
import { draw, recordResult, standings } from "./competition.js";
interface Options {
  db?: Database;
  authenticate?: (req: Request) => Promise<Identity>;
  storage?: { put: typeof put; get: typeof get; del: typeof del };
}
const uuid = z.uuid(),
  reason = z.string().trim().min(3).max(1000);
export function createApp(options: Options = {}) {
  const app = express(),
    db = options.db || database,
    verify = options.authenticate || authenticate,
    storage = options.storage || { put, get, del };
  app.disable("x-powered-by");
  app.use((req, res, next) => {
    const route = new URL(req.url, "http://localhost").searchParams.get(
      "route",
    );
    if (route) req.url = "/api/v1/" + route;
    res.setHeader("Cache-Control", "no-store");
    res.setHeader("X-Content-Type-Options", "nosniff");
    next();
  });
  app.use(express.json({ limit: "3mb" }));
  const endpoint =
    (fn: (req: Request, res: Response) => Promise<any>) =>
    async (req: Request, res: Response, next: any) => {
      try {
        const result = await fn(req, res);
        if (!res.headersSent) res.json({ data: result });
      } catch (e) {
        next(e);
      }
    };
  // Authentication must not send a response; endpoints send responses separately.
  const authenticateRequest = async (
    req: Request,
    res: Response,
    next: any,
  ) => {
    try {
      const i = await verify(req);
      if (!i.verified) fail(403, "Verify your email to continue.");
      const allow = (process.env.ADMIN_EMAILS || "")
        .toLowerCase()
        .split(",")
        .map((v) => v.trim());
      const a = await one(
        db,
        `INSERT INTO accounts(id,firebase_uid,email,role) VALUES($1,$2,$3,$4) ON CONFLICT(firebase_uid) DO UPDATE SET email=CASE WHEN accounts.deleted_at IS NULL THEN excluded.email ELSE '' END RETURNING *`,
        [
          randomUUID(),
          i.uid,
          i.email,
          allow.includes(i.email.toLowerCase()) ? "admin" : "athlete",
        ],
      );
      if (
        a.deleted_at &&
        !(req.method === "DELETE" && req.originalUrl === "/api/v1/me/account")
      )
        fail(403, "This account has been deleted.");
      (req as any).account = a;
      next();
    } catch (e) {
      next(e);
    }
  };
  const account = (req: Request): Account => (req as any).account;
  const admin = (req: Request, res: Response, next: any) => {
    if (account(req).role !== "admin")
      return next(new AppError(403, "Admin access is required."));
    next();
  };
  app.get(
    "/api/v1/health",
    endpoint(async () => ({
      status: process.env.DATABASE_URL ? "configured" : "setup_required",
      payments_mode:
        process.env.PAYMENTS_MODE === "live" &&
        process.env.COMMERCIAL_LAUNCH_ENABLED === "true"
          ? "live"
          : "test",
      database_configured: !!process.env.DATABASE_URL,
      auth_configured: !!(
        process.env.FIREBASE_PROJECT_ID &&
        process.env.FIREBASE_CLIENT_EMAIL &&
        process.env.FIREBASE_PRIVATE_KEY
      ),
    })),
  );
  app.get(
    "/api/v1/events",
    endpoint(async (req) => {
      const rows = (
        await db.query(
          `SELECT e.*,COALESCE((SELECT jsonb_agg(c ORDER BY c.name) FROM categories c WHERE c.event_id=e.id),'[]') categories FROM events e WHERE status<>'draft' ORDER BY starts_at`,
        )
      ).rows;
      return rows.filter(
        (e) =>
          (!req.query.sport || e.sport === req.query.sport) &&
          (!req.query.city || e.city === req.query.city),
      );
    }),
  );
  app.get(
    "/api/v1/events/:id",
    endpoint(async (req) => {
      const e = await one(
        db,
        `SELECT * FROM events WHERE id=$1 AND status<>'draft'`,
        [uuid.parse(req.params.id)],
      );
      const categories = (
        await db.query(
          `SELECT c.*,GREATEST(0,c.capacity-(SELECT count(*) FROM entries en WHERE en.category_id=c.id AND (en.status IN ('awaiting_verification','confirmed','withdrawal_requested') OR (en.status='awaiting_payment' AND en.reservation_expires_at>now()))))::int remaining FROM categories c WHERE event_id=$1 ORDER BY name`,
          [e.id],
        )
      ).rows;
      return {
        ...e,
        categories,
        announcements: (
          await db.query(
            "SELECT * FROM announcements WHERE event_id=$1 ORDER BY created_at DESC",
            [e.id],
          )
        ).rows,
      };
    }),
  );
  app.get(
    "/api/v1/events/:id/matches",
    endpoint(async (req) => {
      await one(db, `SELECT id FROM events WHERE id=$1 AND status<>'draft'`, [
        uuid.parse(req.params.id),
      ]);
      return (
        await db.query(
          `SELECT m.*,c.name category_name,c.format, (SELECT string_agg(CASE WHEN a.is_public AND a.kind='self' THEN a.name ELSE 'Player '||left(a.id::text,4) END,' / ' ORDER BY a.id) FROM entry_members em JOIN athletes a ON a.id=em.athlete_id WHERE em.entry_id=m.entry_a) label_a,(SELECT string_agg(CASE WHEN a.is_public AND a.kind='self' THEN a.name ELSE 'Player '||left(a.id::text,4) END,' / ' ORDER BY a.id) FROM entry_members em JOIN athletes a ON a.id=em.athlete_id WHERE em.entry_id=m.entry_b) label_b FROM matches m JOIN categories c ON c.id=m.category_id WHERE c.event_id=$1 AND c.draw_published ORDER BY c.name,round,position`,
          [req.params.id],
        )
      ).rows;
    }),
  );
  app.get(
    "/api/v1/categories/:id/standings",
    endpoint(async (req) => {
      await one(
        db,
        `SELECT c.id FROM categories c JOIN events e ON e.id=c.event_id WHERE c.id=$1 AND e.status<>'draft' AND c.draw_published`,
        [uuid.parse(req.params.id)],
      );
      return standings(db, String(req.params.id));
    }),
  );
  app.get(
    "/api/v1/rankings",
    endpoint(async (req) =>
      (
        await db.query(
          `SELECT a.id,a.name,a.city,s.sport,COALESCE((SELECT sum(w.points) FROM awards w JOIN categories c ON c.id=w.category_id JOIN events e ON e.id=c.event_id WHERE w.athlete_id=a.id AND e.sport=s.sport),0)::int points FROM athletes a JOIN athlete_sports s ON s.athlete_id=a.id WHERE a.is_public AND a.kind='self' ORDER BY points DESC,a.name`,
        )
      ).rows.filter((a) => !req.query.sport || a.sport === req.query.sport),
    ),
  );
  app.use("/api/v1/me", authenticateRequest);
  app.use("/api/v1/admin", authenticateRequest, admin);
  app.use("/api/v1/invites", authenticateRequest);
  // Rate limits are persisted and apply to protected mutations across server instances.
  app.use(
    ["/api/v1/me", "/api/v1/admin", "/api/v1/invites"],
    async (req, res, next) => {
      try {
        if (!["GET", "HEAD"].includes(req.method)) {
          const bucket = account(req).id + ":" + Math.floor(Date.now() / 60000);
          const r = await one(
            db,
            `INSERT INTO api_limits(bucket,count,resets_at) VALUES($1,1,now()+interval '2 minutes') ON CONFLICT(bucket) DO UPDATE SET count=api_limits.count+1 RETURNING count`,
            [bucket],
          );
          if (r.count > 40)
            fail(429, "Too many changes. Please wait a minute.");
        }
        next();
      } catch (e) {
        next(e);
      }
    },
  );
  app.get(
    "/api/v1/me",
    endpoint(async (req) => ({
      account: account(req),
      profiles: await profiles(db, account(req)),
      notifications: (
        await db.query(
          "SELECT * FROM notifications WHERE account_id=$1 ORDER BY created_at DESC LIMIT 100",
          [account(req).id],
        )
      ).rows,
      saved: (
        await db.query(
          "SELECT event_id FROM saved_events WHERE account_id=$1",
          [account(req).id],
        )
      ).rows.map((r) => r.event_id),
    })),
  );
  app.post(
    "/api/v1/me/profiles",
    endpoint(async (req) => ({
      id: await saveProfile(db, account(req), req.body),
    })),
  );
  app.put(
    "/api/v1/me/profiles/:id",
    endpoint(async (req) => ({
      id: await saveProfile(
        db,
        account(req),
        req.body,
        uuid.parse(req.params.id),
      ),
    })),
  );
  app.delete(
    "/api/v1/me/profiles/:id",
    endpoint(async (req) =>
      db.transaction(async (tx) => {
        const p = await owned(tx, account(req), uuid.parse(req.params.id));
        if (
          (
            await tx.query("SELECT 1 FROM entry_members WHERE athlete_id=$1", [
              p.id,
            ])
          ).rows.length
        )
          fail(
            409,
            "A profile with competition history cannot be removed individually. Use account deletion or contact admin.",
          );
        await tx.query("DELETE FROM athletes WHERE id=$1", [p.id]);
        await audit(tx, account(req), "profile.deleted", p.id);

        return { deleted: true };
      }),
    ),
  );
  app.post(
    "/api/v1/me/entries",
    endpoint(async (req) => register(db, account(req), req.body)),
  );
  app.get(
    "/api/v1/me/entries",
    endpoint(
      async (req) =>
        (
          await db.query(
            `SELECT en.*,ev.name event_name,ev.starts_at,ev.venue,ev.status event_status,c.name category_name,c.event_id,c.entry_type,c.format,(SELECT jsonb_agg(jsonb_build_object('id',p.id,'reference',p.reference,'status',p.status,'reason',p.reason,'mode',p.mode,'submitted_at',p.submitted_at)) FROM payments p WHERE p.entry_id=en.id) payments,(SELECT jsonb_agg(jsonb_build_object('name',a.name,'athlete_id',a.id)) FROM entry_members m JOIN athletes a ON a.id=m.athlete_id WHERE m.entry_id=en.id) members,(SELECT row_to_json(r) FROM refunds r WHERE r.entry_id=en.id) refund FROM entries en JOIN categories c ON c.id=en.category_id JOIN events ev ON ev.id=c.event_id WHERE en.owner_id=$1 OR EXISTS(SELECT 1 FROM entry_members m JOIN athletes a ON a.id=m.athlete_id WHERE m.entry_id=en.id AND a.owner_id=$1) ORDER BY en.created_at DESC`,
            [account(req).id],
          )
        ).rows,
    ),
  );
  app.get(
    "/api/v1/me/payment-instructions",
    endpoint(async () => {
      const live =
        process.env.PAYMENTS_MODE === "live" &&
        process.env.COMMERCIAL_LAUNCH_ENABLED === "true";
      if (live && !process.env.MERCHANT_UPI_ID)
        fail(503, "Merchant payment instructions have not been configured.");
      return {
        mode: live ? "live" : "test",
        merchant_name: live ? process.env.MERCHANT_NAME : null,
        upi_id: live ? process.env.MERCHANT_UPI_ID : null,
        instructions: live
          ? "Pay the entry amount to the merchant, then submit your transaction reference."
          : "TEST ONLY — do not send money. Submit a unique TEST- reference to exercise the admin review flow.",
      };
    }),
  );
  app.post(
    "/api/v1/me/entries/:id/payments",
    endpoint(async (req) => ({
      id: await submitPayment(
        db,
        account(req),
        uuid.parse(req.params.id),
        req.body,
        process.env.PAYMENTS_MODE === "live" &&
          process.env.COMMERCIAL_LAUNCH_ENABLED === "true"
          ? "live"
          : "test",
      ),
    })),
  );
  app.post(
    "/api/v1/me/entries/:id/withdraw",
    endpoint(async (req) => {
      await withdraw(db, account(req), uuid.parse(req.params.id));
      return { requested: true };
    }),
  );
  app.post(
    "/api/v1/me/saved/:id",
    endpoint(async (req) => {
      const id = uuid.parse(req.params.id);
      await one(db, `SELECT id FROM events WHERE id=$1 AND status<>'draft'`, [
        id,
      ]);
      if (req.body.saved === true)
        await db.query(
          "INSERT INTO saved_events(account_id,event_id) VALUES($1,$2) ON CONFLICT DO NOTHING",
          [account(req).id, id],
        );
      else
        await db.query(
          "DELETE FROM saved_events WHERE account_id=$1 AND event_id=$2",
          [account(req).id, id],
        );
      return { saved: req.body.saved === true };
    }),
  );
  app.post(
    "/api/v1/me/notifications/read",
    endpoint(async (req) => {
      await db.query(
        "UPDATE notifications SET read_at=now() WHERE account_id=$1",
        [account(req).id],
      );
      return { read: true };
    }),
  );
  app.get(
    "/api/v1/invites/:token",
    endpoint(async (req) => {
      if (!/^[a-f0-9]{48}$/.test(String(req.params.token)))
        fail(404, "Invitation not found.");
      const en = await one(
        db,
        `SELECT en.id,en.status,en.invite_expires_at,c.name category_name,c.gender,c.event_id,ev.name event_name,ev.sport FROM entries en JOIN categories c ON c.id=en.category_id JOIN events ev ON ev.id=c.event_id WHERE invite_token=$1`,
        [req.params.token],
      );
      return en;
    }),
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
          uuid.parse(req.body.athlete_id),
        ),
      };
    }),
  );
  app.get(
    "/api/v1/me/history/:id",
    endpoint(async (req) => {
      const a = await owned(db, account(req), uuid.parse(req.params.id));
      return {
        awards: (
          await db.query(
            "SELECT w.*,c.name category_name,e.name event_name,e.ends_at FROM awards w JOIN categories c ON c.id=w.category_id JOIN events e ON e.id=c.event_id WHERE w.athlete_id=$1 ORDER BY e.ends_at DESC",
            [a.id],
          )
        ).rows,
        matches: (
          await db.query(
            `SELECT m.*,e.name event_name,c.name category_name,em.entry_id my_entry FROM matches m JOIN categories c ON c.id=m.category_id JOIN events e ON e.id=c.event_id JOIN entry_members em ON em.entry_id=m.entry_a OR em.entry_id=m.entry_b WHERE em.athlete_id=$1 AND m.status IN ('completed','bye') ORDER BY e.starts_at DESC,m.round DESC`,
            [a.id],
          )
        ).rows,
      };
    }),
  );
  app.post(
    "/api/v1/me/disputes",
    endpoint(async (req) => {
      const matchId = uuid.parse(req.body.match_id),
        r = reason.parse(req.body.reason);
      const m = await one(db, "SELECT * FROM matches WHERE id=$1", [matchId]);
      if (
        !(
          await db.query(
            `SELECT 1 FROM entry_members em JOIN athletes a ON a.id=em.athlete_id WHERE (em.entry_id=$1 OR em.entry_id=$2) AND a.owner_id=$3`,
            [m.entry_a, m.entry_b, account(req).id],
          )
        ).rows.length
      )
        fail(403, "Only participants can dispute this match.");
      const id = randomUUID();
      await db.query(
        "INSERT INTO disputes(id,account_id,match_id,reason) VALUES($1,$2,$3,$4)",
        [id, account(req).id, m.id, r],
      );
      await audit(db, account(req), "dispute.created", id);
      return { id };
    }),
  );
  app.post(
    "/api/v1/me/payments/:id/correction",
    endpoint(async (req) =>
      db.transaction(async (tx) => {
        const payment = await one(tx, "SELECT * FROM payments WHERE id=$1", [
          uuid.parse(req.params.id),
        ]);
        await member(tx, account(req), payment.entry_id);
        if (payment.status === "confirmed")
          fail(
            409,
            "Confirmed transactions require admin refund review, not a replacement submission.",
          );
        const id = randomUUID(),
          text = reason.parse(req.body.reason);
        await tx.query(
          "INSERT INTO payment_corrections(id,payment_id,account_id,reason) VALUES($1,$2,$3,$4)",
          [id, payment.id, account(req).id, text],
        );
        await audit(
          tx,
          account(req),
          "payment.correction_requested",
          payment.id,
        );
        await tell(
          tx,
          payment.entry_id,
          "A payment correction was requested. Admin will review it.",
        );
        return { id };
      }),
    ),
  );
  app.post(
    "/api/v1/admin/corrections/:id/resolve",
    endpoint(async (req) =>
      db.transaction(async (tx) => {
        const before = await one(
          tx,
          "SELECT pc.*,p.entry_id FROM payment_corrections pc JOIN payments p ON p.id=pc.payment_id WHERE pc.id=$1",
          [uuid.parse(req.params.id)],
        );
        const en = await one(tx, "SELECT * FROM entries WHERE id=$1", [
          before.entry_id,
        ]);
        await one(tx, "SELECT id FROM categories WHERE id=$1 FOR UPDATE", [
          en.category_id,
        ]);
        const correction = await one(
          tx,
          "SELECT * FROM payment_corrections WHERE id=$1 FOR UPDATE",
          [before.id],
        );
        if (correction.status !== "open")
          fail(409, "This correction was already reviewed.");
        const p = await one(
            tx,
            "SELECT * FROM payments WHERE id=$1 FOR UPDATE",
            [correction.payment_id],
          ),
          text = reason.parse(req.body.resolution);
        if (p.status === "confirmed")
          fail(409, "Payment already confirmed. Handle refund separately.");
        await tx.query(
          `UPDATE payment_corrections SET status='resolved',resolution=$2 WHERE id=$1`,
          [correction.id, text],
        );
        if (req.body.allow_resubmit === true) {
          await tx.query(
            `UPDATE payments SET status='rejected',reason=$2,reviewed_by=$3,reviewed_at=now() WHERE id=$1`,
            [p.id, text, account(req).id],
          );
          if (
            ["awaiting_verification", "needs_review_no_seat"].includes(
              en.status,
            )
          )
            await tx.query(
              `UPDATE entries SET status='payment_rejected' WHERE id=$1`,
              [en.id],
            );
        }
        await tell(tx, en.id, "Payment correction reviewed: " + text);
        await audit(tx, account(req), "payment.correction_resolved", p.id, {
          allow_resubmit: req.body.allow_resubmit === true,
        });
        return { resolved: true };
      }),
    ),
  );
  app.post(
    "/api/v1/admin/payments/:id/refund",
    endpoint(async (req) =>
      db.transaction(async (tx) => {
        const p = await one(tx, "SELECT * FROM payments WHERE id=$1", [
            uuid.parse(req.params.id),
          ]),
          en = await one(tx, "SELECT * FROM entries WHERE id=$1", [p.entry_id]);
        await one(tx, "SELECT id FROM categories WHERE id=$1 FOR UPDATE", [
          en.category_id,
        ]);
        const payment = await one(
          tx,
          "SELECT * FROM payments WHERE id=$1 FOR UPDATE",
          [p.id],
        );
        await one(tx, "SELECT id FROM entries WHERE id=$1 FOR UPDATE", [en.id]);
        if (
          ![
            "needs_review_no_seat",
            "payment_rejected",
            "cancelled",
            "withdrawn",
          ].includes(en.status)
        )
          fail(409, "Use the normal review or withdrawal flow for this entry.");
        if (req.body.bank_checked !== true)
          fail(
            400,
            "Check the actual incoming transaction before creating a refund.",
          );
        const text = reason.parse(req.body.reason);
        if (
          (
            await tx.query(
              `SELECT 1 FROM payments WHERE entry_id=$1 AND status='confirmed' AND id<>$2`,
              [en.id, p.id],
            )
          ).rows.length
        )
          fail(
            409,
            "Another confirmed transaction already exists for this entry.",
          );
        await tx.query(
          `UPDATE payments SET status='confirmed',reason=$2,reviewed_by=$3,reviewed_at=now() WHERE id=$1`,
          [p.id, text, account(req).id],
        );
        await tx.query(
          `UPDATE entries SET status='withdrawn' WHERE id=$1 AND status<>'cancelled'`,
          [en.id],
        );
        await refund(tx, en, text);
        await tell(
          tx,
          en.id,
          "Your payment was bank-verified for refund. No tournament slot was added.",
        );
        await audit(
          tx,
          account(req),
          "payment.refund_task_created",
          payment.id,
        );
        return { pending_refund: true };
      }),
    ),
  );
  app.get(
    "/api/v1/admin/overview",
    endpoint(async () => ({
      events: (
        await db.query(
          `SELECT e.*,COALESCE((SELECT jsonb_agg(c) FROM categories c WHERE c.event_id=e.id),'[]') categories FROM events e ORDER BY starts_at DESC`,
        )
      ).rows,
      payments: (
        await db.query(
          `SELECT p.*,en.status entry_status,c.name category_name,ev.name event_name,extract(epoch FROM now()-p.submitted_at)>86400 overdue,(SELECT u.id FROM uploads u WHERE u.payment_id=p.id LIMIT 1) proof_id FROM payments p JOIN entries en ON en.id=p.entry_id JOIN categories c ON c.id=en.category_id JOIN events ev ON ev.id=c.event_id ORDER BY p.submitted_at DESC`,
        )
      ).rows,
      refunds: (
        await db.query(
          "SELECT r.*,ev.name event_name FROM refunds r JOIN entries en ON en.id=r.entry_id JOIN categories c ON c.id=en.category_id JOIN events ev ON ev.id=c.event_id ORDER BY r.created_at DESC",
        )
      ).rows,
      disputes: (
        await db.query("SELECT * FROM disputes ORDER BY created_at DESC")
      ).rows,
      corrections: (
        await db.query(
          `SELECT pc.*,p.reference,p.entry_id FROM payment_corrections pc JOIN payments p ON p.id=pc.payment_id ORDER BY pc.created_at DESC`,
        )
      ).rows,
      audit: (
        await db.query(
          "SELECT id,action,entity_id,created_at FROM audit ORDER BY created_at DESC LIMIT 100",
        )
      ).rows,
      claims: (
        await db.query(
          `SELECT a.id athlete_id,a.name,s.sport,s.rankings,COALESCE((SELECT jsonb_agg(r) FROM ranking_reviews r WHERE r.athlete_id=a.id AND r.sport=s.sport),'[]') reviews FROM athletes a JOIN athlete_sports s ON s.athlete_id=a.id WHERE jsonb_array_length(s.rankings)>0`,
        )
      ).rows,
    })),
  );
  app.post(
    "/api/v1/admin/events",
    endpoint(async (req) => ({
      id: await saveEvent(db, account(req), req.body),
    })),
  );
  app.put(
    "/api/v1/admin/events/:id",
    endpoint(async (req) => ({
      id: await saveEvent(
        db,
        account(req),
        req.body,
        uuid.parse(req.params.id),
      ),
    })),
  );
  app.post(
    "/api/v1/admin/events/:id/status",
    endpoint(async (req) => {
      const status = z
        .enum(["published", "closed", "completed", "cancelled"])
        .parse(req.body.status);
      await eventStatus(db, account(req), uuid.parse(req.params.id), status);
      return { status };
    }),
  );
  app.get(
    "/api/v1/admin/events/:id/entries",
    endpoint(
      async (req) =>
        (
          await db.query(
            `SELECT en.*,c.name category_name,(SELECT jsonb_agg(jsonb_build_object('id',a.id,'name',a.name,'dob',a.dob,'kind',a.kind,'phone',a.phone,'consent_at',a.consent_at,'guardian_name',a.guardian_name)) FROM entry_members m JOIN athletes a ON a.id=m.athlete_id WHERE m.entry_id=en.id) members FROM entries en JOIN categories c ON c.id=en.category_id WHERE c.event_id=$1 ORDER BY en.created_at`,
            [uuid.parse(req.params.id)],
          )
        ).rows,
    ),
  );
  app.post(
    "/api/v1/admin/payments/:id/review",
    endpoint(async (req) => {
      const p = z
        .object({
          approved: z.boolean(),
          bank_checked: z.literal(true),
          reason,
        })
        .parse(req.body);
      await reviewPayment(
        db,
        account(req),
        uuid.parse(req.params.id),
        p.approved,
        p.reason,
      );
      return { reviewed: true };
    }),
  );
  app.post(
    "/api/v1/admin/entries/:id/withdrawal",
    endpoint(async (req) =>
      db.transaction(async (tx) => {
        const id = uuid.parse(req.params.id);
        const before = await one(tx, "SELECT * FROM entries WHERE id=$1", [id]);
        await one(tx, "SELECT id FROM categories WHERE id=$1 FOR UPDATE", [
          before.category_id,
        ]);
        const en = await one(
          tx,
          "SELECT * FROM entries WHERE id=$1 FOR UPDATE",
          [id],
        );
        if (en.status !== "withdrawal_requested")
          fail(409, "Entry has no withdrawal request.");
        const r = reason.parse(req.body.reason);
        if (req.body.refund === true) await refund(tx, en, r);
        await tx.query(
          `UPDATE payments SET status='rejected',reason=$2,reviewed_at=now(),reviewed_by=$3 WHERE entry_id=$1 AND status='submitted'`,
          [id, "Withdrawal: " + r, account(req).id],
        );
        await tx.query(`UPDATE entries SET status='withdrawn' WHERE id=$1`, [
          id,
        ]);
        await audit(tx, account(req), "withdrawal.resolved", id, {
          refund: !!req.body.refund,
          reason: r,
        });
        await tell(tx, id, "Withdrawal completed: " + r);
        return { withdrawn: true };
      }),
    ),
  );
  app.post(
    "/api/v1/admin/refunds/:id",
    endpoint(async (req) =>
      db.transaction(async (tx) => {
        const r = await one(
          tx,
          "SELECT * FROM refunds WHERE id=$1 FOR UPDATE",
          [uuid.parse(req.params.id)],
        );
        if (r.status !== "pending") fail(409, "Refund already processed.");
        const bank = reason.parse(req.body.bank_reference);
        if (req.body.bank_checked !== true)
          fail(400, "Confirm that the refund was sent.");
        await tx.query(
          `UPDATE refunds SET status='processed',bank_reference=$2,admin_id=$3,processed_at=now() WHERE id=$1`,
          [r.id, bank, account(req).id],
        );
        await tell(tx, r.entry_id, "Refund processed. Reference: " + bank);
        await audit(tx, account(req), "refund.processed", r.id);
        return { processed: true };
      }),
    ),
  );
  app.post(
    "/api/v1/admin/categories/:id/draw",
    endpoint(async (req) =>
      draw(
        db,
        account(req),
        uuid.parse(req.params.id),
        req.body.seeds ? z.array(uuid).parse(req.body.seeds) : undefined,
      ),
    ),
  );
  app.get(
    "/api/v1/admin/events/:id/matches",
    endpoint(
      async (req) =>
        (
          await db.query(
            `SELECT m.*,c.name category_name,c.best_of,c.format,(SELECT string_agg(a.name,' / ' ORDER BY a.id) FROM entry_members em JOIN athletes a ON a.id=em.athlete_id WHERE em.entry_id=m.entry_a) label_a,(SELECT string_agg(a.name,' / ' ORDER BY a.id) FROM entry_members em JOIN athletes a ON a.id=em.athlete_id WHERE em.entry_id=m.entry_b) label_b FROM matches m JOIN categories c ON c.id=m.category_id WHERE c.event_id=$1 ORDER BY c.name,m.round,m.position`,
            [uuid.parse(req.params.id)],
          )
        ).rows,
    ),
  );
  app.put(
    "/api/v1/admin/matches/:id/schedule",
    endpoint(async (req) => {
      const p = z
        .object({
          court: z.string().trim().min(1).max(100),
          scheduled_at: z.iso.datetime({ offset: true }),
        })
        .parse(req.body);
      await db.transaction(async (tx) => {
        const m = await one(
          tx,
          `SELECT m.*,ev.starts_at,ev.ends_at FROM matches m JOIN categories c ON c.id=m.category_id JOIN events ev ON ev.id=c.event_id WHERE m.id=$1 FOR UPDATE OF m`,
          [uuid.parse(req.params.id)],
        );
        const t = new Date(p.scheduled_at);
        if (t < new Date(m.starts_at) || t > new Date(m.ends_at))
          fail(400, "Schedule must be inside the event dates.");
        if (m.status !== "pending")
          fail(409, "Completed matches cannot be rescheduled.");
        await tx.query(
          "UPDATE matches SET scheduled_at=$2,court=$3 WHERE id=$1",
          [m.id, p.scheduled_at, p.court],
        );
        await audit(tx, account(req), "match.scheduled", m.id, p);
        for (const en of [m.entry_a, m.entry_b].filter(Boolean))
          await tell(
            tx,
            en,
            "Match schedule updated: " + p.court + " · " + p.scheduled_at,
          );
      });
      return { scheduled: true };
    }),
  );
  app.post(
    "/api/v1/admin/matches/:id/result",
    endpoint(async (req) => {
      await recordResult(db, account(req), uuid.parse(req.params.id), req.body);
      return { published: true };
    }),
  );
  app.post(
    "/api/v1/admin/events/:id/announcements",
    endpoint(async (req) => {
      const id = uuid.parse(req.params.id),
        text = reason.parse(req.body.text);
      await db.transaction(async (tx) => {
        await one(tx, "SELECT id FROM events WHERE id=$1", [id]);
        await tx.query(
          "INSERT INTO announcements(id,event_id,text) VALUES($1,$2,$3)",
          [randomUUID(), id, text],
        );
        const entries = (
          await tx.query(
            "SELECT en.id FROM entries en JOIN categories c ON c.id=en.category_id WHERE c.event_id=$1",
            [id],
          )
        ).rows;
        for (const en of entries) await tell(tx, en.id, text);
        await audit(tx, account(req), "announcement.published", id);
      });
      return { published: true };
    }),
  );
  app.post(
    "/api/v1/admin/disputes/:id/resolve",
    endpoint(async (req) => {
      const id = uuid.parse(req.params.id),
        text = reason.parse(req.body.resolution);
      await db.transaction(async (tx) => {
        const d = await one(
          tx,
          `SELECT * FROM disputes WHERE id=$1 AND status='open' FOR UPDATE`,
          [id],
        );
        await tx.query(
          `UPDATE disputes SET status='resolved',resolution=$2 WHERE id=$1`,
          [id, text],
        );
        await tx.query(
          "INSERT INTO notifications(id,account_id,text) VALUES($1,$2,$3)",
          [randomUUID(), d.account_id, "Dispute resolved: " + text],
        );
        await audit(tx, account(req), "dispute.resolved", id);
      });
      return { resolved: true };
    }),
  );
  app.post(
    "/api/v1/admin/rankings/review",
    endpoint(async (req) => {
      const p = z
        .object({
          athlete_id: uuid,
          sport: z.string(),
          scope: z.enum(["state", "national"]),
          status: z.enum(["verified", "rejected"]),
          reason,
        })
        .parse(req.body);
      const s = await one(
        db,
        "SELECT rankings FROM athlete_sports WHERE athlete_id=$1 AND sport=$2",
        [p.athlete_id, p.sport],
      );
      const claim = s.rankings.find((r: any) => r.scope === p.scope);
      if (!claim) fail(404, "Ranking claim not found.");
      await db.transaction(async (tx) => {
        await tx.query(
          `INSERT INTO ranking_reviews(id,athlete_id,sport,scope,status,source_snapshot,reason,admin_id) VALUES($1,$2,$3,$4,$5,$6,$7,$8) ON CONFLICT(athlete_id,sport,scope) DO UPDATE SET status=excluded.status,source_snapshot=excluded.source_snapshot,reason=excluded.reason,admin_id=excluded.admin_id,created_at=now()`,
          [
            randomUUID(),
            p.athlete_id,
            p.sport,
            p.scope,
            p.status,
            JSON.stringify(claim),
            p.reason,
            account(req).id,
          ],
        );
        await audit(tx, account(req), "ranking.reviewed", p.athlete_id, {
          sport: p.sport,
          scope: p.scope,
          status: p.status,
        });
      });
      return { reviewed: true };
    }),
  );
  app.get(
    "/api/v1/admin/events/:id/export",
    endpoint(async (req, res) => {
      const rows = (
        await db.query(
          `SELECT en.id,c.name category,en.status,en.fee,(SELECT string_agg(a.name,' / ') FROM entry_members m JOIN athletes a ON a.id=m.athlete_id WHERE m.entry_id=en.id) athletes,p.reference,p.status payment_status FROM entries en JOIN categories c ON c.id=en.category_id LEFT JOIN payments p ON p.entry_id=en.id WHERE c.event_id=$1 ORDER BY en.created_at`,
          [uuid.parse(req.params.id)],
        )
      ).rows;
      const cell = (v: any) =>
        '"' +
        String(v ?? "")
          .replace(/^[=+@-]/, "'$&")
          .replaceAll('"', '""') +
        '"';
      const cols = [
        "id",
        "category",
        "status",
        "fee",
        "athletes",
        "reference",
        "payment_status",
      ];
      res.setHeader("Content-Type", "text/csv");
      res.setHeader(
        "Content-Disposition",
        'attachment; filename="rally-event-report.csv"',
      );
      res.send(
        cols.join(",") +
          "\n" +
          rows.map((r) => cols.map((c) => cell(r[c])).join(",")).join("\n"),
      );
    }),
  );
  app.post(
    "/api/v1/me/uploads",
    endpoint(async (req) => {
      const a = account(req);
      const p = z
        .object({
          purpose: z.enum(["proof", "poster", "avatar"]),
          base64: z.string().max(2800000),
        })
        .parse(req.body);
      if (p.purpose === "poster" && a.role !== "admin")
        fail(403, "Only admin can upload posters.");
      const bytes = Buffer.from(p.base64, "base64");
      if (bytes.length > 2 * 1024 * 1024 || bytes.length < 10)
        fail(400, "Upload an image smaller than 2 MB.");
      const img = sharp(bytes, { limitInputPixels: 16000000 });
      const meta = await img.metadata();
      if (!["jpeg", "png", "webp"].includes(meta.format || ""))
        fail(400, "Only JPEG, PNG and WebP images are supported.");
      const cleaned = await img
        .rotate()
        .resize({
          width: 1600,
          height: 1600,
          fit: "inside",
          withoutEnlargement: true,
        })
        .jpeg({ quality: 80 })
        .toBuffer();
      const token =
        p.purpose !== "poster"
          ? process.env.PRIVATE_BLOB_READ_WRITE_TOKEN
          : process.env.PUBLIC_BLOB_READ_WRITE_TOKEN;
      if (!token && !options.storage)
        fail(503, "Image storage has not been configured.", "SETUP_REQUIRED");
      const id = randomUUID();
      const blob = await storage.put(
        `${p.purpose}/${a.id}/${id}.jpg`,
        cleaned,
        {
          access: p.purpose !== "poster" ? "private" : "public",
          contentType: "image/jpeg",
          token,
        },
      );
      await db.query(
        "INSERT INTO uploads(id,owner_id,purpose,pathname,url,content_type) VALUES($1,$2,$3,$4,$5,$6)",
        [id, a.id, p.purpose, blob.pathname, blob.url, "image/jpeg"],
      );
      return { id, url: p.purpose !== "poster" ? null : blob.url };
    }),
  );
  app.get(
    "/api/v1/me/uploads/:id",
    endpoint(async (req, res) => {
      const u = await one(db, "SELECT * FROM uploads WHERE id=$1", [
        uuid.parse(req.params.id),
      ]);
      if (u.owner_id !== account(req).id && account(req).role !== "admin")
        fail(404, "File not found.");
      if (u.purpose === "poster") return { url: u.url };
      const file = await storage.get(u.pathname, {
        access: "private",
        token: process.env.PRIVATE_BLOB_READ_WRITE_TOKEN,
      });
      if (!file || file.statusCode !== 200 || !file.stream)
        fail(404, "File not found.");
      res.setHeader("Content-Type", u.content_type);
      res.setHeader("Cache-Control", "private,no-store");
      const reader = file!.stream!.getReader();
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        res.write(Buffer.from(value));
      }
      res.end();
    }),
  );
  app.delete(
    "/api/v1/me/account",
    endpoint(async (req) => {
      const a = account(req);
      const i = await verify(req);
      if (a.role === "admin")
        fail(
          409,
          "Transfer platform administration before deleting the admin account.",
        );
      const active = await db.query(
        `SELECT 1 FROM entries en JOIN categories c ON c.id=en.category_id JOIN events e ON e.id=c.event_id WHERE (en.owner_id=$1 OR EXISTS(SELECT 1 FROM entry_members m JOIN athletes p ON p.id=m.athlete_id WHERE m.entry_id=en.id AND p.owner_id=$1)) AND e.status NOT IN ('completed','cancelled') AND en.status NOT IN ('expired','withdrawn','cancelled','payment_rejected')`,
        [a.id],
      );
      if (active.rows.length)
        fail(409, "Withdraw active entries before deleting the account.");
      const uploads = (
        await db.query("SELECT * FROM uploads WHERE owner_id=$1", [a.id])
      ).rows;
      for (const u of uploads)
        await storage.del(u.url, {
          token:
            u.purpose !== "poster"
              ? process.env.PRIVATE_BLOB_READ_WRITE_TOKEN
              : process.env.PUBLIC_BLOB_READ_WRITE_TOKEN,
        });

      await db.transaction(async (tx) => {
        await tx.query("DELETE FROM uploads WHERE owner_id=$1", [a.id]);
        await tx.query(
          "DELETE FROM ranking_reviews WHERE athlete_id IN (SELECT id FROM athletes WHERE owner_id=$1)",
          [a.id],
        );
        await tx.query(
          `UPDATE athlete_sports SET rankings='[]' WHERE athlete_id IN (SELECT id FROM athletes WHERE owner_id=$1)`,
          [a.id],
        );
        await tx.query(
          `UPDATE athletes SET name='Deleted athlete',dob='1900-01-01',gender='prefer_not_to_say',state='',city='',phone='',guardian_name=NULL,guardian_relationship=NULL,consent_at=NULL,is_public=false,photo_url=NULL,academy=NULL,coach=NULL,goal=NULL WHERE owner_id=$1`,
          [a.id],
        );
        await tx.query(
          `UPDATE payments SET payer_name='Deleted account',reference='DELETED-'||id::text WHERE entry_id IN (SELECT id FROM entries WHERE owner_id=$1)`,
          [a.id],
        );
        await tx.query(
          `UPDATE entries SET emergency_contact='',school=NULL WHERE owner_id=$1`,
          [a.id],
        );
        await tx.query("DELETE FROM saved_events WHERE account_id=$1", [a.id]);
        await tx.query("DELETE FROM notifications WHERE account_id=$1", [a.id]);
        await tx.query(
          `UPDATE accounts SET email='',deleted_at=now() WHERE id=$1`,
          [a.id],
        );
        await tx.query(
          "UPDATE disputes SET reason='Deleted account',resolution=NULL WHERE account_id=$1",
          [a.id],
        );
        await tx.query(
          "UPDATE payment_corrections SET reason='Deleted account',resolution=NULL WHERE account_id=$1",
          [a.id],
        );
        await audit(tx, a, "account.deleted", a.id);
      });
      if (!options.authenticate) {
        try {
          await firebaseAdmin().deleteUser(i.uid);
        } catch (e: any) {
          if (e.code !== "auth/user-not-found")
            throw Object.assign(
              new Error(
                "Your data was removed. Retry deletion to finish removing sign-in access.",
              ),
              { status: 503 },
            );
        }
      }
      return { deleted: true };
    }),
  );
  app.use((req, res) =>
    res
      .status(404)
      .json({ error: { code: "NOT_FOUND", message: "API route not found." } }),
  );
  app.use((err: any, req: Request, res: Response, next: any) => {
    if (res.headersSent) return next(err);
    const status =
      err instanceof z.ZodError
        ? 400
        : err.status ||
          (err.code === "23505"
            ? 409
            : err.code?.startsWith("auth/")
              ? 401
              : 500);
    if (status >= 500)
      console.error("api_error", {
        path: req.path,
        code: err.code || "SERVER_ERROR",
      });
    res.status(status).json({
      error: {
        code: err.code || "REQUEST_FAILED",
        message:
          err instanceof z.ZodError
            ? err.issues.map((i) => i.message).join("; ")
            : status >= 500 && status !== 503
              ? "Something went wrong. Please retry."
              : err.code === "23505"
                ? "This record already exists."
                : err.message || "Request failed.",
      },
    });
  });
  return app;
}
