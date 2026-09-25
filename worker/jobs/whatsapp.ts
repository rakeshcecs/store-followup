import type { Job } from "@/generated/prisma/client";
import type { JobPayloads } from "@/lib/jobs/types";
import { deliverWhatsApp } from "@/lib/whatsapp/send";

// M22: sends one queued WhatsApp message. A rate limit or a Meta hiccup throws, and the
// queue tries again (1, then 2 minutes later); on the last try the message is marked
// FAILED with Meta's reason instead.
export async function handleWhatsAppSend(job: Job): Promise<void> {
  const { messageId } = job.payload as JobPayloads["whatsapp-send"];
  await deliverWhatsApp(messageId, job.attempts >= job.maxAttempts);
}
