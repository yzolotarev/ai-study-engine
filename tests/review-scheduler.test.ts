import assert from "node:assert/strict";
import test from "node:test";
import { getDueReviews, getOverdueReviews, scheduleReview } from "../src/core/review-scheduler.js";

test("scheduleReview calculates due date correctly", () => {
  const result = scheduleReview({
    sessionId: "session-1",
    targetId: "cauchy-riemann",
    delayDays: 7,
    now: () => "2026-08-15T00:00:00.000Z",
  }) as { reviewId: string; dueAt: string };

  assert.equal(typeof result.reviewId, "string");
  assert.equal(result.reviewId.length, 36);
  assert.equal(result.dueAt, "2026-08-22T00:00:00.000Z");
});

test("getDueReviews returns reviews that are due", () => {
  const reviews = [
    {
      reviewId: "review-1",
      sessionId: "session-1",
      targetId: "target-1",
      scheduledAt: "2026-08-15T00:00:00.000Z",
      dueAt: "2026-08-22T00:00:00.000Z",
      status: "pending" as const,
    },
    {
      reviewId: "review-2",
      sessionId: "session-1",
      targetId: "target-2",
      scheduledAt: "2026-08-15T00:00:00.000Z",
      dueAt: "2026-08-25T00:00:00.000Z",
      status: "pending" as const,
    },
    {
      reviewId: "review-3",
      sessionId: "session-1",
      targetId: "target-3",
      scheduledAt: "2026-08-15T00:00:00.000Z",
      dueAt: "2026-08-20T00:00:00.000Z",
      status: "completed" as const,
      completedAt: "2026-08-20T00:00:00.000Z",
    },
  ];

  const due = getDueReviews(reviews, () => "2026-08-23T00:00:00.000Z");
  assert.equal(due.length, 1);
  assert.equal((due[0]!).reviewId, "review-1");
});

test("getOverdueReviews returns reviews overdue by more than 1 day", () => {
  const reviews = [
    {
      reviewId: "review-1",
      sessionId: "session-1",
      targetId: "target-1",
      scheduledAt: "2026-08-15T00:00:00.000Z",
      dueAt: "2026-08-20T00:00:00.000Z",
      status: "pending" as const,
    },
    {
      reviewId: "review-2",
      sessionId: "session-1",
      targetId: "target-2",
      scheduledAt: "2026-08-15T00:00:00.000Z",
      dueAt: "2026-08-22T00:00:00.000Z",
      status: "pending" as const,
    },
  ];

  const overdue = getOverdueReviews(reviews, () => "2026-08-23T00:00:00.000Z");
  assert.equal(overdue.length, 1);
  assert.equal((overdue[0]!).reviewId, "review-1");
});