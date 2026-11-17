#!/usr/bin/env node
'use strict';

// Native integration smoke, intentionally without a BrowserWindow or live accounts.
// Run after build:electron and electron-builder install-app-deps:
//   node scripts/smoke-core.cjs [--report native-smoke.json]
// Linux positive CI: --password-store=gnome-libsecret --require-secure-storage
// Linux negative CI: --password-store=basic --require-insecure-rejection
// Both run under xvfb-run; positive CI starts a disposable D-Bus/keyring session.
// A separate Node launcher bounds even synchronous OS-keyring prompts to 18 seconds.
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const assert = require('node:assert/strict');
const REPORT_PREFIX = 'APLYD_CORE_SMOKE_REPORT=';
const PROGRESS_PREFIX = 'APLYD_CORE_SMOKE_PROGRESS=';

if (!process.versions.electron) launch();
else runElectron().catch(error => {
  // Only synthetic fixtures are used; no provider messages or credentials are logged.
  console.log(REPORT_PREFIX + JSON.stringify({ok:false,error:String(error?.message || error)}));
  require('electron').app.exit(1);
});

function launch() {
  const { spawn } = require('node:child_process');
  const started = Date.now();
  const args = process.argv.slice(2);
  const requireSecureStorage = args.includes('--require-secure-storage');
  const requireInsecureRejection = args.includes('--require-insecure-rejection');
  if (requireSecureStorage && requireInsecureRejection) throw new Error('Choose one credential expectation.');
  const passwordStoreOption = args.find(value => value.startsWith('--password-store='));
  if (passwordStoreOption && (process.platform !== 'linux' || !['--password-store=basic','--password-store=gnome-libsecret'].includes(passwordStoreOption))) {
    throw new Error('Linux smoke password-store must be basic or gnome-libsecret.');
  }
  const reportIndex = args.indexOf('--report');
  const reportPath = reportIndex >= 0 ? args[reportIndex + 1] : undefined;
  if (reportIndex >= 0 && (!reportPath || reportPath.startsWith('--'))) {
    throw new Error('--report requires an output filename.');
  }
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'aplyd-community-smoke-'));
  let child;
  let finished = false;
  let stdout = '';
  let timedOut = false;
  let lastPhase = 'starting-electron';
  let forcedShutdown = false;
  let shutdownGrace;
  let watchdog;
  function finish(exitCode, failure) {
    if (finished) return;
    finished = true;
    clearTimeout(watchdog);
    clearTimeout(shutdownGrace);
    const line = stdout.split(/\r?\n/).reverse().find(value => value.startsWith(REPORT_PREFIX));
    let report;
    try { report = line ? JSON.parse(line.slice(REPORT_PREFIX.length)) : null; } catch { /* reported below */ }
    report = {
      ...(report || {ok:false,error:failure || 'Electron exited without a smoke-test report.'}),
      platform:process.platform, arch:process.arch,
      durationMs:Date.now()-started,
      timedOut, lastPhase, forcedShutdown,
      credentialExpectation:requireSecureStorage ? 'secure-round-trip' : requireInsecureRejection ? 'insecure-fallback-rejected' : 'optional',
    };
    const expectedKeyringShutdown = forcedShutdown && report.ok && report.sqlite?.ok && report.credentials?.supported === false && report.credentials?.reason === 'SECRET_STORAGE_TIMEOUT';
    if (expectedKeyringShutdown) report.shutdown = {clean:false,reason:'Electron native keyring worker remained pending after the bounded credential timeout; launcher terminated the completed smoke process.'};
    if (timedOut || (exitCode !== 0 && !expectedKeyringShutdown)) { report.ok = false; report.error ||= failure || 'Electron smoke failed.'; }
    if (requireSecureStorage && !(report.credentials?.supported === true && report.credentials?.roundTrip === true && report.credentials?.ciphertext === true && report.credentials?.deleted === true && !forcedShutdown && !timedOut && (process.platform !== 'linux' || report.credentials.backend === 'gnome_libsecret'))) {
      report.ok = false;
      report.error = 'Required secure credential round trip did not complete with the expected native backend and clean shutdown.';
    }
    if (requireInsecureRejection && !(report.credentials?.supported === false && report.credentials?.roundTrip === false && report.credentials?.insecureFallbackRejected === true && report.credentials?.backend === 'basic_text' && report.credentials?.reason === 'SECRET_STORAGE_UNAVAILABLE' && !forcedShutdown && !timedOut)) {
      report.ok = false;
      report.error = 'Required basic_text fallback rejection was not observed.';
    }
    try {
      fs.rmSync(directory, {recursive:true,force:true,maxRetries:2,retryDelay:50});
      report.tempDataRemoved = !fs.existsSync(directory);
    } catch { report.ok = false; report.tempDataRemoved = false; report.error = 'Could not remove isolated smoke-test data.'; }
    // Surface an unverified keychain at the top level so it is impossible to
    // miss in the overall result, even when the run is otherwise ok.
    if (report.credentials?.unverified) {
      report.unverified = report.credentials.note || 'UNVERIFIED: secure storage was not exercised.';
      process.stderr.write(report.unverified + '\n');
    }
    const json = JSON.stringify(report,null,2) + '\n';
    if (reportPath) fs.writeFileSync(path.resolve(reportPath),json);
    process.stdout.write(json);
    process.exitCode = report.ok ? 0 : 1;
  }
  try {
    const executable = require('electron');
    const env = {...process.env};
    delete env.ELECTRON_RUN_AS_NODE;
    child = spawn(executable, [...(passwordStoreOption ? [passwordStoreOption] : []), __filename, '--core-smoke-child', directory], {env,stdio:['ignore','pipe','pipe'],windowsHide:true});
    child.stdout.on('data',chunk => {
      stdout += String(chunk); if (stdout.length > 1_000_000) stdout = stdout.slice(-1_000_000);
      const phase = stdout.split(/\r?\n/).reverse().find(line=>line.startsWith(PROGRESS_PREFIX));
      if (phase) lastPhase = phase.slice(PROGRESS_PREFIX.length);
      const complete = stdout.split(/\r?\n/).reverse().find(line=>line.startsWith(REPORT_PREFIX));
      if (complete && !shutdownGrace) {
        try {
          const report = JSON.parse(complete.slice(REPORT_PREFIX.length));
          if (report.ok && report.sqlite?.ok && report.credentials?.supported === false && report.credentials?.reason === 'SECRET_STORAGE_TIMEOUT') {
            shutdownGrace = setTimeout(() => { forcedShutdown = true; child.kill('SIGKILL'); },1000);
          }
        } catch { /* Wait for the complete JSON line. */ }
      }
    });
    // Electron platform diagnostics go to stderr; stdout remains one JSON document.
    child.stderr.on('data',chunk => process.stderr.write(chunk));
    child.on('error',error => finish(1,error.message));
    child.on('close',(code,signal) => finish(code ?? 1,timedOut ? 'Native smoke exceeded 18 seconds; an unavailable OS keyring or native startup may be blocking.' : signal ? `Electron exited with signal ${signal}.` : undefined));
    watchdog = setTimeout(() => { timedOut = true; child.kill('SIGKILL'); },18_000);
  } catch (error) { finish(1,error.message); }
}

