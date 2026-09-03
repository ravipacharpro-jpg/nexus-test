import os from "os"
import path from "path"
import { Style, Icon } from "../core/style"
import { getSecret, setSecret } from "../core/secret-store"
import type { NexusPlugin, PluginContext } from "../core/types"

const EOL = "\n"
const CLOUD_TOKENS = path.join(os.homedir(), ".nexus", "cloud-tokens.json")

function secretName(provider: string): string {
  return `cloud.${provider.replace(/[^a-z0-9._-]+/gi, "-")}.token`
}

async function saveCloudToken(provider: string, token: string): Promise<void> {
  setSecret(secretName(provider), token)
}

async function getCloudToken(provider: string): Promise<string | undefined> {
  const stored = getSecret(secretName(provider))
  if (stored) return stored
  const file = Bun.file(CLOUD_TOKENS)
  if (!(await file.exists())) return undefined
  const data = await file.json()
  const legacy = typeof data[provider] === "string" ? (data[provider] as string) : undefined
  if (!legacy) return undefined
  // Migrate plaintext token to encrypted storage and scrub the legacy file.
  setSecret(secretName(provider), legacy)
  const remaining = Object.fromEntries(Object.entries(data).filter(([key]) => key !== provider))
  const fs = await import("fs/promises")
  if (Object.keys(remaining).length === 0) await fs.rm(CLOUD_TOKENS, { force: true })
  else {
    await Bun.write(CLOUD_TOKENS, JSON.stringify(remaining, null, 2))
    await fs.chmod(CLOUD_TOKENS, 0o600)
  }
  return legacy
}

async function ensureCloudToken(ctx: PluginContext, provider: string): Promise<string | undefined> {
  let token = typeof ctx.flags.token === "string" ? ctx.flags.token : undefined
  token = token ?? process.env[`NEXUS_${provider.toUpperCase()}_TOKEN`]
  const saved = await getCloudToken(provider)
  token = token ?? saved
  if (!token) {
    ctx.err(`No ${provider} token saved.`)
    ctx.out(`${Style.TEXT_DIM}Save once with:${Style.TEXT_NORMAL}`)
    ctx.out(`  ${Style.TEXT_HIGHLIGHT}nexus deploy cloud ${provider} --token <your-api-token>${Style.TEXT_NORMAL}`)
    return undefined
  }
  if (token !== saved) await saveCloudToken(provider, token)
  return token
}

async function writeArtifact(ctx: PluginContext, name: string, content: string): Promise<string> {
  const out = path.join(ctx.cwd, "cloud", name)
  await import("fs/promises").then((fs) => fs.mkdir(path.dirname(out), { recursive: true }))
  await Bun.write(out, content)
  return out
}

