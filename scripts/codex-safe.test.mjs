#!/usr/bin/env node

import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { cp, mkdir, mkdtemp, readFile, rm, symlink, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import {
  applyInstall,
  createInstallPlan,
  loadAndVerifyDistribution,
  validateReleaseState,
  verifyInstalled,
} from "./install-codex-safe.mjs";

const scriptPath = fileURLToPath(import.meta.url);
const repoRoot = path.resolve(path.dirname(scriptPath), "..");
const distributionRoot = path.join(repoRoot, "codex-safe");
const installerScript = path.join(repoRoot, "scripts", "install-codex-safe.mjs");
const temporaryRoots = [];

async function pathExists(value) {
  try {
    await readFile(value);
    return true;
  } catch (error) {
    if (error?.code === "EISDIR") return true;
    if (error?.code === "ENOENT") return false;
    throw error;
  }
}

async function temporaryDirectory() {
  const root = await mkdtemp(path.join(os.tmpdir(), "agentic-codex-safe-test-"));
  temporaryRoots.push(root);
  return root;
}

test.after(async () => {
  const tempBase = path.resolve(os.tmpdir());
  for (const root of temporaryRoots) {
    const resolved = path.resolve(root);
    const relative = path.relative(tempBase, resolved);
    assert.ok(relative && !relative.startsWith("..") && !path.isAbsolute(relative));
    assert.ok(path.basename(resolved).startsWith("agentic-codex-safe-test-"));
    await rm(resolved, { recursive: true, force: true });
  }
});

test("committed distribution passes integrity and policy checks", async () => {
  const distribution = await loadAndVerifyDistribution(distributionRoot);
  assert.equal(distribution.release.skills.length, 8);
  assert.ok(distribution.release.skills.every((skill) => skill.risk === "R0"));
});

test("release state requires the pinned tag and a clean checkout", () => {
  assert.throws(
    () => validateReleaseState("codex-safe-v0.1.0", "abc123", [], ""),
    /requires release tag/,
  );
  assert.throws(
    () => validateReleaseState("codex-safe-v0.1.0", "abc123", ["codex-safe-v0.1.0"], " M file"),
    /clean Codex distribution checkout/,
  );
  assert.equal(
    validateReleaseState("codex-safe-v0.1.0", "abc123", ["codex-safe-v0.1.0"], ""),
    "abc123",
  );
});

test("project-scoped installation copies and verifies only allowlisted skills", async () => {
  const root = await temporaryDirectory();
  const project = path.join(root, "project");
  await mkdir(project);
  const distribution = await loadAndVerifyDistribution(distributionRoot);
  const plan = await createInstallPlan(project, distribution);
  assert.equal(plan.targets.length, 8);
  const receipt = await applyInstall(plan, distribution);
  assert.deepEqual(receipt.installedSkills, distribution.release.skills.map((skill) => skill.name));
  const verified = await verifyInstalled(project, distribution);
  assert.equal(verified.releaseManifestSha256, distribution.manifestSha256);
});

test("CLI defaults to dry-run and creates nothing", async () => {
  const root = await temporaryDirectory();
  const project = path.join(root, "project");
  await mkdir(project);
  const output = execFileSync(process.execPath, [installerScript, "--project", project], {
    cwd: repoRoot,
    encoding: "utf8",
  });
  const result = JSON.parse(output);
  assert.equal(result.status, "DRY-RUN");
  assert.equal(result.changesMade, false);
  assert.equal(await pathExists(path.join(project, ".agents")), false);
});

test("existing skill collision fails before copying", async () => {
  const root = await temporaryDirectory();
  const project = path.join(root, "project");
  const collision = path.join(project, ".agents", "skills", "agentic-review-code");
  await mkdir(collision, { recursive: true });
  const distribution = await loadAndVerifyDistribution(distributionRoot);
  await assert.rejects(() => createInstallPlan(project, distribution), /Skill collision/);
  assert.equal(await readFile(path.join(collision, "missing"), "utf8").catch(() => "unchanged"), "unchanged");
});

test("home directory is refused as an installation project", async () => {
  const distribution = await loadAndVerifyDistribution(distributionRoot);
  await assert.rejects(() => createInstallPlan(os.homedir(), distribution), /home directory/);
});

test("partial installation failure removes only newly copied skills", async () => {
  const root = await temporaryDirectory();
  const project = path.join(root, "project");
  await mkdir(project);
  const distribution = await loadAndVerifyDistribution(distributionRoot);
  const plan = await createInstallPlan(project, distribution);
  await mkdir(plan.targets[1].destination, { recursive: true });
  await assert.rejects(() => applyInstall(plan, distribution), /EEXIST|exist/i);
  assert.equal(await pathExists(plan.targets[0].destination), false);
  assert.equal(await pathExists(plan.targets[1].destination), true);
});

test("receipt race preserves the existing receipt and rolls back copied skills", async () => {
  const root = await temporaryDirectory();
  const project = path.join(root, "project");
  await mkdir(project);
  const distribution = await loadAndVerifyDistribution(distributionRoot);
  const plan = await createInstallPlan(project, distribution);
  await mkdir(path.dirname(plan.receiptPath), { recursive: true });
  await writeFile(plan.receiptPath, "existing receipt", "utf8");
  await assert.rejects(() => applyInstall(plan, distribution), /EEXIST|exist/i);
  assert.equal(await readFile(plan.receiptPath, "utf8"), "existing receipt");
  assert.equal(await pathExists(plan.targets[0].destination), false);
});

test("symlinked .agents destination is refused", async (context) => {
  const root = await temporaryDirectory();
  const project = path.join(root, "project");
  const outside = path.join(root, "outside");
  await mkdir(project);
  await mkdir(outside);
  try {
    await symlink(outside, path.join(project, ".agents"), process.platform === "win32" ? "junction" : "dir");
  } catch (error) {
    if (error?.code === "EPERM") {
      context.skip("Host does not permit symlink or junction creation");
      return;
    }
    throw error;
  }
  const distribution = await loadAndVerifyDistribution(distributionRoot);
  await assert.rejects(() => createInstallPlan(project, distribution), /Symlinked install path/);
});

test("unexpected file inside an installed skill fails verification", async () => {
  const root = await temporaryDirectory();
  const project = path.join(root, "project");
  await mkdir(project);
  const distribution = await loadAndVerifyDistribution(distributionRoot);
  const plan = await createInstallPlan(project, distribution);
  await applyInstall(plan, distribution);
  await writeFile(path.join(plan.targets[0].destination, "unexpected.txt"), "unexpected", "utf8");
  await assert.rejects(() => verifyInstalled(project, distribution), /unexpected files/);
});

test("tampered distribution fails integrity validation", async () => {
  const root = await temporaryDirectory();
  const copied = path.join(root, "codex-safe");
  await cp(distributionRoot, copied, { recursive: true });
  const target = path.join(copied, "skills", "agentic-review-code", "SKILL.md");
  await writeFile(target, `${await readFile(target, "utf8")}\ntampered\n`, "utf8");
  await assert.rejects(() => loadAndVerifyDistribution(copied), /integrity failure/);
});
