#!/usr/bin/env node

import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  copyFile,
  lstat,
  mkdir,
  readFile,
  readdir,
  realpath,
  rm,
  stat,
  writeFile,
} from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const scriptPath = fileURLToPath(import.meta.url);
const repoRoot = path.resolve(path.dirname(scriptPath), "..");
const defaultDistributionRoot = path.join(repoRoot, "codex-safe");

function sha256(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

function normalized(value) {
  const resolved = path.resolve(value);
  return process.platform === "win32" ? resolved.toLowerCase() : resolved;
}

function assertInside(parent, child, label) {
  const relative = path.relative(path.resolve(parent), path.resolve(child));
  if (!relative || relative.startsWith("..") || path.isAbsolute(relative)) {
    throw new Error(`${label} must stay inside ${parent}: ${child}`);
  }
}

async function exists(value) {
  try {
    await lstat(value);
    return true;
  } catch (error) {
    if (error?.code === "ENOENT") return false;
    throw error;
  }
}

async function rejectSymlinkComponents(root, components) {
  let current = root;
  for (const component of components) {
    current = path.join(current, component);
    try {
      const entry = await lstat(current);
      if (entry.isSymbolicLink()) throw new Error(`Symlinked install path is forbidden: ${current}`);
    } catch (error) {
      if (error?.code === "ENOENT") return;
      throw error;
    }
  }
}

async function listFiles(root) {
  const files = [];
  async function walk(current) {
    for (const entry of await readdir(current, { withFileTypes: true })) {
      const absolute = path.join(current, entry.name);
      if (entry.isSymbolicLink()) throw new Error(`Symlinks are forbidden: ${absolute}`);
      if (entry.isDirectory()) await walk(absolute);
      else if (entry.isFile()) files.push(absolute);
      else throw new Error(`Unsupported filesystem entry: ${absolute}`);
    }
  }
  await walk(root);
  return files.sort((a, b) => a.localeCompare(b));
}

function manifestHash(bytes) {
  return sha256(bytes);
}

export async function loadAndVerifyDistribution(distributionRoot = defaultDistributionRoot) {
  const root = path.resolve(distributionRoot);
  const releasePath = path.join(root, "release-manifest.json");
  const releaseBytes = await readFile(releasePath);
  const release = JSON.parse(releaseBytes.toString("utf8"));
  if (release.schemaVersion !== 1) throw new Error("Unsupported release manifest schema");
  if (release.safetyPolicy?.explicitInvocationOnly !== true) {
    throw new Error("Distribution is not explicit-invocation-only");
  }
  if (release.safetyPolicy?.projectScopedOnly !== true) {
    throw new Error("Distribution is not project-scoped-only");
  }
  if (!Array.isArray(release.skills) || release.skills.length === 0) {
    throw new Error("Distribution contains no skills");
  }

  const expected = new Map(release.files.map((file) => [file.path, file]));
  if (expected.size !== release.files.length) throw new Error("Duplicate file in release manifest");
  const skillsRoot = path.join(root, "skills");
  const actualFiles = await listFiles(skillsRoot);
  const actualPaths = actualFiles.map((file) =>
    path.relative(root, file).split(path.sep).join("/"),
  ).sort((a, b) => a.localeCompare(b));
  const expectedPaths = [...expected.keys()].sort((a, b) => a.localeCompare(b));
  if (JSON.stringify(actualPaths) !== JSON.stringify(expectedPaths)) {
    throw new Error("Distribution file inventory does not match release manifest");
  }

  for (const file of actualFiles) {
    const relative = path.relative(root, file).split(path.sep).join("/");
    const bytes = await readFile(file);
    const record = expected.get(relative);
    if (!record || sha256(bytes) !== record.sha256 || bytes.length !== record.bytes) {
      throw new Error(`Distribution integrity failure: ${relative}`);
    }
  }

  const skillNames = new Set();
  for (const skill of release.skills) {
    if (skill.risk !== "R0") throw new Error(`Non-R0 skill in safe distribution: ${skill.name}`);
    if (!skill.name.startsWith("agentic-")) throw new Error(`Unnamespaced skill: ${skill.name}`);
    if (skillNames.has(skill.name)) throw new Error(`Duplicate skill name: ${skill.name}`);
    skillNames.add(skill.name);
    const skillRoot = path.join(skillsRoot, skill.name);
    const skillText = await readFile(path.join(skillRoot, "SKILL.md"), "utf8");
    const policyText = await readFile(path.join(skillRoot, "agents", "openai.yaml"), "utf8");
    if (!new RegExp(`^name:\\s*${skill.name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}$`, "m").test(skillText)) {
      throw new Error(`Skill name mismatch: ${skill.name}`);
    }
    if (!/^\s*allow_implicit_invocation:\s*false\s*$/m.test(policyText)) {
      throw new Error(`Implicit invocation is not disabled: ${skill.name}`);
    }
  }

  return {
    root,
    release,
    releasePath,
    manifestSha256: manifestHash(releaseBytes),
  };
}

function globalSkillRoots() {
  const roots = [
    path.join(os.homedir(), ".agents", "skills"),
    path.join(os.homedir(), ".codex", "skills"),
  ];
  if (process.env.CODEX_HOME) roots.push(path.join(process.env.CODEX_HOME, "skills"));
  return new Set(roots.map(normalized));
}

export async function createInstallPlan(projectPath, distribution) {
  if (!projectPath) throw new Error("--project is required");
  const projectRoot = await realpath(path.resolve(projectPath));
  const projectStats = await stat(projectRoot);
  if (!projectStats.isDirectory()) throw new Error(`Project is not a directory: ${projectRoot}`);
  if (normalized(projectRoot) === normalized(os.homedir())) {
    throw new Error("Refusing to use the home directory as a project target");
  }
  await rejectSymlinkComponents(projectRoot, [".agents", "skills"]);

  const destinationRoot = path.join(projectRoot, ".agents", "skills");
  assertInside(projectRoot, destinationRoot, "Codex skill destination");
  if (globalSkillRoots().has(normalized(destinationRoot))) {
    throw new Error(`Refusing global Codex skill destination: ${destinationRoot}`);
  }

  const receiptPath = path.join(projectRoot, ".agents", "agentic-workflow-safe-receipt.json");
  assertInside(projectRoot, receiptPath, "Install receipt");
  if (await exists(receiptPath)) throw new Error(`Install receipt already exists: ${receiptPath}`);

  const targets = [];
  for (const skill of distribution.release.skills) {
    const source = path.join(distribution.root, "skills", skill.name);
    const destination = path.join(destinationRoot, skill.name);
    assertInside(destinationRoot, destination, "Skill destination");
    if (await exists(destination)) throw new Error(`Skill collision: ${destination}`);
    targets.push({ name: skill.name, source, destination });
  }
  return { projectRoot, destinationRoot, receiptPath, targets };
}

async function copyTreeContents(sourceRoot, destinationRoot) {
  for (const sourceFile of await listFiles(sourceRoot)) {
    const relative = path.relative(sourceRoot, sourceFile);
    const destinationFile = path.join(destinationRoot, relative);
    assertInside(destinationRoot, destinationFile, "Installed skill file");
    await mkdir(path.dirname(destinationFile), { recursive: true });
    await copyFile(sourceFile, destinationFile);
  }
}

function currentForkCommit() {
  try {
    return execFileSync("git", ["rev-parse", "HEAD"], {
      cwd: repoRoot,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    }).trim();
  } catch {
    return "unavailable";
  }
}

export function validateReleaseState(requiredTag, head, tags, status) {
  if (!requiredTag) throw new Error("Release manifest does not declare a required release tag");
  if (!tags.includes(requiredTag)) {
    throw new Error(`Apply requires release tag ${requiredTag} at HEAD ${head}`);
  }
  if (status) throw new Error("Apply requires a clean Codex distribution checkout");
  return head;
}

export function verifyReleaseCheckoutForApply(distribution) {
  const requiredTag = distribution.release.distribution?.releaseTag;
  let head;
  let tags;
  let status;
  try {
    head = execFileSync("git", ["rev-parse", "HEAD"], {
      cwd: repoRoot,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    }).trim();
    tags = execFileSync("git", ["tag", "--points-at", "HEAD"], {
      cwd: repoRoot,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    }).split(/\r?\n/).filter(Boolean);
    status = execFileSync(
      "git",
      ["status", "--porcelain", "--", "codex-safe", "scripts/install-codex-safe.mjs"],
      {
        cwd: repoRoot,
        encoding: "utf8",
        stdio: ["ignore", "pipe", "ignore"],
      },
    ).trim();
  } catch {
    throw new Error("Apply requires a verifiable Git checkout of the hardened fork");
  }
  return validateReleaseState(requiredTag, head, tags, status);
}

export async function applyInstall(plan, distribution) {
  await rejectSymlinkComponents(plan.projectRoot, [".agents", "skills"]);
  await mkdir(plan.destinationRoot, { recursive: true });
  const created = [];
  let receiptWritten = false;
  try {
    for (const target of plan.targets) {
      await mkdir(target.destination, { recursive: false });
      created.push(target.destination);
      await copyTreeContents(target.source, target.destination);
    }
    const receipt = {
      schemaVersion: 1,
      distribution: distribution.release.distribution,
      forkCommit: currentForkCommit(),
      releaseManifestSha256: distribution.manifestSha256,
      installedSkills: plan.targets.map((target) => target.name),
      destination: plan.destinationRoot,
    };
    await writeFile(plan.receiptPath, `${JSON.stringify(receipt, null, 2)}\n`, {
      encoding: "utf8",
      flag: "wx",
    });
    receiptWritten = true;
    await verifyInstalled(plan.projectRoot, distribution);
    return receipt;
  } catch (error) {
    if (receiptWritten) {
      assertInside(plan.projectRoot, plan.receiptPath, "Rollback receipt");
      await rm(plan.receiptPath, { force: true });
    }
    for (const createdPath of created.reverse()) {
      assertInside(plan.destinationRoot, createdPath, "Rollback target");
      await rm(createdPath, { recursive: true, force: true });
    }
    throw error;
  }
}

export async function verifyInstalled(projectPath, distribution) {
  const projectRoot = await realpath(path.resolve(projectPath));
  const destinationRoot = path.join(projectRoot, ".agents", "skills");
  const receiptPath = path.join(projectRoot, ".agents", "agentic-workflow-safe-receipt.json");
  assertInside(projectRoot, destinationRoot, "Codex skill destination");
  await rejectSymlinkComponents(projectRoot, [".agents", "skills"]);
  const receipt = JSON.parse(await readFile(receiptPath, "utf8"));
  if (receipt.releaseManifestSha256 !== distribution.manifestSha256) {
    throw new Error("Installed receipt does not match this release manifest");
  }
  const expectedSkillNames = distribution.release.skills.map((skill) => skill.name);
  if (JSON.stringify(receipt.installedSkills) !== JSON.stringify(expectedSkillNames)) {
    throw new Error("Installed receipt skill list does not match this release manifest");
  }
  if (normalized(receipt.destination) !== normalized(destinationRoot)) {
    throw new Error("Installed receipt destination does not match the project");
  }

  const expectedInstalledPaths = distribution.release.files
    .map((record) => record.path.replace(/^skills\//, ""))
    .sort((a, b) => a.localeCompare(b));
  const actualInstalledPaths = [];
  for (const skill of distribution.release.skills) {
    const skillRoot = path.join(destinationRoot, skill.name);
    for (const file of await listFiles(skillRoot)) {
      actualInstalledPaths.push(path.relative(destinationRoot, file).split(path.sep).join("/"));
    }
  }
  actualInstalledPaths.sort((a, b) => a.localeCompare(b));
  if (JSON.stringify(actualInstalledPaths) !== JSON.stringify(expectedInstalledPaths)) {
    throw new Error("Installed skill inventory contains missing or unexpected files");
  }

  for (const record of distribution.release.files) {
    const relative = record.path.replace(/^skills\//, "");
    const installedFile = path.join(destinationRoot, ...relative.split("/"));
    assertInside(destinationRoot, installedFile, "Installed verification file");
    const bytes = await readFile(installedFile);
    if (sha256(bytes) !== record.sha256 || bytes.length !== record.bytes) {
      throw new Error(`Installed file integrity failure: ${relative}`);
    }
  }
  return receipt;
}

function parseArguments(argv) {
  const result = { mode: "dry-run", project: null };
  for (let index = 0; index < argv.length; index += 1) {
    const value = argv[index];
    if (value === "--project") result.project = argv[++index];
    else if (value === "--apply") result.mode = "apply";
    else if (value === "--verify") result.mode = "verify";
    else if (value === "--dry-run") result.mode = "dry-run";
    else throw new Error(`Unknown argument: ${value}`);
  }
  return result;
}

async function cli() {
  const args = parseArguments(process.argv.slice(2));
  const distribution = await loadAndVerifyDistribution();
  if (args.mode === "verify") {
    const receipt = await verifyInstalled(args.project, distribution);
    process.stdout.write(`${JSON.stringify({ status: "VERIFIED", receipt }, null, 2)}\n`);
    return;
  }
  const plan = await createInstallPlan(args.project, distribution);
  if (args.mode === "dry-run") {
    process.stdout.write(`${JSON.stringify({
      status: "DRY-RUN",
      destination: plan.destinationRoot,
      skills: plan.targets.map((target) => target.name),
      changesMade: false,
    }, null, 2)}\n`);
    return;
  }
  verifyReleaseCheckoutForApply(distribution);
  const receipt = await applyInstall(plan, distribution);
  process.stdout.write(`${JSON.stringify({ status: "INSTALLED-AND-VERIFIED", receipt }, null, 2)}\n`);
}

const isDirect = process.argv[1] && normalized(process.argv[1]) === normalized(scriptPath);
if (isDirect) {
  cli().catch((error) => {
    process.stderr.write(`CODEX SAFE INSTALL BLOCKED: ${error.message}\n`);
    process.exitCode = 1;
  });
}
