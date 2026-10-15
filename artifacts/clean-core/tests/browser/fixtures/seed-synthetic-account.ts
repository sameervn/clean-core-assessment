/**
 * Seed or remove a synthetic test account (never the real admin).
 *
 *   SYNTHETIC_PASSWORD='at-least-14-chars' pnpm --filter @workspace/clean-core exec tsx tests/browser/fixtures/seed-synthetic-account.ts create Admin
 *   pnpm --filter @workspace/clean-core exec tsx tests/browser/fixtures/seed-synthetic-account.ts delete <id>
 *
 * Prints JSON {id, username, role}. The password is never printed.
 */
import { createSyntheticAccount, deleteSyntheticAccounts, closeFixturePool } from "./accounts-db";

const [command, arg] = process.argv.slice(2);
try {
  if (command === "create") {
    const role = (arg || "Admin") as "Admin" | "Developer" | "Reviewer";
    if (!["Admin", "Developer", "Reviewer"].includes(role)) throw new Error("role must be Admin, Developer or Reviewer");
    const password = process.env.SYNTHETIC_PASSWORD;
    if (!password || password.length < 14 || password.length > 128) throw new Error("set SYNTHETIC_PASSWORD (14-128 chars)");
    const { id, username } = await createSyntheticAccount({ role, password });
    console.log(JSON.stringify({ id, username, role }));
  } else if (command === "delete" && arg) {
    await deleteSyntheticAccounts([arg]);
    console.log(JSON.stringify({ deleted: arg }));
  } else {
    throw new Error("usage: create [Admin|Developer|Reviewer] | delete <id>");
  }
} finally {
  await closeFixturePool();
}
