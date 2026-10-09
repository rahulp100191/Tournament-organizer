import { spawn } from "node:child_process";
import { randomBytes } from "node:crypto";
import { access, copyFile, mkdir, readFile, writeFile } from "node:fs/promises";
import { resolve, join } from "node:path";
const project = resolve("android"),
  sdk = resolve(process.env.ANDROID_HOME || ".tools/android-sdk"),
  jdk = process.env.JAVA_HOME;
if (!jdk) throw new Error("Set JAVA_HOME to your Java 17 directory.");
const privateFile = resolve(".tools/android-signing.json"),
  keystore = join(project, "rally-test.keystore"),
  output = join(project, "artifacts");
await mkdir(output, { recursive: true });
await mkdir(".tools", { recursive: true });
let password;
try {
  password = JSON.parse(await readFile(privateFile, "utf8")).password;
} catch {
  password = randomBytes(32).toString("base64url");
  await writeFile(privateFile, JSON.stringify({ password, keystore }), {
    flag: "wx",
  });
}
const env = { ...process.env, RALLY_TEST_SIGNING_PASSWORD: password };
function run(file, args) {
  return new Promise((resolve, reject) => {
    const child = spawn(file, args, { env, windowsHide: true });
    let stdout = "",
      stderr = "";
    child.stdout.on("data", (v) => (stdout += v));
    child.stderr.on("data", (v) => (stderr += v));
    child.on("error", reject);
    child.on("exit", (code) =>
      code === 0
        ? resolve(stdout)
        : reject(new Error(`${file} failed (${code}): ${stderr}`)),
    );
  });
}
const exe = (name) => join(jdk, "bin", name + ".exe");
try {
  await access(keystore);
} catch {
  await run(exe("keytool"), [
    "-genkeypair",
    "-keystore",
    keystore,
    "-alias",
    "rally-test",
    "-storepass:env",
    "RALLY_TEST_SIGNING_PASSWORD",
    "-keypass:env",
    "RALLY_TEST_SIGNING_PASSWORD",
    "-keyalg",
    "RSA",
    "-keysize",
    "2048",
    "-validity",
    "3650",
    "-dname",
    "CN=Rally Private Test, O=Rally, C=IN",
  ]);
}
const aligned = join(output, "rally-test-aligned.apk"),
  apk = join(output, "Rally-Tournaments-Test.apk"),
  aab = join(output, "Rally-Tournaments-Test.aab");
await run(join(sdk, "build-tools", "36.0.0", "zipalign.exe"), [
  "-f",
  "-p",
  "4",
  join(project, "app/build/outputs/apk/release/app-release-unsigned.apk"),
  aligned,
]);
const quote = (s) => "'" + s.replaceAll("'", "''") + "'";
const signer = join(sdk, "build-tools", "36.0.0", "apksigner.bat");
const apksign = (args) =>
  run("powershell.exe", [
    "-NoProfile",
    "-Command",
    `& ${quote(signer)} ${args.map(quote).join(" ")}; exit $LASTEXITCODE`,
  ]);
await apksign([
  "sign",
  "--ks",
  keystore,
  "--ks-key-alias",
  "rally-test",
  "--ks-pass",
  "env:RALLY_TEST_SIGNING_PASSWORD",
  "--key-pass",
  "env:RALLY_TEST_SIGNING_PASSWORD",
  "--out",
  apk,
  aligned,
]);
const verification = await apksign(["verify", "--print-certs", apk]);
const digest = verification.match(
  /certificate SHA-256 digest: ([0-9a-f]{64})/i,
)?.[1];
if (!digest) throw new Error("Could not verify APK signing fingerprint.");
await run(exe("jarsigner"), [
  "-keystore",
  keystore,
  "-storepass:env",
  "RALLY_TEST_SIGNING_PASSWORD",
  "-keypass:env",
  "RALLY_TEST_SIGNING_PASSWORD",
  "-signedjar",
  aab,
  join(project, "app/build/outputs/bundle/release/app-release.aab"),
  "rally-test",
]);
await run(exe("jarsigner"), ["-verify", aab]);
const fingerprint = digest.toUpperCase().match(/.{2}/g).join(":");
await mkdir("public/.well-known", { recursive: true });
await writeFile(
  "public/.well-known/assetlinks.json",
  JSON.stringify(
    [
      {
        relation: ["delegate_permission/common.handle_all_urls"],
        target: {
          namespace: "android_app",
          package_name: "app.rally.tournaments.test",
          sha256_cert_fingerprints: [fingerprint],
        },
      },
    ],
    null,
    2,
  ),
);
console.log("APK and AAB signed and verified. Digital Asset Links generated.");
console.log("Artifacts: android/artifacts/Rally-Tournaments-Test.apk and .aab");
console.log(
  "Back up the ignored keystore and .tools/android-signing.json securely.",
);