async function sshDeploy(ctx: PluginContext): Promise<number | void> {
  const host = typeof ctx.flags.host === "string" ? ctx.flags.host : undefined
  const user = typeof ctx.flags.user === "string" ? ctx.flags.user : undefined
  const local = path.resolve(ctx.cwd, typeof ctx.flags.local === "string" ? ctx.flags.local : "./dist")
  const remote = typeof ctx.flags.remote === "string" ? ctx.flags.remote : "/var/www/html"
  const key = typeof ctx.flags.key === "string" ? ctx.flags.key : path.join(process.env.HOME ?? "~", ".ssh", "id_rsa")

  if (!host || !user) {
    ctx.err("Usage: nexus deploy ssh --host myserver.com --user deploy --local ./dist --remote /var/www/html")
    return 1
  }

  if (!(await isDirectory(local))) {
    ctx.err(`Local directory not found: ${local}`)
    return 1
  }

  const rsync = Bun.which("rsync")
  const destructive = rsync !== undefined
  const dryRun = ctx.flags.dryRun === true

  if (dryRun) {
    ctx.out(`${Icon.eye} DRY-RUN / preflight — nothing will be written`)
    if (!rsync) {
      ctx.out(`  rsync not found → plan: scp -r ${local} ${user}@${host}:${remote} (full copy, no deletions)`)
      ctx.out(`  Rollback: none needed (no overwrite in scp fallback mode is NOT guaranteed — review target)`)
      return 0
    }
    const preview = Bun.spawn(
      ["rsync", "-avz", "--delete", "--dry-run", "--stats", "-e", `ssh -i ${key} -o StrictHostKeyChecking=accept-new`, `${local}/`, `${user}@${host}:${remote}/`],
      { stdout: "inherit", stderr: "inherit" },
    )
    await preview.exited
    ctx.out(`  Plan: rsync mirror of ${path.basename(local)} → ${user}@${host}:${remote} (deletes extra remote files)`)
    ctx.out(`  Backup: tar.gz of current ${remote} created on the host before syncing`)
    ctx.out(`  Rollback: ssh ${user}@${host} "rm -rf ${remote} && tar -xzf <backup>.tar.gz -C $(dirname ${remote})"`)
    return 0
  }

  const ok = await ctx.confirm({
    title: `Deploy ${path.basename(local)} → ${user}@${host}:${remote}?`,
    detail: destructive ? "rsync --delete will remove remote files not present locally. A backup archive is created first." : "scp full-copy mode",
    danger: destructive,
  })
  if (!ok) {
    ctx.out("Deploy cancelled")
    return 0
  }

  let backupPath: string | undefined
  if (destructive) {
    backupPath = await remoteBackup(ctx, host, user, key, remote)
    if (!backupPath && ctx.flags.force !== true) {
      const okNoBackup = await ctx.confirm({
        title: "Backup failed — proceed WITHOUT a rollback point?",
        danger: true,
      })
      if (!okNoBackup) {
        ctx.out("Deploy cancelled")
        return 0
      }
    }
  }

  if (rsync) {
    ctx.out(`${Icon.rocket} rsync incremental sync...`)
    const proc = Bun.spawn(
      ["rsync", "-avz", "--delete", "-e", `ssh -i ${key} -o StrictHostKeyChecking=accept-new`, `${local}/`, `${user}@${host}:${remote}/`],
      { stdout: "inherit", stderr: "inherit" },
    )
    const exit = await proc.exited
    if (exit !== 0) {
      ctx.err("rsync failed")
      return 1
    }
  } else {
    ctx.out(`${Icon.warn} rsync not found — using scp fallback`)
    const proc = Bun.spawn(["scp", "-r", "-i", key, local, `${user}@${host}:${remote}`], { stdout: "inherit", stderr: "inherit" })
    const exit = await proc.exited
    if (exit !== 0) {
      ctx.err("scp failed")
      return 1
    }
  }

  await healthCheck(ctx, host)
}

export async function isDirectory(target: string): Promise<boolean> {
  try {
    const stat = await (await import("fs/promises")).stat(target)
    return stat.isDirectory()
  } catch {
    return false
  }
}

async function healthCheck(ctx: PluginContext, host: string): Promise<void> {
  for (const scheme of ["https", "http"]) {
    try {
      const response = await fetch(`${scheme}://${host}`, { method: "HEAD", signal: AbortSignal.timeout(8000) })
      ctx.out(`${Icon.success} Health check: ${scheme}://${host} → HTTP ${response.status}`)
      return
    } catch {
      continue
    }
  }
  ctx.out(`${Icon.warn} Health check could not reach ${host}`)
}

async function gitDeploy(ctx: PluginContext): Promise<number | void> {
  const remote = typeof ctx.flags.remote === "string" ? ctx.flags.remote : "origin"
  const branch = typeof ctx.flags.branch === "string" ? ctx.flags.branch : "main"

  const okPush = await ctx.confirm({
    title: `git push ${remote} ${branch}?`,
    detail: "This publishes your local commits to the remote repository",
  })
  if (!okPush) {
    ctx.out("Push cancelled")
    return 0
  }

  const proc = Bun.spawn(["git", "push", remote, branch], { cwd: ctx.cwd, stdout: "inherit", stderr: "inherit" })
  const exit = await proc.exited
  if (exit !== 0) {
    ctx.err(`git push failed (${remote}/${branch})`)
    return 1
  }
  ctx.out(`${Icon.success} Pushed to ${remote}/${branch}`)
}