async function runElectron() {
  const { app, safeStorage } = require('electron');
  const index = process.argv.indexOf('--core-smoke-child');
  const directory = index >= 0 ? process.argv[index+1] : undefined;
  assert(directory && path.dirname(directory) === os.tmpdir() && path.basename(directory).startsWith('aplyd-community-smoke-'), 'Use the Node smoke launcher to create isolated data.');
  assert(fs.statSync(directory).isDirectory(), 'Smoke directory does not exist.');
  app.setName('Aplyd Community Smoke');
  app.setPath('userData',directory);
  app.setPath('sessionData',directory);
  app.setPath('logs',path.join(directory,'logs'));
  const report = {ok:false, electron:process.versions.electron, node:process.versions.node, sqlite:{},credentials:{}};
  let database;
  const phase = name => console.log(PROGRESS_PREFIX + name);
  try {
    await app.whenReady();
    phase('database');
    app.dock?.hide();
    const community = require('../dist/main/community-data.js');
    database = require('../dist/main/database.js');
    community.initializeCommunityData(directory);
    const marker = JSON.parse(fs.readFileSync(path.join(directory,'.aplyd-community.json'),'utf8'));
    assert.equal(marker.appId,community.COMMUNITY_APP_ID);
    assert.equal(app.getPath('userData'),directory);
    database.initializeDatabase();
    assert.deepEqual(database.getAllApplications(),[]);
    const connection = database.getDatabase();
    assert.equal(path.resolve(connection.name),path.join(directory,'job-tracker.db'));
    const expectedVersion = Math.max(...database.MIGRATIONS.map(migration => migration.v));
    assert.equal(connection.pragma('user_version',{simple:true}),expectedVersion);
    assert.equal(connection.pragma('foreign_keys',{simple:true}),1);
    for (const table of ['applications','stage_history','email_accounts','action_items','leads','approvals','app_settings']) {
      assert(connection.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name=?").get(table),`Missing table: ${table}`);
    }
    const application = database.createApplication({
      company:'Fictional Smoke Company',job_title:'Synthetic Test Role',location:'Remote',job_url:'https://example.com/smoke',
      job_description:'Synthetic smoke fixture. Not a real application.',key_responsibilities:'Check native storage.',required_skills:'Testing',nice_to_have_skills:'',
    });
    assert.equal(database.getApplication(application.id).company,'Fictional Smoke Company');
    assert.equal(database.getAllApplications().length,1);
    const backup = await database.startupBackup();
    assert.equal(backup.ok,true,'Native SQLite backup failed.');
    assert.equal(connection.pragma('integrity_check',{simple:true}),'ok');
    database.closeDatabase();
    community.initializeCommunityData(directory);
    database.initializeDatabase();
    assert.equal(database.getApplication(application.id).job_title,'Synthetic Test Role');
    assert.equal(database.getAllApplications().length,1);
    assert.equal(database.getDatabase().pragma('user_version',{simple:true}),expectedVersion);
    report.sqlite = {ok:true,driver:'better-sqlite3',schemaVersion:expectedVersion,emptyStart:true,createReadReopen:true,backup:true,integrity:'ok'};

    const secrets = require('../dist/main/secret-store.js');
    const backend = process.platform === 'linux' ? safeStorage.getSelectedStorageBackend() : process.platform === 'darwin' ? 'macOS Keychain' : 'Windows DPAPI';
    const value = 'synthetic-smoke-value-' + require('node:crypto').randomUUID();
    const credentialFile = path.join(directory,'secrets','native-smoke.enc');
    let credentialWriteCompleted = false;
    phase('credential-availability-and-encrypt');
    try {
      // Exercise the production deadline and encryption check, not an unbounded
      // separate availability probe. A timeout is unverified keyring support.
      await secrets.setSecret('native-smoke',value);
      credentialWriteCompleted = true;
      const encrypted = fs.readFileSync(credentialFile);
      assert(!encrypted.includes(Buffer.from(value)),'Credential file contains plaintext.');
      phase('credential-decrypt');
      assert.equal(await secrets.getSecret('native-smoke'),value);
      phase('credential-delete');
      await secrets.deleteSecret('native-smoke');
      assert.equal(await secrets.getSecret('native-smoke'),null);
      report.credentials = {ok:true,supported:true,backend,roundTrip:true,ciphertext:true,deleted:true};
    } catch (error) {
      if (!(error instanceof secrets.SecretStorageUnavailableError)) throw error;
      if (backend === 'basic_text') {
        assert(!credentialWriteCompleted, 'Insecure fallback allowed a credential write.');
        assert(!fs.existsSync(credentialFile), 'Insecure fallback wrote a credential file before rejection.');
      }
      // Rejecting an insecure/unavailable keyring is a supported offline state;
      // this is not evidence of a successful native credential round trip.
      await secrets.deleteSecret('native-smoke');
      assert.equal(await secrets.getSecret('native-smoke'),null);
      assert(!fs.existsSync(path.join(directory,'secrets','native-smoke.enc')));
      report.credentials = {ok:true,supported:false,backend,reason:error.code,message:error.message,roundTrip:false,insecureFallbackRejected:true};
      // A keychain that never answers (common over SSH with no GUI session) is
      // NOT a pass: mark it clearly so a green overall result is not mistaken
      // for a verified secure round trip.
      if (error.code === 'SECRET_STORAGE_TIMEOUT') {
        report.credentials.unverified = true;
        report.credentials.note = 'UNVERIFIED: keychain did not respond; secure storage was not exercised.';
      }
    }
    report.ok = true;
  } catch (error) { report.error = String(error?.message || error); }
  finally {
    try { database?.closeDatabase(); } catch { report.ok=false; report.error='Could not close smoke database.'; }
    // The launcher removes only the directory it created after Electron exits.
    console.log(REPORT_PREFIX + JSON.stringify(report));
    app.exit(report.ok ? 0 : 1);
  }
}
