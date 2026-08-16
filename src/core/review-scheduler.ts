import { randomUUID } from "node:crypto";

export interface ReviewItem {
  readonly reviewId: string;
  readonly sessionId: string;
  readonly targetId: string;
  readonly scheduledAt: string;
  readonly dueAt: string;
  readonly status: "pending" | "completed" | "overdue" | "cancelled";
  readonly completedAt?: string;
  readonly completionEvidenceId?: string;
}

export function scheduleReview(input: {
  sessionId: string;
  targetId: string;
  delayDays: number;
  now?: () => string;
}): { reviewId: string; dueAt: string } {
  const timestamp = input.now ? input.now() : new Date().toISOString();
  const dueDate = new Date(timestamp);
  dueDate.setDate(dueDate.getDate() + input.delayDays);
  const dueAt = dueDate.toISOString();

  return {
    reviewId: randomUUID(),
    dueAt,
  };
}

export function getDueReviews(reviews: readonly ReviewItem[], now?: () => string): readonly ReviewItem[] {
  const currentTime = now ? now() : new Date().toISOString();
  return reviews.filter(
    (review) => review.status === "pending" && review.dueAt <= currentTime,
  );
}

export function getOverdueReviews(reviews: readonly ReviewItem[], now?: () => string): readonly ReviewItem[] {
  const currentTime = now ? now() : new Date().toISOString();
  const overdueThreshold = new Date(currentTime);
  overdueThreshold.setDate(overdueThreshold.getDate() - 1);
  const threshold = overdueThreshold.toISOString();

  return reviews.filter(
    (review) => review.status === "pending" && review.dueAt < threshold,
  );
}

/**
 * Computes a spaced-review due date from the goal contract retentionDays.
 * Falls back to a 1-day delay when unspecified.
 */
export function computeReviewDueAt(retentionDays?: number): string {
  const days = retentionDays && retentionDays > 0 ? retentionDays : 1;
  const due = new Date();
  due.setDate(due.getDate() + days);
  return due.toISOString();
}