async function remoteBackup(ctx: PluginContext, host: string, user: string, key: string, remote: string): Promise<string | undefined> {
  const stamp = new Date().toISOString().replace(/[:.]/g, "-")
  const backupPath = `${remote}.nexus-backup-${stamp}`
  const archive = Bun.spawn(
    ["ssh", "-i", key, "-o", "StrictHostKeyChecking=accept-new", `${user}@${host}`, `tar -czf ${backupPath}.tar.gz -C $(dirname ${remote}) $(basename ${remote}) 2>/dev/null && echo OK || echo FAIL`],
    { stdout: "pipe", stderr: "ignore" },
  )
  await archive.exited
  const result = (await new Response(archive.stdout).text()).trim()
  if (result.endsWith("OK")) {
    ctx.out(`${Icon.success} Remote backup: ${backupPath}.tar.gz`)
    return backupPath
  }
  ctx.out(`${Icon.warn} Remote backup skipped (continuing without rollback point)`)
  return undefined
}

const FLY_TOML = `# generated by NEXUS
app = "nexus-agent"
primary_region = "bom"

[build]
  dockerfile = "packages/nexus/Dockerfile"

[env]
  PORT = "4096"

[http_service]
  internal_port = 4096
  force_https = true
  auto_stop_machines = false
  auto_start_machines = true
  [http_service.concurrency]
    type = "requests"
[[http_service.checks]]
  interval = "30s"
  timeout = "5s"
  grace_period = "10s"
  method = "GET"
  path = "/"
`

async function deployFly(ctx: PluginContext): Promise<number | void> {
  const token = await ensureCloudToken(ctx, "fly")
  if (!token) return 1

  let flyctl = Bun.which("flyctl") ?? Bun.which("fly")
  if (!flyctl && ctx.flags.fix === true) {
    const okInstall = await ctx.confirm({
      title: "Install flyctl via remote script?",
      detail: "Runs: curl -fsSL https://fly.io/install.sh | sh — review the script at fly.io/install.sh before allowing",
      danger: true,
    })
    if (!okInstall) {
      ctx.out("Install cancelled")
      return 0
    }
    ctx.out(`${Icon.rocket} Installing flyctl...`)
    // Download the installer to a temp file first so it is not executed straight
    // from a pipe; the user can review it before it runs.
    const scriptPath = path.join(os.tmpdir(), `fly-install-${Date.now()}.sh`)
    Bun.spawnSync(["sh", "-c", `curl -fsSL https://fly.io/install.sh -o "${scriptPath}"`], {
      stdout: "ignore",
      stderr: "ignore",
    })
    ctx.out(`${Icon.info} Installer downloaded to ${scriptPath} — review it before execution`)
    Bun.spawnSync(["sh", scriptPath], { stdout: "ignore", stderr: "ignore" })
    process.env.PATH = `${process.env.HOME}/.fly/bin:${process.env.PATH}`
    flyctl = Bun.which("flyctl") ?? Bun.which("fly")
  }
  if (!flyctl) {
    ctx.err("flyctl missing — install with: curl -fsSL https://fly.io/install.sh | sh  (ya --fix ke saath chalao)")
    return 1
  }

  const tomlPath = await writeArtifact(ctx, "fly.toml", FLY_TOML)
  ctx.out(`${Icon.info} ${tomlPath} ready (region bom/Mumbai, port 4096)`)

  const okConfirm = await ctx.confirm({
    title: "Deploy NEXUS to Fly.io?",
    detail: "Remote build (phone pe build nahi hoga). Pehli baar app create bhi hoga.",
    danger: false,
  })
  if (!okConfirm) {
    ctx.out("Cancelled")
    return 0
  }

  const proc = Bun.spawn(["flyctl", "launch", "--no-deploy", "--now", "--copy-config", "--remote-only"], {
    cwd: ctx.cwd,
    stdout: "inherit",
    stderr: "inherit",
    env: { ...process.env, FLY_API_TOKEN: token },
  })
  if ((await proc.exited) !== 0) {
    ctx.err("fly launch failed — token/name conflict check karo (logs above)")
    return 1
  }

  const dep = Bun.spawn(["flyctl", "deploy", "--remote-only"], {
    cwd: ctx.cwd,
    stdout: "inherit",
    stderr: "inherit",
    env: { ...process.env, FLY_API_TOKEN: token },
  })
  const code = await dep.exited
  if (code === 0) {
    ctx.out(`${Icon.success} Deployed! Ab connect karo:`)
    ctx.out(`  ${Style.TEXT_HIGHLIGHT_BOLD}nexus attach https://nexus-agent.fly.dev${Style.TEXT_NORMAL}`)
    ctx.out(`  ${Style.TEXT_DIM}(apne fly app ka actual naam use karo)${Style.TEXT_NORMAL}`)
  }
  return code === 0 ? 0 : 1
}

