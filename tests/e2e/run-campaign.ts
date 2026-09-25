// Runs the worker's campaign job once for one campaign, the way `npm run worker` would:
// `npx tsx tests/e2e/run-campaign.ts <campaignId>`. Used by campaigns.spec.ts, whose own
// runtime (Playwright's loader) cannot import the message files the library reads.
import "dotenv/config";
import { runCampaign } from "@/lib/campaigns/send";
import { db } from "@/lib/db";

async function main() {
  const campaignId = process.argv[2];
  if (!campaignId) throw new Error("campaign id missing");
  const queued = await runCampaign(campaignId);
  console.log(`RESULT=${JSON.stringify(queued)}`);
  await db.$disconnect();
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
