import { record, setup } from "./flows";

const delay = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Unattended P0 driver: keep attempting setup (faucet may be dry for hours);
 * the moment signup succeeds, fall straight into recording. Never exits on
 * its own — this is the "start it and sleep" path.
 */
async function main(): Promise<void> {
  for (let attempt = 1; ; attempt++) {
    try {
      await setup();
      break;
    } catch (error: any) {
      const message = error?.response?.data
        ? JSON.stringify(error.response.data)
        : (error?.message ?? String(error));
      console.log(`[bootstrap] setup attempt ${attempt} failed: ${message}`);
      const waitMinutes = Math.min(20, 5 * attempt);
      console.log(`[bootstrap] retrying in ${waitMinutes} min`);
      await delay(waitMinutes * 60_000);
    }
  }

  console.log("[bootstrap] setup complete — starting recorder");
  for (;;) {
    try {
      await record();
    } catch (error: any) {
      console.log(`[bootstrap] recorder crashed: ${error?.message ?? error} — restarting in 30s`);
      await delay(30_000);
    }
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