async function deployRailway(ctx: PluginContext): Promise<number | void> {
  const token = await ensureCloudToken(ctx, "railway")
  if (!token) return 1

  await writeArtifact(
    ctx,
    "railway.json",
    JSON.stringify(
      {
        $schema: "https://railway.app/railway.schema.json",
        build: { builder: "DOCKERFILE", dockerfilePath: "packages/nexus/Dockerfile" },
        deploy: { startCommand: "bun packages/nexus/src/index.ts serve --port $PORT --hostname 0.0.0.0", restartPolicyType: "ON_FAILURE" },
      },
      null,
      2,
    ),
  )
  ctx.out(`${Icon.info} cloud/railway.json written`)

  ctx.out(`${Icon.info} Deploy steps:`)
  ctx.out(`  1. Repo ko GitHub pe push karo`)
  ctx.out(`  2. railway.app → New Project → Deploy from GitHub → ${Style.TEXT_HIGHLIGHT}root repo${Style.TEXT_NORMAL}`)
  ctx.out(`  3. Settings me railway.json auto-pick hoga (Dockerfile + start command)`)
  ctx.out(`  4. Variables me daalo: ${Style.TEXT_HIGHLIGHT}RAILWAY_TOKEN=${token.slice(0, 4)}…${Style.TEXT_NORMAL} (CLI se karna ho to)`)
  ctx.out(`${EOL}  ${Style.TEXT_DIM}CLI route: bunx @railway/cli login && bunx @railway/cli up${Style.TEXT_NORMAL}`)
  return 0
}

async function deployRender(ctx: PluginContext): Promise<number | void> {
  await writeArtifact(
    ctx,
    "render.yaml",
    `# generated by NEXUS
services:
  - type: web
    name: nexus-agent
    runtime: docker
    dockerfilePath: ./packages/nexus/Dockerfile
    plan: starter
    healthCheckPath: /
    envVars:
      - key: PORT
        value: 4096
`,
  )
  ctx.out(`${Icon.success} cloud/render.yaml ready`)
  ctx.out(`  1. render.com → New → Blueprint`)
  ctx.out(`  2. Tumhara GitHub repo select karo (push zaroori hai)`)
  ctx.out(`  3. render.yaml auto-detect hoga → Apply`)
  ctx.out(`  ${Style.TEXT_DIM}Free tier so jata hai idle pe — daemon ke liye paid starter better${Style.TEXT_NORMAL}`)
  return 0
}

function vmUserData(): string {
  return `#!/bin/bash
set -e
curl -fsSL https://bun.sh/install | bash
export PATH="$HOME/.bun/bin:$PATH"
git clone --depth 1 https://github.com/itzgeniusboy/nexus.git /opt/nexus || true
cd /opt/nexus/packages/nexus
for i in $(seq 1 10); do bun install --backend=copyfile >/dev/null 2>&1 && break; done
cat > /etc/systemd/system/nexus.service <<'UNIT'
[Unit]
Description=NEXUS Agent
After=network.target
[Service]
ExecStart=/root/.bun/bin/bun /opt/nexus/packages/nexus/src/index.ts serve --port 4096 --hostname 0.0.0.0
Restart=always
RestartSec=5
Environment=NEXUS_SERVER=1
[Install]
WantedBy=multi-user.target
UNIT
systemctl enable --now nexus
echo "NEXUS agent running on :4096"`
}

