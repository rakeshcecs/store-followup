// `npm run worker:test` — adds one test job; a running worker should pick it up within seconds.
import "dotenv/config";
import { db } from "@/lib/db";
import { enqueue } from "@/lib/jobs/queue";

async function main() {
  const job = await enqueue("test", { note: "M01 check" });
  console.log(`Test job queued: ${job.id}`);
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => db.$disconnect());
