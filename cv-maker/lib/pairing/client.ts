// Client-side helpers for the pairing UI. Nothing secret lives on this side.

"use client";

import type { JobPosting } from "@/lib/discovery/types";
import type { DeviceSummary } from "./types";

export interface PairBeginResponse {
  code: string;
  expiresAt: number;
}

export async function beginPairing(): Promise<PairBeginResponse> {
  const res = await fetch("/api/pair/begin", { method: "POST" });
  if (!res.ok) throw new Error(`begin pairing failed (${res.status})`);
  return (await res.json()) as PairBeginResponse;
}

export interface PairStatus {
  status: "pending" | "bound" | "expired";
  boundDeviceId?: string;
}

export async function pollPairStatus(code: string): Promise<PairStatus> {
  const url = `/api/pair/begin/status?code=${encodeURIComponent(code)}`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`status poll failed (${res.status})`);
  return (await res.json()) as PairStatus;
}

export async function listDevices(): Promise<DeviceSummary[]> {
  const res = await fetch("/api/pair/devices", { cache: "no-store" });
  if (!res.ok) throw new Error(`list devices failed (${res.status})`);
  const data = (await res.json()) as { devices: DeviceSummary[] };
  return data.devices;
}

export async function revokeDevice(deviceId: string): Promise<void> {
  const res = await fetch("/api/pair/revoke", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ deviceId }),
  });
  if (!res.ok) throw new Error(`revoke failed (${res.status})`);
}

export async function pullInbox(): Promise<JobPosting[]> {
  const res = await fetch("/api/pair/pull", { method: "POST" });
  if (!res.ok) throw new Error(`pull failed (${res.status})`);
  const data = (await res.json()) as { postings: JobPosting[] };
  return data.postings;
}

export async function pendingCount(): Promise<number> {
  const res = await fetch("/api/pair/pending-count", { cache: "no-store" });
  if (!res.ok) return 0;
  const data = (await res.json()) as { count: number };
  return data.count ?? 0;
}
