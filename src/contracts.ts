import type { z } from "zod";
import type {
  profileInput,
  eventInput,
  entryInput,
  paymentInput,
} from "../server/validation";
export type ProfileRequest = z.infer<typeof profileInput>;
export type EventRequest = z.infer<typeof eventInput>;
export type EntryRequest = z.infer<typeof entryInput>;
export type PaymentRequest = z.infer<typeof paymentInput>;
type CategoryInput = EventRequest["categories"][number];
export interface Category extends CategoryInput {
  id: string;
  event_id: string;
  remaining?: number;
  draw_published: boolean;
}
export interface Tournament extends Omit<EventRequest, "categories"> {
  id: string;
  status: "draft" | "published" | "closed" | "completed" | "cancelled";
  categories: Category[];
  announcements?: { id: string; text: string; created_at: string }[];
}
export interface Athlete extends ProfileRequest {
  id: string;
  owner_id: string;
  consent_at: string | null;
  points: number;
  ranking_reviews: {
    sport: string;
    scope: "state" | "national";
    status: "verified" | "rejected";
  }[];
}
export interface Me {
  account: { id: string; email: string; role: "athlete" | "admin" };
  profiles: Athlete[];
  notifications: {
    id: string;
    text: string;
    created_at: string;
    read_at: string | null;
  }[];
  saved: string[];
}
export interface Health {
  status: string;
  database_configured: boolean;
  auth_configured: boolean;
  payments_mode: "test" | "live";
}
export interface RankingRow {
  id: string;
  name: string;
  city: string;
  sport: string;
  points: number;
}
