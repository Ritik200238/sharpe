import { record, setup, snapshot } from "./flows";

async function main(): Promise<void> {
  const [command, arg] = process.argv.slice(2);
  switch (command) {
    case "setup":
      return setup();
    case "record":
      return record();
    case "snapshot":
      if (!arg) throw new Error('Usage: snapshot "/path/after/api"');
      return snapshot(arg);
    default:
      throw new Error(`Unknown command "${command}". Use: setup | record | snapshot`);
  }
}

main().catch((error) => {
  console.error(error?.response?.data ?? error);
  process.exit(1);
});