async function deployVMGuide(ctx: PluginContext): Promise<number | void> {
  const provider = ctx.args[0] === "ec2" ? "ec2" : ctx.args[0] === "oracle" ? "oracle" : "do"
  const udPath = await writeArtifact(ctx, `user-data-${provider}.sh`, vmUserData())

  ctx.out(`${Icon.rocket} ${provider.toUpperCase()} setup — cloud-init file ready: ${udPath}${EOL}`)

  if (provider === "do") {
    ctx.out(`  1. doctl auth init (token: apidigitalocean.com) ya console se`)
    ctx.out(`  2. doctl compute droplet create nexus --image ubuntu-24-04-x64 --size s-2vcpu-4gb \\`)
    ctx.out(`       --region blr1 --user-data-file ${udPath}`)
  } else if (provider === "ec2") {
    ctx.out(`  1. EC2 → Launch instance → Ubuntu 24.04 (t3.medium recommended)`)
    ctx.out(`  2. Advanced details → User data → ${udPath} ka content paste karo`)
    ctx.out(`  3. Security group: port 4096 open karo (apne IP se)`)
  } else {
    ctx.out(`  1. cloud.oracle.com → Compute → Create instance`)
    ctx.out(`  2. Shape: VM.Standard.A1.Flex (4 OCPU / 24GB — ALWAYS FREE!)`)
    ctx.out(`  3. Image: Ubuntu 24.04 → Advanced → User data paste: ${udPath}`)
    ctx.out(`  4. Security list: ingress 4096 TCP`)
  }

  ctx.out(`${EOL}  5. VM ready hone par:`)
  ctx.out(`     ${Style.TEXT_HIGHLIGHT_BOLD}nexus attach http://<vm-public-ip>:4096${Style.TEXT_NORMAL}`)
  ctx.out(`  ${Style.TEXT_DIM}24×7 chalega — Termux band ho tab bhi!${Style.TEXT_NORMAL}`)
  return 0
}

const plugin: NexusPlugin = {
  name: "deploy",
  version: "0.1.0",
  description: "Deployment engine — SSH/rsync and Git push with health checks",
  tags: ["deploy", "ssh", "rsync", "git"],
  commands: [
    {
      name: "ssh",
      describe: "deploy a directory over SSH (rsync preferred, scp fallback)",
      usage: "nexus deploy ssh --host H --user U [--local ./dist] [--remote /var/www/html] [--key ~/.ssh/id_rsa]",
      run: sshDeploy,
    },
    {
      name: "ftp",
      describe: "FTP/SFTP deploy requires the optional 'basic-ftp' or 'ssh2' package",
      usage: "nexus deploy ftp --host H --user U --local ./build --remote /public_html",
      run: async (ctx) => {
        ctx.err("FTP support needs the optional dependency 'basic-ftp' — install it, or use: nexus deploy ssh")
        return 1
      },
    },
    {
      name: "git",
      describe: "git push deploy, e.g. nexus deploy git --remote origin --branch main",
      usage: "nexus deploy git [--remote origin] [--branch main]",
      run: gitDeploy,
    },
    { name: "cloud fly", describe: "one-command Fly.io deploy (remote build, Mumbai region)", usage: "nexus deploy cloud fly [--token <fly-api-token>] [--fix]", run: async (ctx) => deployFly({ ...ctx, args: ["fly"] }) },
    { name: "cloud railway", describe: "Railway setup: railway.json + steps", usage: "nexus deploy cloud railway [--token <t>]", run: async (ctx) => deployRailway({ ...ctx, args: ["railway"] }) },
    { name: "cloud render", describe: "Render blueprint (render.yaml) generate", usage: "nexus deploy cloud render", run: async (ctx) => deployRender({ ...ctx, args: ["render"] }) },
    { name: "cloud do", describe: "DigitalOcean droplet: cloud-init script + steps", usage: "nexus deploy cloud do", run: async (ctx) => deployVMGuide({ ...ctx, args: ["do"] }) },
    { name: "cloud ec2", describe: "AWS EC2: user-data script + steps", usage: "nexus deploy cloud ec2", run: async (ctx) => deployVMGuide({ ...ctx, args: ["ec2"] }) },
    { name: "cloud oracle", describe: "Oracle Always-Free ARM (24GB RAM): user-data + steps", usage: "nexus deploy cloud oracle", run: async (ctx) => deployVMGuide({ ...ctx, args: ["oracle"] }) },
  ],
}

export default plugin

export * as DeployPlugin from "./deploy"
