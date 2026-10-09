import { cert, getApps, initializeApp } from "firebase-admin/app";
import { getAuth } from "firebase-admin/auth";
import type { Request } from "express";
export interface Identity {
  uid: string;
  email: string;
  verified: boolean;
}
export function firebaseAdmin() {
  if (!getApps().length) {
    if (
      !process.env.FIREBASE_PROJECT_ID ||
      !process.env.FIREBASE_CLIENT_EMAIL ||
      !process.env.FIREBASE_PRIVATE_KEY
    )
      throw Object.assign(new Error("Authentication setup is required."), {
        status: 503,
        code: "SETUP_REQUIRED",
      });
    initializeApp({
      credential: cert({
        projectId: process.env.FIREBASE_PROJECT_ID,
        clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
        privateKey: process.env.FIREBASE_PRIVATE_KEY.replace(/\\n/g, "\n"),
      }),
    });
  }
  return getAuth();
}
export async function authenticate(req: Request): Promise<Identity> {
  const h = req.headers.authorization;
  if (!h?.startsWith("Bearer "))
    throw Object.assign(new Error("Sign in to continue."), { status: 401 });
  const t = await firebaseAdmin().verifyIdToken(h.slice(7), true);
  if (!t.email || !t.email_verified)
    throw Object.assign(new Error("Verify your email before continuing."), {
      status: 403,
    });
  return { uid: t.uid, email: t.email, verified: !!t.email_verified };
}
