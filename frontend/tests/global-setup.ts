import { execSync } from "node:child_process";
import path from "node:path";

// Brings up the isolated full-stack container (docker-compose.e2e.yml) and
// returns the teardown, which removes it along with its throwaway database.
const compose = `docker compose -p pm-e2e -f "${path.resolve(__dirname, "../../docker-compose.e2e.yml")}"`;

export default function globalSetup() {
  execSync(`${compose} up -d --build --force-recreate --wait`, { stdio: "inherit" });
  return () => {
    execSync(`${compose} down`, { stdio: "inherit" });
  };
}
