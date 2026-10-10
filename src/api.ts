import type { Me, Health, Tournament, RankingRow } from "./contracts";
import { getAuth } from "firebase/auth";
export class ApiError extends Error {
  constructor(
    message: string,
    public status: number,
  ) {
    super(message);
  }
}
export function api(path: "/me", method?: string, body?: unknown): Promise<Me>;
export function api(
  path: "/health",
  method?: string,
  body?: unknown,
): Promise<Health>;
export function api(
  path: "/events",
  method?: string,
  body?: unknown,
): Promise<Tournament[]>;
export function api(
  path: "/rankings",
  method?: string,
  body?: unknown,
): Promise<RankingRow[]>;
export function api<T = any>(
  path: string,
  method?: string,
  body?: unknown,
): Promise<T>;
export async function api<T = any>(
  path: string,
  method = "GET",
  body?: unknown,
): Promise<T> {
  const headers: Record<string, string> = {};
  if (body !== undefined) headers["Content-Type"] = "application/json";
  try {
    const user = getAuth().currentUser;
    if (user) headers.Authorization = "Bearer " + (await user.getIdToken());
  } catch {
    /* Firebase may be unconfigured for public browsing. */
  }
  const r = await fetch("/api/v1" + path, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const data = await r.json();
  if (!r.ok)
    throw new ApiError(
      data.error?.message || data.error || "Request failed.",
      r.status,
    );
  return data.data;
}
export const money = (n: number) =>
  new Intl.NumberFormat("en-IN", {
    style: "currency",
    currency: "INR",
    maximumFractionDigits: 0,
  }).format(n / 100);
export const date = (s: string) =>
  s
    ? new Date(s).toLocaleString("en-IN", {
        dateStyle: "medium",
        timeStyle: "short",
      })
    : "To be announced";
export { sports } from "../shared/sports";
export const levels = [
  "Beginner",
  "Amateur",
  "Competitive amateur",
  "Semi-professional",
  "Professional",
];
export async function upload(file: File, purpose: string) {
  if (file.size > 2 * 1024 * 1024)
    throw new Error("Choose an image smaller than 2 MB.");
  const base64 = await new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result).split(",")[1]);
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
  return api("/me/uploads", "POST", { purpose, base64 });
}
