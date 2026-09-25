import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import { db } from "@/lib/db";
import {
  claimJobs,
  completeJob,
  enqueue,
  failJob,
  purgeFinishedJobs,
  releaseStaleJobs,
  touchJob,
} from "@/lib/jobs/queue";
import { runOnce } from "../../worker/run";

vi.mock("@/lib/logger", () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));

beforeEach(async () => {
  await db.job.deleteMany();
});

afterAll(() => db.$disconnect());

describe("job queue", () => {
  it("enqueues, claims and completes a job", async () => {
    const job = await enqueue("test", { note: "hi" });
    expect(job.status).toBe("PENDING");

    const [claimed] = await claimJobs("w1");
    expect(claimed).toMatchObject({ id: job.id, status: "RUNNING", lockedBy: "w1", attempts: 1 });

    await completeJob(job.id);
    const done = await db.job.findUniqueOrThrow({ where: { id: job.id } });
    expect(done.status).toBe("DONE");
    expect(done.finishedAt).not.toBeNull();
  });

  it("does not claim jobs that are due later", async () => {
    await enqueue("test", { note: "later" }, { runAt: new Date(Date.now() + 60 * 60_000) });
    expect(await claimJobs("w1")).toEqual([]);
  });

  it("never gives the same job to two workers at once", async () => {
    for (let i = 0; i < 6; i++) await enqueue("test", { note: `job ${i}` });
    const [a, b] = await Promise.all([claimJobs("w1", 4), claimJobs("w2", 4)]);
    const ids = [...a, ...b].map((j) => j.id);
    expect(ids).toHaveLength(6);
    expect(new Set(ids).size).toBe(6);
  });

  it("retries with a delay, then fails after maxAttempts", async () => {
    const job = await enqueue("test", { note: "flaky" }, { maxAttempts: 2 });

    await claimJobs("w1");
    const retry = await failJob(job.id, new Error("network down"));
    expect(retry.status).toBe("PENDING");
    expect(retry.lastError).toBe("network down");
    expect(retry.runAt.getTime()).toBeGreaterThan(Date.now() + 50_000);

    await db.job.update({ where: { id: job.id }, data: { runAt: new Date(Date.now() - 1000) } });
    await claimJobs("w1");
    const failed = await failJob(job.id, new Error("still down"));
    expect(failed.status).toBe("FAILED");
    expect(failed.attempts).toBe(2);
  });

  it("returns the existing job for a repeated singletonKey", async () => {
    const first = await enqueue("purge-jobs", {}, { singletonKey: "purge-jobs:2026-09-22" });
    const second = await enqueue("purge-jobs", {}, { singletonKey: "purge-jobs:2026-09-22" });
    expect(second.id).toBe(first.id);
    expect(await db.job.count()).toBe(1);
  });

  it("puts jobs from a crashed worker back in the queue", async () => {
    const job = await enqueue("test", { note: "stuck" });
    await claimJobs("crashed");
    await db.job.update({
      where: { id: job.id },
      data: { lockedAt: new Date(Date.now() - 20 * 60_000) },
    });
    expect(await releaseStaleJobs(10)).toBe(1);
    expect((await db.job.findUniqueOrThrow({ where: { id: job.id } })).status).toBe("PENDING");
  });

  it("a worker whose job was handed on cannot finish or fail it any more", async () => {
    const job = await enqueue("test", { note: "slow" });
    await claimJobs("w1");
    await db.job.update({
      where: { id: job.id },
      data: { lockedAt: new Date(Date.now() - 20 * 60_000) },
    });
    await releaseStaleJobs(10);
    await claimJobs("w2");

    await completeJob(job.id, "w1");
    await failJob(job.id, new Error("late"), { workerId: "w1" });
    const row = await db.job.findUniqueOrThrow({ where: { id: job.id } });
    expect(row).toMatchObject({ status: "RUNNING", lockedBy: "w2", lastError: null });

    await completeJob(job.id, "w2");
    expect((await db.job.findUniqueOrThrow({ where: { id: job.id } })).status).toBe("DONE");
  });

  it("a job that says it is alive is not released as stale", async () => {
    const job = await enqueue("test", { note: "long import" });
    await claimJobs("w1");
    await db.job.update({
      where: { id: job.id },
      data: { lockedAt: new Date(Date.now() - 20 * 60_000) },
    });
    await touchJob(job.id, "w1");
    expect(await releaseStaleJobs(10)).toBe(0);
  });

  it("purges only old DONE jobs", async () => {
    const old = new Date(Date.now() - 40 * 86_400_000);
    const oldDone = await enqueue("test", { note: "old" });
    const oldFailed = await enqueue("test", { note: "old failed" });
    const recentDone = await enqueue("test", { note: "recent" });
    await db.job.update({ where: { id: oldDone.id }, data: { status: "DONE", finishedAt: old } });
    await db.job.update({
      where: { id: oldFailed.id },
      data: { status: "FAILED", finishedAt: old },
    });
    await db.job.update({
      where: { id: recentDone.id },
      data: { status: "DONE", finishedAt: new Date() },
    });

    expect(await purgeFinishedJobs(30)).toBe(1);
    expect(await db.job.count()).toBe(2);
  });
});

describe("worker runOnce", () => {
  it("runs a test job to DONE", async () => {
    const job = await enqueue("test", { note: "e2e" });
    expect(await runOnce("w-test")).toBe(1);
    expect((await db.job.findUniqueOrThrow({ where: { id: job.id } })).status).toBe("DONE");
  });

  it("marks a job with an unknown type FAILED without retrying", async () => {
    const job = await db.job.create({ data: { type: "does-not-exist", payload: {} } });
    await runOnce("w-test");
    const failed = await db.job.findUniqueOrThrow({ where: { id: job.id } });
    expect(failed.status).toBe("FAILED");
    expect(failed.lastError).toContain("No handler");
  });

  it("retries a job whose handler throws", async () => {
    const job = await enqueue("test", { note: "boom" });
    await runOnce("w-test", {
      test: async () => {
        throw new Error("boom");
      },
    });
    const retry = await db.job.findUniqueOrThrow({ where: { id: job.id } });
    expect(retry.status).toBe("PENDING");
    expect(retry.attempts).toBe(1);
  });
});
