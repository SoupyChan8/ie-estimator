/**
 * Interior Editors Estimator — backend (Google Apps Script, bound to a Google Sheet).
 *
 * The Sheet holds the rate book, users and contracts. Signatures and PDFs are saved in Drive.
 * Every request except "login" needs a valid session token. Studio actions (rate book,
 * contracts, PDFs) additionally need the password to have been re-entered in the last 30 minutes.
 *
 * Setup (once): open the Sheet → Estimator menu → "1. Set up sheets", then "2. Add or reset a user".
 * Then Deploy → New deployment → Web app → Execute as: Me, Who has access: Anyone.
 */

const TABS = { categories: 'Categories', items: 'Items', contracts: 'Contracts', users: 'Users', versions: 'Versions' };
const COLS = {
  Categories: ['id', 'name', 'sortOrder'],
  // parentId: blank for a main item; the id of another item in the same category for a nested add-on
  // (e.g. Puja Unit and Crockery Display nested under TV Unit). One level of nesting.
  Items: ['id', 'categoryId', 'parentId', 'name', 'description', 'unit', 'rateStandard', 'ratePremium', 'rateLuxury',
    'qtyBhk1', 'qtyBhk2', 'qtyBhk3', 'qtyBhk4', 'scalesWithArea', 'active', 'sortOrder'],
  Contracts: ['id', 'quotationNo', 'createdAt', 'clientName', 'clientPhone', 'clientEmail', 'siteAddress',
    'projectScope', 'bhk', 'carpetArea', 'tier', 'total', 'designerName', 'createdBy', 'lineItemsJson',
    'clientSigFileId', 'designerSigFileId', 'pdfFileId', 'pdfUrl', 'pdfOptionsJson'],
  Users: ['email', 'name', 'passwordHash', 'salt', 'active'],
  // Saved versions. kind: "ratebook" (a snapshot of Categories + Items) or "terms" (included / not included,
  // payment schedule, project timeline). Large snapshots are kept as JSON files in Drive (dataFileId).
  Versions: ['id', 'kind', 'name', 'createdAt', 'createdBy', 'updatedAt', 'summary', 'dataJson', 'dataFileId', 'hash'],
};
const SESSION_DAYS = 30;
const STUDIO_MINUTES = 30;
const UNITS = ['sqft', 'rft', 'nos', 'lumpsum'];
const TIERS = ['standard', 'premium', 'luxury'];

/* ───────────────────────── Web app entry points ───────────────────────── */

function doGet() {
  return json({ ok: true, service: 'Interior Editors Estimator API' });
}

/** Runs a rate book change under the lock, then returns its result plus the fresh rate book and versions. */
function withState(fn) {
  return withLock(() => {
    const res = fn();
    clearCatalogCache();
    const out = res && typeof res === 'object' && !Array.isArray(res) ? Object.assign({}, res) : { result: res };
    out.state = rateBookState();
    return out;
  });
}

function doPost(e) {
  try {
    const req = JSON.parse(e.postData.contents);
    const action = String(req.action || '');
    const p = req.payload || {};

    if (action === 'login') return json(login(p.email, p.password));

    const session = getSession(req.token);
    if (!session) return json({ error: 'Please sign in again.', code: 'auth' });
    migrateCarpetArea();

    switch (action) {
      case 'me': return json({ email: session.email, name: session.name, studioUntil: session.studioUntil || 0 });
      case 'logout': deleteSession(req.token); return json({ ok: true });
      case 'catalog': return json(getCatalog());
      case 'saveContract': return json(withLock(() => saveContract(p, session)));
      case 'unlockStudio': return json(unlockStudio(req.token, session, p.password));
    }

    if (!session.studioUntil || session.studioUntil < Date.now()) {
      return json({ error: 'Enter your password to open the studio.', code: 'studio' });
    }

    switch (action) {
      case 'listContracts': return json(listContracts());
      case 'getContract': return json(getContract(Number(p.id)));
      case 'deleteContract': return json(withLock(() => deleteContract(Number(p.id))));
      case 'rateBookState': return json(rateBookState());
      case 'saveCategory': return json(withState(() => saveCategory(p)));
      case 'deleteCategory': return json(withState(() => deleteCategory(Number(p.id))));
      case 'saveItem': return json(withState(() => saveItem(p)));
      case 'deleteItem': return json(withState(() => deleteItem(Number(p.id))));
      case 'savePdf': return json(withLock(() => savePdf(p)));
      case 'saveContractOptions': return json(withLock(() => saveContractOptions(p)));
      case 'listVersions': return json(listVersions(p.kind));
      case 'getVersion': return json(getVersion(Number(p.id)));
      case 'saveVersion': return json(withState(() => saveVersion(p, session)));
      case 'deleteVersion': return json(withState(() => deleteVersion(Number(p.id))));
      case 'restoreRateBook': return json(withState(() => restoreRateBook(Number(p.id), session)));
      case 'setDefaultTerms': return json(setDefaultTerms(p.id === null || p.id === undefined ? null : Number(p.id)));
      case 'changePassword': return json(changePassword(session, p.currentPassword, p.newPassword));
    }
    return json({ error: 'Unknown action: ' + action });
  } catch (err) {
    return json({ error: String((err && err.message) || err) });
  }
}

function json(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}

function withLock(fn) {
  const lock = LockService.getScriptLock();
  lock.waitLock(20000);
  try { return fn(); } finally { lock.releaseLock(); }
}

/* ───────────────────────── Auth ───────────────────────── */

function hashPassword(password, salt) {
  let h = salt + ':' + password;
  for (let i = 0; i < 400; i++) {
    h = Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, h, Utilities.Charset.UTF_8)
      .map(b => ('0' + (b & 0xff).toString(16)).slice(-2)).join('');
  }
  return h;
}

function findUser(email) {
  email = String(email || '').trim().toLowerCase();
  return readTable(TABS.users).find(u => String(u.email).trim().toLowerCase() === email && u.active !== false) || null;
}

function login(email, password) {
  email = String(email || '').trim().toLowerCase();
  const cache = CacheService.getScriptCache();
  const failKey = 'fail_' + email;
  const fails = Number(cache.get(failKey) || 0);
  if (fails >= 5) return { error: 'Too many attempts. Try again in 15 minutes.' };

  const user = findUser(email);
  if (!user || hashPassword(String(password || ''), user.salt) !== user.passwordHash) {
    cache.put(failKey, String(fails + 1), 15 * 60);
    Utilities.sleep(600);
    return { error: 'Wrong email or password.' };
  }
  cache.remove(failKey);
  cleanSessions();
  const token = Utilities.getUuid() + Utilities.getUuid().replace(/-/g, '');
  const session = { email: email, name: user.name || email, exp: Date.now() + SESSION_DAYS * 86400000, studioUntil: 0 };
  PropertiesService.getScriptProperties().setProperty('sess_' + token, JSON.stringify(session));
  return { token: token, email: session.email, name: session.name };
}

function getSession(token) {
  if (!token || typeof token !== 'string') return null;
  const raw = PropertiesService.getScriptProperties().getProperty('sess_' + token);
  if (!raw) return null;
  const s = JSON.parse(raw);
  if (s.exp < Date.now() || !findUser(s.email)) { deleteSession(token); return null; }
  return s;
}

function deleteSession(token) {
  if (token) PropertiesService.getScriptProperties().deleteProperty('sess_' + token);
}

function cleanSessions() {
  const props = PropertiesService.getScriptProperties();
  const all = props.getProperties();
  Object.keys(all).forEach(k => {
    if (k.indexOf('sess_') === 0) {
      try { if (JSON.parse(all[k]).exp < Date.now()) props.deleteProperty(k); } catch (e) { props.deleteProperty(k); }
    }
  });
}

function unlockStudio(token, session, password) {
  const user = findUser(session.email);
  if (!user || hashPassword(String(password || ''), user.salt) !== user.passwordHash) {
    Utilities.sleep(600);
    return { error: 'Wrong password.' };
  }
  session.studioUntil = Date.now() + STUDIO_MINUTES * 60000;
  PropertiesService.getScriptProperties().setProperty('sess_' + token, JSON.stringify(session));
  return { studioUntil: session.studioUntil };
}

function changePassword(session, currentPassword, newPassword) {
  newPassword = String(newPassword || '');
  if (newPassword.length < 6) return { error: 'New password must be at least 6 characters.' };
  return withLock(() => {
    const sheet = sheetOf(TABS.users);
    const rows = sheet.getDataRange().getValues();
    const head = headersOf(TABS.users);
    const E = head.indexOf('email'), H = head.indexOf('passwordHash'), S = head.indexOf('salt');
    for (let r = 1; r < rows.length; r++) {
      if (String(rows[r][E]).trim().toLowerCase() === session.email) {
        if (hashPassword(String(currentPassword || ''), rows[r][S]) !== rows[r][H]) return { error: 'Current password is wrong.' };
        const salt = Utilities.getUuid();
        sheet.getRange(r + 1, H + 1).setValue(hashPassword(newPassword, salt));
        sheet.getRange(r + 1, S + 1).setValue(salt);
        return { ok: true };
      }
    }
    return { error: 'User not found.' };
  });
}

/* ───────────────────────── Sheet helpers ───────────────────────── */

function ss() {
  const id = PropertiesService.getScriptProperties().getProperty('SPREADSHEET_ID');
  return id ? SpreadsheetApp.openById(id) : SpreadsheetApp.getActiveSpreadsheet();
}

function sheetOf(name) {
  const sh = ss().getSheetByName(name);
  if (!sh) throw new Error('Missing sheet "' + name + '". Run Estimator → Set up sheets.');
  return sh;
}

function readTable(name) {
  const values = sheetOf(name).getDataRange().getValues();
  const head = values[0];
  return values.slice(1).filter(r => r.some(c => c !== '')).map(r => {
    const o = {};
    head.forEach((h, i) => { o[h] = r[i]; });
    return o;
  });
}

/** Row values in the sheet's own column order, so columns can be moved or added in the Sheet. */
function headersOf(name) {
  const sh = sheetOf(name);
  return sh.getRange(1, 1, 1, sh.getLastColumn()).getValues()[0].map(String);
}

function rowFor(name, obj) {
  return headersOf(name).map(c => (obj[c] === undefined || obj[c] === null ? '' : obj[c]));
}

/** Adds a missing column header (for sheets created before the column existed). */
function ensureColumn(name, key) {
  const sh = sheetOf(name);
  if (headersOf(name).indexOf(key) < 0) sh.getRange(1, sh.getLastColumn() + 1).setValue(key).setFontWeight('bold');
  return colOf(name, key);
}

function colOf(name, key) {
  const i = headersOf(name).indexOf(key);
  if (i < 0) throw new Error('Column "' + key + '" missing in sheet "' + name + '". Run Estimator → Set up sheets.');
  return i + 1;
}

function findRowIndex(name, id) {
  const sh = sheetOf(name);
  const col = headersOf(name).indexOf('id') + 1;
  if (col < 1 || sh.getLastRow() < 2) return -1;
  const ids = sh.getRange(1, col, sh.getLastRow(), 1).getValues();
  for (let r = 1; r < ids.length; r++) if (Number(ids[r][0]) === id) return r + 1;
  return -1;
}

function nextId(name) {
  const rows = readTable(name);
  return rows.reduce((m, r) => Math.max(m, Number(r.id) || 0), 0) + 1;
}

function deleteRowById(name, id) {
  const row = findRowIndex(name, id);
  if (row > 0) sheetOf(name).deleteRow(row);
  return { ok: true };
}

const num = v => (v === '' || v === null || v === undefined ? 0 : Number(v));
const numOrNull = v => (v === '' || v === null || v === undefined ? null : Number(v));
const bool = v => v === true || String(v).toUpperCase() === 'TRUE';

/* ───────────────────────── Rate book ───────────────────────── */

const normCategory = c => ({ id: Number(c.id), name: String(c.name), sortOrder: num(c.sortOrder) });
const normItem = i => ({
  id: Number(i.id), categoryId: Number(i.categoryId), parentId: numOrNull(i.parentId),
  name: String(i.name), description: String(i.description || ''),
  unit: UNITS.indexOf(i.unit) >= 0 ? i.unit : 'sqft',
  rateStandard: num(i.rateStandard), ratePremium: numOrNull(i.ratePremium), rateLuxury: numOrNull(i.rateLuxury),
  qtyBhk1: num(i.qtyBhk1), qtyBhk2: num(i.qtyBhk2), qtyBhk3: num(i.qtyBhk3), qtyBhk4: num(i.qtyBhk4),
  scalesWithArea: bool(i.scalesWithArea), active: i.active === '' || i.active === undefined ? true : bool(i.active),
  sortOrder: num(i.sortOrder),
});

/** The live rate book. Cached for 10 minutes; any rate book change (in the app or the Sheet) clears it. */
function getCatalog() {
  const cache = CacheService.getScriptCache();
  const hit = cache.get('catalog');
  if (hit) { try { return JSON.parse(hit); } catch (e) { /* rebuild */ } }
  const categories = readTable(TABS.categories).map(normCategory)
    .sort((a, b) => a.sortOrder - b.sortOrder || a.id - b.id);
  const items = readTable(TABS.items).map(normItem)
    .sort((a, b) => a.sortOrder - b.sortOrder || a.id - b.id);
  const out = { categories: categories, items: items };
  const str = JSON.stringify(out);
  if (str.length < 95000) { try { cache.put('catalog', str, 600); } catch (e) { /* too big */ } }
  return out;
}

function clearCatalogCache() {
  CacheService.getScriptCache().remove('catalog');
}

/** Simple trigger: an edit made directly in the Sheet shows up in the app straight away. */
function onEdit() {
  clearCatalogCache();
}

function saveCategory(p) {
  const name = String(p.name || '').trim();
  if (!name) throw new Error('Category name is required.');
  if (p.id) {
    const row = findRowIndex(TABS.categories, Number(p.id));
    if (row < 0) throw new Error('Category not found.');
    sheetOf(TABS.categories).getRange(row, colOf(TABS.categories, 'name')).setValue(name);
    return { id: Number(p.id) };
  }
  const id = nextId(TABS.categories);
  const sort = readTable(TABS.categories).reduce((m, c) => Math.max(m, num(c.sortOrder)), 0) + 1;
  sheetOf(TABS.categories).appendRow(rowFor(TABS.categories, { id: id, name: name, sortOrder: sort }));
  return { id: id };
}

function deleteCategory(id) {
  const sheet = sheetOf(TABS.items);
  const values = sheet.getDataRange().getValues();
  const catCol = headersOf(TABS.items).indexOf('categoryId');
  for (let r = values.length - 1; r >= 1; r--) if (Number(values[r][catCol]) === id) sheet.deleteRow(r + 1);
  return deleteRowById(TABS.categories, id);
}

/** Deletes an item and anything nested under it. */
function deleteItem(id) {
  const sheet = sheetOf(TABS.items);
  const values = sheet.getDataRange().getValues();
  const head = headersOf(TABS.items);
  const idCol = head.indexOf('id'), parentCol = head.indexOf('parentId');
  for (let r = values.length - 1; r >= 1; r--) {
    if (Number(values[r][idCol]) === id || (parentCol >= 0 && Number(values[r][parentCol]) === id)) sheet.deleteRow(r + 1);
  }
  return { ok: true };
}

function saveItem(p) {
  const name = String(p.name || '').trim();
  if (!name) throw new Error('Item name is required.');
  const all = readTable(TABS.items);
  let parentId = p.parentId === null || p.parentId === undefined || p.parentId === '' ? '' : Number(p.parentId);
  if (parentId !== '') {
    const parent = all.find(i => Number(i.id) === parentId);
    if (!parent) throw new Error('The main item it is nested under no longer exists.');
    if (parent.parentId !== '' && parent.parentId !== null) throw new Error('Add-ons can only be nested one level deep.');
    if (p.id && Number(p.id) === parentId) throw new Error('An item cannot be nested under itself.');
    if (p.id && all.some(i => Number(i.parentId) === Number(p.id))) throw new Error('This item has its own add-ons, so it cannot be nested under another item.');
    p.categoryId = Number(parent.categoryId);
  }
  const item = {
    categoryId: Number(p.categoryId), parentId: parentId, name: name, description: String(p.description || '').trim(),
    unit: UNITS.indexOf(p.unit) >= 0 ? p.unit : 'sqft',
    rateStandard: Math.max(0, num(p.rateStandard)),
    ratePremium: p.ratePremium === null || p.ratePremium === '' ? '' : Math.max(0, num(p.ratePremium)),
    rateLuxury: p.rateLuxury === null || p.rateLuxury === '' ? '' : Math.max(0, num(p.rateLuxury)),
    qtyBhk1: num(p.qtyBhk1), qtyBhk2: num(p.qtyBhk2), qtyBhk3: num(p.qtyBhk3), qtyBhk4: num(p.qtyBhk4),
    scalesWithArea: bool(p.scalesWithArea), active: p.active === undefined ? true : bool(p.active),
  };
  const sheet = sheetOf(TABS.items);
  if (p.id) {
    const row = findRowIndex(TABS.items, Number(p.id));
    if (row < 0) throw new Error('Item not found.');
    const old = all.find(i => Number(i.id) === Number(p.id));
    item.id = Number(p.id);
    item.sortOrder = old ? old.sortOrder : 0;
    const width = headersOf(TABS.items).length;
    sheet.getRange(row, 1, 1, width).setValues([rowFor(TABS.items, item)]);
    // Add-ons follow their main item into a new category.
    const head = headersOf(TABS.items);
    const values = sheet.getDataRange().getValues();
    for (let r = 1; r < values.length; r++) {
      if (Number(values[r][head.indexOf('parentId')]) === item.id) sheet.getRange(r + 1, head.indexOf('categoryId') + 1).setValue(item.categoryId);
    }
    return { id: item.id };
  }
  item.id = nextId(TABS.items);
  item.sortOrder = all.filter(i => Number(i.categoryId) === item.categoryId)
    .reduce((m, i) => Math.max(m, num(i.sortOrder)), 0) + 1;
  sheet.appendRow(rowFor(TABS.items, item));
  return { id: item.id };
}

/* ───────────────────────── Contracts ───────────────────────── */

function folder(key, name) {
  const props = PropertiesService.getScriptProperties();
  const id = props.getProperty(key);
  if (id) { try { return DriveApp.getFolderById(id); } catch (e) { /* recreate */ } }
  const root = rootFolder();
  const f = root.createFolder(name);
  props.setProperty(key, f.getId());
  return f;
}

function rootFolder() {
  const props = PropertiesService.getScriptProperties();
  const id = props.getProperty('ROOT_FOLDER_ID');
  if (id) { try { return DriveApp.getFolderById(id); } catch (e) { /* recreate */ } }
  const f = DriveApp.createFolder('Interior Editors Estimator');
  props.setProperty('ROOT_FOLDER_ID', f.getId());
  return f;
}

function savePng(dataUrl, name) {
  const prefix = 'data:image/png;base64,';
  if (typeof dataUrl !== 'string' || dataUrl.indexOf(prefix) !== 0 || dataUrl.length > 800000) {
    throw new Error('Invalid signature.');
  }
  const blob = Utilities.newBlob(Utilities.base64Decode(dataUrl.slice(prefix.length)), 'image/png', name);
  return folder('SIG_FOLDER_ID', 'Signatures').createFile(blob).getId();
}

function saveContract(p, session) {
  const clientName = String(p.clientName || '').trim();
  if (!clientName) throw new Error('Client name is required.');
  if (TIERS.indexOf(p.tier) < 0) throw new Error('Invalid tier.');
  const bhk = Number(p.bhk);
  if (!(bhk >= 1 && bhk <= 10)) throw new Error('Invalid BHK.');
  const lines = (Array.isArray(p.lineItems) ? p.lineItems : []).slice(0, 300).map(l => {
    const qty = Math.max(0, num(l.qty));
    const rate = Math.max(0, num(l.rate));
    return {
      itemId: Number(l.itemId), parentItemId: l.parentItemId === null || l.parentItemId === undefined ? null : Number(l.parentItemId),
      categoryName: String(l.categoryName || '').slice(0, 200),
      name: String(l.name || '').slice(0, 300), description: String(l.description || '').slice(0, 1000),
      unit: UNITS.indexOf(l.unit) >= 0 ? l.unit : 'sqft', qty: qty, rate: rate, amount: Math.round(qty * rate),
    };
  });
  if (!lines.length) throw new Error('No items selected.');
  const total = lines.reduce((s, l) => s + l.amount, 0);

  const props = PropertiesService.getScriptProperties();
  const n = Number(props.getProperty('NEXT_QUOTE_NO') || 154);
  props.setProperty('NEXT_QUOTE_NO', String(n + 1));
  const now = new Date();
  const quotationNo = 'IE-' + now.getFullYear() + '-' + n;
  const id = nextId(TABS.contracts);

  const c = {
    id: id, quotationNo: quotationNo, createdAt: now.toISOString(), clientName: clientName,
    clientPhone: String(p.clientPhone || '').slice(0, 50), clientEmail: String(p.clientEmail || '').slice(0, 200),
    siteAddress: String(p.siteAddress || '').slice(0, 500), projectScope: String(p.projectScope || '').slice(0, 500),
    bhk: bhk, carpetArea: num(p.carpetArea), tier: p.tier, total: total,
    designerName: String(p.designerName || '').slice(0, 200), createdBy: session.email,
    lineItemsJson: JSON.stringify(lines),
    clientSigFileId: savePng(p.clientSignature, quotationNo + ' - client.png'),
    designerSigFileId: savePng(p.designerSignature, quotationNo + ' - interior editors.png'),
    pdfFileId: '', pdfUrl: '',
  };
  sheetOf(TABS.contracts).appendRow(rowFor(TABS.contracts, c));
  return { id: id, quotationNo: quotationNo, total: total };
}

function contractSummary(c) {
  return {
    id: Number(c.id), quotationNo: String(c.quotationNo), clientName: String(c.clientName),
    siteAddress: String(c.siteAddress || ''), projectScope: String(c.projectScope || ''), bhk: num(c.bhk),
    carpetArea: num(c.carpetArea), tier: String(c.tier), total: num(c.total),
    createdAt: c.createdAt instanceof Date ? c.createdAt.toISOString() : String(c.createdAt),
    pdfUrl: String(c.pdfUrl || ''),
  };
}

function listContracts() {
  return readTable(TABS.contracts).map(contractSummary).sort((a, b) => b.id - a.id);
}

function pngDataUrl(fileId) {
  if (!fileId) return '';
  try {
    return 'data:image/png;base64,' + Utilities.base64Encode(DriveApp.getFileById(fileId).getBlob().getBytes());
  } catch (e) { return ''; }
}

function getContract(id) {
  const c = readTable(TABS.contracts).find(r => Number(r.id) === id);
  if (!c) throw new Error('Contract not found.');
  const out = contractSummary(c);
  out.clientPhone = String(c.clientPhone || '');
  out.clientEmail = String(c.clientEmail || '');
  out.designerName = String(c.designerName || '');
  out.lineItems = JSON.parse(c.lineItemsJson || '[]');
  out.clientSignature = pngDataUrl(c.clientSigFileId);
  out.designerSignature = pngDataUrl(c.designerSigFileId);
  out.signedAt = out.createdAt;
  out.pdfOptions = null;
  if (c.pdfOptionsJson) { try { out.pdfOptions = JSON.parse(c.pdfOptionsJson); } catch (e) { /* ignore bad JSON */ } }
  out.defaultOptions = defaultTermsData();
  return out;
}

/** Studio edits for the PDF: what's included / not included, payment schedule and project timeline. */
function saveContractOptions(p) {
  const id = Number(p.id);
  const row = findRowIndex(TABS.contracts, id);
  if (row < 0) throw new Error('Contract not found.');
  const clean = cleanTerms(p.options);
  clean.showSignatures = !(p.options && p.options.showSignatures === false);
  sheetOf(TABS.contracts).getRange(row, ensureColumn(TABS.contracts, 'pdfOptionsJson')).setValue(JSON.stringify(clean));
  return { options: clean };
}

function cleanTerms(o) {
  o = o || {};
  const text = (v, n) => String(v === undefined || v === null ? '' : v).trim().slice(0, n);
  const list = (arr) => (Array.isArray(arr) ? arr : []).map(x => text(x, 300)).filter(Boolean).slice(0, 20);
  return {
    included: list(o.included),
    notIncluded: list(o.notIncluded),
    payments: (Array.isArray(o.payments) ? o.payments : []).slice(0, 10).map(x => ({
      pct: Math.max(0, Math.min(100, num(x.pct))), title: text(x.title, 80), sub: text(x.sub, 160),
    })).filter(x => x.title || x.pct),
    timeline: (Array.isArray(o.timeline) ? o.timeline : []).slice(0, 8).map(x => ({ title: text(x.title, 60), sub: text(x.sub, 40) }))
      .filter(x => x.title),
  };
}

/* ───────────────────────── Versions ───────────────────────── */

/** Creates the Versions tab on sheets set up before versions existed. */
function versionsSheet() {
  const book = ss();
  let sh = book.getSheetByName(TABS.versions);
  if (!sh) {
    sh = book.insertSheet(TABS.versions);
    sh.appendRow(COLS.Versions);
    sh.setFrozenRows(1);
    sh.getRange(1, 1, 1, COLS.Versions.length).setFontWeight('bold').setBackground('#dcd3c2');
  } else if (sh.getRange(1, 1, 1, sh.getLastColumn()).getValues()[0].indexOf('hash') < 0) {
    sh.getRange(1, sh.getLastColumn() + 1).setValue('hash').setFontWeight('bold');
  }
  return sh;
}

function versionData(v) {
  if (v.dataFileId) return JSON.parse(DriveApp.getFileById(String(v.dataFileId)).getBlob().getDataAsString());
  return v.dataJson ? JSON.parse(v.dataJson) : null;
}

function versionRow(v) {
  const props = PropertiesService.getScriptProperties();
  return {
    id: Number(v.id), kind: String(v.kind), name: String(v.name),
    createdAt: v.createdAt instanceof Date ? v.createdAt.toISOString() : String(v.createdAt),
    updatedAt: v.updatedAt instanceof Date ? v.updatedAt.toISOString() : String(v.updatedAt || v.createdAt),
    createdBy: String(v.createdBy || ''), summary: String(v.summary || ''),
    isDefault: v.kind === 'terms' && String(props.getProperty('DEFAULT_TERMS_VERSION') || '') === String(v.id),
    isActive: v.kind === 'ratebook' && String(props.getProperty('ACTIVE_RATEBOOK_VERSION') || '') === String(v.id),
  };
}

/** Key-order-independent JSON, used to tell whether the live rate book still matches its loaded version. */
function canon(x) {
  if (Array.isArray(x)) return '[' + x.map(canon).join(',') + ']';
  if (x && typeof x === 'object') return '{' + Object.keys(x).sort().map(k => JSON.stringify(k) + ':' + canon(x[k])).join(',') + '}';
  return JSON.stringify(x === undefined ? null : x);
}

function rateBookMatches(data) {
  return !!data && canonRateBook(getCatalog()) === canonRateBook(data);
}

function listVersions(kind) {
  versionsSheet();
  const rows = readTable(TABS.versions).filter(v => !kind || v.kind === kind);
  const live = kind === 'ratebook' || !kind ? liveRateBookMatch() : null;
  return rows.map(v => {
    const out = versionRow(v);
    if (v.kind === 'ratebook') {
      // isActive: the live rate book is exactly this version. isBase: the live rate book is a custom
      // (unsaved) edit that started from this version.
      out.isActive = live.matchId === Number(v.id);
      out.isBase = !live.matchId && live.baseId === Number(v.id);
      out.edited = out.isBase;
    }
    return out;
  }).sort((a, b) => b.id - a.id);
}

/**
 * Which saved rate book version the live rate book is identical to (matchId, or null for a custom,
 * unsaved rate book), and which version it was last loaded from (baseId). Keeps ACTIVE_RATEBOOK_VERSION
 * pointing at the match, so edits that land on another version are recognised as that version.
 */
function liveRateBookMatch() {
  const props = PropertiesService.getScriptProperties();
  const activeId = Number(props.getProperty('ACTIVE_RATEBOOK_VERSION') || 0) || null;
  const live = rateBookHash(getCatalog());
  const rank = (v) => (Number(v.id) === activeId ? 0 : /^(Backup before|Custom rates before)/.test(String(v.name)) ? 2 : 1);
  const books = readTable(TABS.versions).filter(v => v.kind === 'ratebook')
    .sort((a, b) => rank(a) - rank(b) || Number(b.id) - Number(a.id));
  let matchId = null;
  books.forEach(v => {
    let h = String(v.hash || '');
    if (!h) {
      // versions saved before fingerprints existed: work it out once and store it
      try { h = rateBookHash(versionData(v)); } catch (e) { return; }
      const row = findRowIndex(TABS.versions, Number(v.id));
      if (row > 0) sheetOf(TABS.versions).getRange(row, ensureColumn(TABS.versions, 'hash')).setValue(h);
    }
    if (!matchId && h === live) matchId = Number(v.id);
  });
  if (matchId && matchId !== activeId) props.setProperty('ACTIVE_RATEBOOK_VERSION', String(matchId));
  return { matchId: matchId, baseId: matchId || activeId };
}

/** Everything the Rate book screen needs after a change, so the app needs one round trip instead of three. */
function rateBookState() {
  return { catalog: getCatalog(), versions: listVersions('ratebook') };
}

/** Compares rate books by content: same fields normalised the same way, in id order, so row order doesn't matter. */
function canonRateBook(c) {
  if (!c) return '';
  const byId = (a, b) => a.id - b.id;
  return canon({
    categories: (c.categories || []).map(normCategory).sort(byId),
    items: (c.items || []).map(normItem).sort(byId),
  });
}

/** Short fingerprint of a rate book, stored with each version so matching never has to open them all. */
function rateBookHash(c) {
  return Utilities.computeDigest(Utilities.DigestAlgorithm.MD5, canonRateBook(c), Utilities.Charset.UTF_8)
    .map(b => ('0' + (b & 0xff).toString(16)).slice(-2)).join('');
}

function getVersion(id) {
  versionsSheet();
  const v = readTable(TABS.versions).find(r => Number(r.id) === id);
  if (!v) throw new Error('Version not found.');
  const out = versionRow(v);
  out.data = versionData(v);
  return out;
}

function writeVersionData(obj, name) {
  const s = JSON.stringify(obj);
  if (s.length <= 45000) return { dataJson: s, dataFileId: '' };
  const file = folder('VERSION_FOLDER_ID', 'Versions').createFile(Utilities.newBlob(s, 'application/json', name + '.json'));
  return { dataJson: '', dataFileId: file.getId() };
}

function rateBookSummary(c) {
  const mains = c.items.filter(i => i.parentId === null).length;
  return c.categories.length + ' categories · ' + mains + ' items · ' + (c.items.length - mains) + ' add-ons';
}

function termsSummary(t) {
  const pct = t.payments.reduce((s, p) => s + p.pct, 0);
  return t.included.length + ' included · ' + t.notIncluded.length + ' not included · ' + t.payments.length +
    ' payment stages (' + pct + '%) · ' + t.timeline.length + ' phases';
}

/**
 * Rate book: saves a snapshot of the live rate book (Categories + Items).
 * Terms: saves the given included / not included / payments / timeline. With an id, renames and,
 * for terms, replaces the content.
 */
function saveVersion(p, session) {
  const sh = versionsSheet();
  const kind = p.kind === 'ratebook' ? 'ratebook' : p.kind === 'terms' ? 'terms' : '';
  const name = String(p.name || '').trim().slice(0, 80);
  const now = new Date().toISOString();
  if (p.id) {
    const row = findRowIndex(TABS.versions, Number(p.id));
    if (row < 0) throw new Error('Version not found.');
    const old = readTable(TABS.versions).find(r => Number(r.id) === Number(p.id));
    const upd = { id: Number(p.id), kind: old.kind, name: name || old.name, createdAt: old.createdAt, createdBy: old.createdBy,
      updatedAt: now, summary: old.summary, dataJson: old.dataJson, dataFileId: old.dataFileId, hash: old.hash || '' };
    if (old.kind === 'terms' && p.data) {
      const t = cleanTerms(p.data);
      Object.assign(upd, writeVersionData(t, upd.name), { summary: termsSummary(t) });
    }
    if (old.kind === 'ratebook' && p.snapshot) {
      // "Update this version": overwrite it with the live rate book.
      const c = getCatalog();
      if (old.dataFileId) { try { DriveApp.getFileById(String(old.dataFileId)).setTrashed(true); } catch (e) { /* gone */ } }
      Object.assign(upd, writeVersionData(c, upd.name), { summary: rateBookSummary(c), hash: rateBookHash(c) });
      PropertiesService.getScriptProperties().setProperty('ACTIVE_RATEBOOK_VERSION', String(upd.id));
    }
    sh.getRange(row, 1, 1, headersOf(TABS.versions).length).setValues([rowFor(TABS.versions, upd)]);
    return versionRow(upd);
  }
  if (!kind) throw new Error('Unknown version type.');
  if (!name) throw new Error('Give the version a name.');
  const data = kind === 'ratebook' ? getCatalog() : cleanTerms(p.data);
  const v = { id: nextId(TABS.versions), kind: kind, name: name, createdAt: now, createdBy: session.email, updatedAt: now,
    summary: kind === 'ratebook' ? rateBookSummary(data) : termsSummary(data), hash: kind === 'ratebook' ? rateBookHash(data) : '' };
  Object.assign(v, writeVersionData(data, name));
  sh.appendRow(rowFor(TABS.versions, v));
  // A fresh rate book snapshot is identical to the live rate book, so it becomes the loaded version
  // (backups made automatically before a load don't).
  if (kind === 'ratebook' && !p.backup) PropertiesService.getScriptProperties().setProperty('ACTIVE_RATEBOOK_VERSION', String(v.id));
  return versionRow(v);
}

function deleteVersion(id) {
  versionsSheet();
  const v = readTable(TABS.versions).find(r => Number(r.id) === id);
  if (v && v.dataFileId) { try { DriveApp.getFileById(String(v.dataFileId)).setTrashed(true); } catch (e) { /* gone */ } }
  const props = PropertiesService.getScriptProperties();
  if (String(props.getProperty('DEFAULT_TERMS_VERSION') || '') === String(id)) props.deleteProperty('DEFAULT_TERMS_VERSION');
  if (String(props.getProperty('ACTIVE_RATEBOOK_VERSION') || '') === String(id)) props.deleteProperty('ACTIVE_RATEBOOK_VERSION');
  return deleteRowById(TABS.versions, id);
}

/** Replaces the live rate book with a saved one. The current rate book is saved first as a backup version. */
function restoreRateBook(id, session) {
  const target = getVersion(id);
  if (target.kind !== 'ratebook' || !target.data) throw new Error('That is not a rate book version.');
  // Back up the live rate book first, unless it is identical to a saved version.
  const props = PropertiesService.getScriptProperties();
  const backup = liveRateBookMatch().matchId ? null
    : saveVersion({ kind: 'ratebook', backup: true, name: 'Custom rates before switching to "' + target.name + '"' }, session);
  const data = target.data;
  [[TABS.categories, data.categories], [TABS.items, data.items]].forEach(([name, rows]) => {
    const sh = sheetOf(name);
    if (sh.getLastRow() > 1) sh.getRange(2, 1, sh.getLastRow() - 1, sh.getLastColumn()).clearContent();
    if (rows.length) {
      const values = rows.map(r => rowFor(name, Object.assign({}, r, { parentId: r.parentId === null ? '' : r.parentId })));
      sh.getRange(2, 1, values.length, values[0].length).setValues(values);
    }
    if (sh.getLastRow() > rows.length + 1) {
      // drop any now-empty trailing rows left from a longer rate book
      const extra = sh.getLastRow() - (rows.length + 1);
      if (extra > 0) sh.deleteRows(rows.length + 2, extra);
    }
  });
  clearCatalogCache();
  props.setProperty('ACTIVE_RATEBOOK_VERSION', String(id));
  return { ok: true, backupId: backup ? backup.id : null };
}

function setDefaultTerms(id) {
  const props = PropertiesService.getScriptProperties();
  if (id === null) props.deleteProperty('DEFAULT_TERMS_VERSION');
  else {
    const v = getVersion(id);
    if (v.kind !== 'terms') throw new Error('That is not a terms version.');
    props.setProperty('DEFAULT_TERMS_VERSION', String(id));
  }
  return { ok: true };
}

/** The terms new quotations start from: the default terms version, or null for the built-in PDF defaults. */
function defaultTermsData() {
  const id = PropertiesService.getScriptProperties().getProperty('DEFAULT_TERMS_VERSION');
  if (!id) return null;
  try { return getVersion(Number(id)).data; } catch (e) { return null; }
}

function deleteContract(id) {
  const c = readTable(TABS.contracts).find(r => Number(r.id) === id);
  if (c) {
    [c.clientSigFileId, c.designerSigFileId, c.pdfFileId].forEach(fid => {
      if (fid) { try { DriveApp.getFileById(fid).setTrashed(true); } catch (e) { /* already gone */ } }
    });
  }
  return deleteRowById(TABS.contracts, id);
}

function savePdf(p) {
  const id = Number(p.contractId);
  const row = findRowIndex(TABS.contracts, id);
  if (row < 0) throw new Error('Contract not found.');
  const b64 = String(p.base64 || '');
  if (!b64 || b64.length > 40 * 1024 * 1024) throw new Error('Invalid PDF.');
  const name = String(p.filename || 'Quotation.pdf').replace(/[\\/:*?"<>|]/g, '-').slice(0, 150);
  const blob = Utilities.newBlob(Utilities.base64Decode(b64), 'application/pdf', name);
  const sheet = sheetOf(TABS.contracts);
  const pdfCol = colOf(TABS.contracts, 'pdfFileId');
  const oldId = sheet.getRange(row, pdfCol).getValue();
  if (oldId) { try { DriveApp.getFileById(oldId).setTrashed(true); } catch (e) { /* ignore */ } }
  const file = folder('PDF_FOLDER_ID', 'Quotations').createFile(blob);
  sheet.getRange(row, pdfCol).setValue(file.getId());
  sheet.getRange(row, colOf(TABS.contracts, 'pdfUrl')).setValue(file.getUrl());
  return { url: file.getUrl() };
}

/* ───────────────────────── Carpet-area items ───────────────────────── */

const REF_AREA = { 1: 450, 2: 750, 3: 1100, 4: 1600 };

/**
 * "Quantity = carpet area" items: the quantity is the client's carpet area and the BHK columns are just 1/0
 * (included or not). Older rate books stored a typical quantity per BHK (e.g. 780 sq.ft of ceiling for a
 * 1,100 sq.ft 3 BHK) with a rate per sq.ft of that; this converts the rate to per carpet sq.ft so a typical
 * home costs the same. Running-ft / piece items can't be "per carpet sq.ft", so they stop scaling instead.
 * Items already converted (all BHK values 0 or 1) are left alone.
 */
function toCarpetArea(it) {
  if (!it.scalesWithArea) return it;
  const q = [it.qtyBhk1, it.qtyBhk2, it.qtyBhk3, it.qtyBhk4].map(num);
  if (q.every(x => x <= 1)) return it;
  const out = Object.assign({}, it);
  if (it.unit !== 'sqft') { out.scalesWithArea = false; return out; }
  const b = q[2] > 0 ? 3 : q.findIndex(x => x > 0) + 1;
  const f = q[b - 1] / REF_AREA[b];
  out.rateStandard = tidyRate(num(it.rateStandard) * f);
  if (it.ratePremium !== null && it.ratePremium !== '') out.ratePremium = tidyRate(num(it.ratePremium) * f);
  if (it.rateLuxury !== null && it.rateLuxury !== '') out.rateLuxury = tidyRate(num(it.rateLuxury) * f);
  out.qtyBhk1 = q[0] > 0 ? 1 : 0; out.qtyBhk2 = q[1] > 0 ? 1 : 0; out.qtyBhk3 = q[2] > 0 ? 1 : 0; out.qtyBhk4 = q[3] > 0 ? 1 : 0;
  return out;
}

/** One-time upgrade of the live rate book and every saved rate book version to carpet-area quantities. */
function migrateCarpetArea() {
  const props = PropertiesService.getScriptProperties();
  if (props.getProperty('CARPET_AREA_V2')) return;
  withLock(() => {
    if (props.getProperty('CARPET_AREA_V2')) return;
    // live Items
    const sh = sheetOf(TABS.items);
    const head = headersOf(TABS.items);
    if (sh.getLastRow() > 1) {
      const range = sh.getRange(2, 1, sh.getLastRow() - 1, head.length);
      const values = range.getValues().map(r => {
        const o = {}; head.forEach((h, i) => { o[h] = r[i]; });
        if (!bool(o.scalesWithArea)) return r;
        const c = toCarpetArea(Object.assign({}, o, { scalesWithArea: true, unit: String(o.unit),
          ratePremium: o.ratePremium === '' ? null : o.ratePremium, rateLuxury: o.rateLuxury === '' ? null : o.rateLuxury }));
        return head.map(h => (c[h] === null || c[h] === undefined ? '' : c[h]));
      });
      range.setValues(values);
    }
    // saved rate book versions
    versionsSheet();
    readTable(TABS.versions).filter(v => v.kind === 'ratebook').forEach(v => {
      let data; try { data = versionData(v); } catch (e) { return; }
      if (!data || !data.items) return;
      const items = data.items.map(toCarpetArea);
      if (JSON.stringify(items) === JSON.stringify(data.items)) return;
      const next = { categories: data.categories, items: items };
      const row = findRowIndex(TABS.versions, Number(v.id));
      if (v.dataFileId) { try { DriveApp.getFileById(String(v.dataFileId)).setTrashed(true); } catch (e) { /* gone */ } }
      const upd = Object.assign({}, v, writeVersionData(next, String(v.name)), { hash: rateBookHash(next) });
      sheetOf(TABS.versions).getRange(row, 1, 1, headersOf(TABS.versions).length).setValues([rowFor(TABS.versions, upd)]);
    });
    clearCatalogCache();
    props.setProperty('CARPET_AREA_V2', String(Date.now()));
  });
}

/* ───────────────────────── Sample versions (for testing) ───────────────────────── */

/**
 * Rate figures are indicative 2026 Kolkata / metro market rates (DesignCafe, Livspace and Studio Matrx cost
 * guides): wardrobes ₹800–1,200/sq ft basic, ₹1,400–2,000 mid, ₹2,000–3,200 premium, ₹3,200+ luxury;
 * gypsum ceiling ₹120–180/sq ft, layered cove ceilings ₹200–300; premium emulsion ₹45–65/sq ft, designer
 * paint ₹80–150, artisan plaster ₹200+. Each tier column steps up within the version's market.
 */
const SAMPLE_RATEBOOKS = [
  {
    name: 'Value Homes 2026',
    note: 'First homes and rental flats — laminate finishes, essentials only',
    factor: 0.8,
    rates: {
      'TV Unit': [800, 1050, 1400], 'Louver Wall Panelling': [600, 800, 1100], 'Partition with Showpiece Sections': [800, 1050, 1400],
      'Sofa': [26000, 38000, 60000], 'Dining Table Set': [26000, 40000, 65000],
      'Modular Kitchen': [6000, 8000, 11000], 'Countertop': [950, 1600, 2600], 'Kitchen Dado': [140, 220, 380],
      'Wardrobe': [850, 1150, 1500], 'Wardrobe Loft': [700, 950, 1250],
      'Bed with Hydraulic Storage': [30000, 45000, 70000], 'Bed with Storage': [25000, 38000, 58000],
      'Headboard Wall Panelling': [500, 700, 1000],
      'Gypsum False Ceiling': [95, 120, 160], 'Cove / Profile Lighting': [150, 240, 380],
      'Electrical Labour & Wiring': [38, 50, 70], 'Light Fixtures': [30, 60, 110],
      'Interior Painting': [18, 26, 40], 'Texture / Wallpaper Feature Wall': [95, 160, 280],
    },
    // essentials only: no partition, louvers or bar for smaller homes
    qty: { 'Louver Wall Panelling': [0, 0, 30, 38], 'Partition with Showpiece Sections': [0, 0, 0, 32], 'Bar / Coffee Counter': [0, 0, 0, 12] },
  },
  {
    name: 'Premium Apartments 2026',
    note: 'Gated-community 2–3 BHKs — acrylic / PU finishes, Hettich hardware',
    factor: 1.25,
    rates: {
      'TV Unit': [1250, 1700, 2350], 'Modular Kitchen': [9500, 13000, 18500], 'Countertop': [2000, 3200, 4800],
      'Wardrobe': [1450, 1950, 2700], 'Wardrobe Loft': [1150, 1550, 2150],
      'Sofa': [55000, 85000, 140000], 'Dining Table Set': [60000, 95000, 160000],
      'Bed with Hydraulic Storage': [60000, 90000, 145000], 'Bed with Storage': [48000, 75000, 120000],
      'Gypsum False Ceiling': [140, 190, 260], 'Cove / Profile Lighting': [280, 420, 650],
      'Electrical Labour & Wiring': [55, 75, 105], 'Light Fixtures': [70, 120, 210],
      'Interior Painting': [32, 50, 80], 'Texture / Wallpaper Feature Wall': [180, 300, 500],
    },
    qty: {},
  },
  {
    name: 'High-End Residences 2026',
    note: 'Villas and penthouses — veneer, PU and stone, Blum / Häfele, design fee charged',
    factor: 1.8,
    rates: {
      'TV Unit': [2000, 2800, 3900], 'Louver Wall Panelling': [1500, 2100, 3000], 'Puja Unit': [2400, 3300, 4600],
      'Sofa': [120000, 190000, 320000], 'Ottomans (2 × 2)': [22000, 35000, 60000], 'Dining Table Set': [130000, 210000, 360000],
      'Modular Kitchen': [16000, 22000, 32000], 'Tall Unit': [2600, 3500, 4800], 'Countertop': [3500, 5500, 8500], 'Kitchen Dado': [450, 750, 1300],
      'Wardrobe': [2200, 3000, 4200], 'Wardrobe Loft': [1700, 2300, 3200],
      'Bed with Hydraulic Storage': [110000, 170000, 280000], 'Bed with Storage': [85000, 130000, 210000],
      'Headboard Wall Panelling': [1400, 2000, 2900], 'Vanity Unit': [38000, 60000, 95000], 'Mirror Cabinet with Light': [16000, 26000, 42000],
      'Gypsum False Ceiling': [220, 300, 420], 'Cove / Profile Lighting': [480, 700, 1000],
      'Electrical Labour & Wiring': [85, 110, 150], 'Light Fixtures': [180, 300, 500],
      'Interior Painting': [65, 110, 180], 'Texture / Wallpaper Feature Wall': [400, 650, 1100],
    },
    qty: { 'Bar / Coffee Counter': [0, 12, 15, 18] },
    // [category, name, description, unit, std, prem, lux, 1BHK, 2BHK, 3BHK, 4BHK, scalesWithArea, under?]
    add: [
      [4, 'Walk-in Wardrobe', 'Open walk-in with island drawers and glass shutters', 'sqft', 2800, 3800, 5200, 0, 0, 60, 80, false],
      [10, 'Engineered Wood Flooring', 'Engineered oak in bedrooms and living, with skirting', 'sqft', 450, 650, 950, 250, 420, 620, 900, true],
      [11, 'Smart Home Automation', 'App and voice control for lights, curtains and AC', 'nos', 150000, 250000, 400000, 1, 1, 1, 1, false],
      [11, 'Motorised Curtain Tracks', 'Silent motorised tracks, per window', 'nos', 18000, 26000, 38000, 2, 3, 4, 5, false, 'Smart Home Automation'],
      [11, 'Design Fee', 'Concept, 3D visualisation and full working drawings', 'sqft', 80, 110, 150, 450, 750, 1100, 1600, true],
    ],
  },
];

const SAMPLE_TERMS = [
  {
    name: 'Standard Residential',
    included: [
      'BWP anti-termite ply with Sunmica laminate finish, inside and out',
      'Design consultation, space planning and up to 2 rounds of 3D revisions',
      'Carpentry and modular furniture as per the approved drawings',
      'Electrical work and lighting for furniture',
      'Installation, final finishing and site cleaning',
      '1 year service warranty on workmanship',
    ],
    notIncluded: [
      'Appliances (AC, fridge, chimney, geyser, etc.)',
      'Loose furniture and décor not listed in the scope',
      'Curtains, mattresses, blinds and rugs',
      'Civil, plumbing and flooring changes',
      'Society / building permissions and charges',
      'Items not mentioned in the scope above',
    ],
    payments: [
      { pct: 10, title: 'Booking', sub: 'On signing the agreement' },
      { pct: 40, title: 'Design Sign-off', sub: 'Final 3D and materials approved, production starts' },
      { pct: 40, title: 'Material at Site', sub: 'Carcass and shutters delivered for installation' },
      { pct: 10, title: 'Handover', sub: 'After snag list is closed' },
    ],
    timeline: [
      { title: 'Design', sub: '2–3 weeks' },
      { title: 'Production', sub: '3–4 weeks' },
      { title: 'Installation', sub: '2–3 weeks' },
      { title: 'Handover', sub: 'Week 9–10' },
    ],
  },
  {
    name: 'High-End Turnkey',
    included: [
      'Marine-grade ply with PU, veneer and fluted finishes',
      'Blum / Häfele soft-close hardware and premium handles',
      'Concept design, photo-real 3D, mood boards and material samples',
      'Dedicated project manager with weekly site updates',
      'Lighting design, electrical work and fixture installation',
      'Styling, deep cleaning and handover walk-through',
      '10 year warranty on carcass, 2 years on hardware and workmanship',
    ],
    notIncluded: [
      'Appliances, sanitaryware and CP fittings',
      'Italian marble and stone supply (installation included)',
      'Art, décor accessories and soft furnishings',
      'Structural, façade and landscape work',
      'Society / building permissions and charges',
      'GST as applicable',
    ],
    payments: [
      { pct: 10, title: 'Booking', sub: 'On signing the agreement' },
      { pct: 15, title: 'Design Approval', sub: 'Concept, 3D and material selection signed off' },
      { pct: 30, title: 'Production', sub: 'Orders placed for veneer, stone and hardware' },
      { pct: 25, title: 'Installation', sub: 'Carcass and panelling installed on site' },
      { pct: 15, title: 'Finishing', sub: 'Polish, lighting and styling complete' },
      { pct: 5, title: 'Handover', sub: '30 days after handover, once snags are closed' },
    ],
    timeline: [
      { title: 'Concept & 3D', sub: '3–4 weeks' },
      { title: 'Material Selection', sub: '2 weeks' },
      { title: 'Production', sub: '5–6 weeks' },
      { title: 'Installation', sub: '4–5 weeks' },
      { title: 'Finishing & Styling', sub: '2 weeks' },
      { title: 'Handover', sub: 'Week 16–18' },
    ],
  },
  {
    name: 'Fast-Track 45 Days',
    included: [
      'BWP ply with laminate finishes from a ready material palette',
      'Design consultation with 1 round of 3D revisions',
      'Factory-made modular kitchen and wardrobes',
      'Installation and basic site cleaning',
      '1 year service warranty on workmanship',
    ],
    notIncluded: [
      'Custom veneer, PU or stone finishes',
      'Appliances, loose furniture and décor',
      'Civil, plumbing, painting and flooring work',
      'Design changes after production starts',
      'Society / building permissions and charges',
    ],
    payments: [
      { pct: 20, title: 'Booking', sub: 'On signing the agreement' },
      { pct: 50, title: 'Production Start', sub: 'Design frozen, factory order placed' },
      { pct: 25, title: 'Installation', sub: 'Material delivered to site' },
      { pct: 5, title: 'Handover', sub: 'On completion' },
    ],
    timeline: [
      { title: 'Design', sub: '1 week' },
      { title: 'Production', sub: '3 weeks' },
      { title: 'Installation', sub: '2 weeks' },
      { title: 'Handover', sub: 'Day 45' },
    ],
  },
];

/** Rounds a rate to a tidy figure: nearest 5 under ₹500, 50 under ₹5,000, then 1,000. */
function tidyRate(n) {
  if (n <= 0) return 0;
  const step = n < 500 ? 5 : n < 5000 ? 50 : 1000;
  return Math.round(n / step) * step;
}

function buildSampleRateBook(spec) {
  const base = seedCatalog(true); // old per-BHK quantities; converted to carpet area at the end
  const items = base.items.map(it => {
    const out = Object.assign({}, it);
    const r = spec.rates[it.name];
    if (r) { out.rateStandard = r[0]; out.ratePremium = r[1]; out.rateLuxury = r[2]; }
    else {
      out.rateStandard = tidyRate(it.rateStandard * spec.factor);
      out.ratePremium = it.ratePremium === null ? null : tidyRate(it.ratePremium * spec.factor);
      out.rateLuxury = it.rateLuxury === null ? null : tidyRate(it.rateLuxury * spec.factor);
    }
    const q = spec.qty[it.name];
    if (q) { out.qtyBhk1 = q[0]; out.qtyBhk2 = q[1]; out.qtyBhk3 = q[2]; out.qtyBhk4 = q[3]; }
    return out;
  });
  let nextIdNum = items.reduce((m, i) => Math.max(m, i.id), 0) + 1;
  (spec.add || []).forEach(a => {
    const under = a[12] ? items.find(i => i.categoryId === a[0] && i.name === a[12] && i.parentId === null) : null;
    items.push({
      id: nextIdNum++, categoryId: a[0], parentId: under ? under.id : null, name: a[1], description: a[2], unit: a[3],
      rateStandard: a[4], ratePremium: a[5], rateLuxury: a[6], qtyBhk1: a[7], qtyBhk2: a[8], qtyBhk3: a[9], qtyBhk4: a[10],
      scalesWithArea: a[11], active: true, sortOrder: items.filter(i => i.categoryId === a[0]).length + 1,
    });
  });
  return { categories: base.categories, items: items.map(toCarpetArea) };
}

/** Sheet menu: adds 3 sample rate book versions and 3 sample terms versions (skips names that already exist). */
function addSampleVersions() {
  const sh = versionsSheet();
  const have = readTable(TABS.versions).map(v => v.kind + '|' + v.name);
  const now = new Date().toISOString();
  const added = [];
  const put = (kind, name, data, summary) => {
    if (have.indexOf(kind + '|' + name) >= 0) return;
    const v = { id: nextId(TABS.versions), kind: kind, name: name, createdAt: now, createdBy: 'Sample', updatedAt: now, summary: summary,
      hash: kind === 'ratebook' ? rateBookHash(data) : '' };
    Object.assign(v, writeVersionData(data, name));
    sh.appendRow(rowFor(TABS.versions, v));
    added.push(name);
  };
  SAMPLE_RATEBOOKS.forEach(spec => {
    const c = buildSampleRateBook(spec);
    put('ratebook', spec.name, c, rateBookSummary(c) + ' · ' + spec.note);
  });
  SAMPLE_TERMS.forEach(t => {
    const clean = cleanTerms(t);
    put('terms', t.name, clean, termsSummary(clean));
  });
  const msg = added.length ? 'Added: ' + added.join(', ') : 'The sample versions are already there.';
  try { SpreadsheetApp.getUi().alert(msg); } catch (e) { /* run from the editor */ }
  return { added: added };
}

/* ───────────────────────── Sheet menu & setup ───────────────────────── */

function onOpen() {
  SpreadsheetApp.getUi()
    .createMenu('Estimator')
    .addItem('1. Set up sheets (first time only)', 'setupSheets')
    .addItem('2. Add or reset a user', 'addUserPrompt')
    .addItem('Remove a user', 'removeUserPrompt')
    .addItem('Sign everyone out', 'signOutAll')
    .addSeparator()
    .addItem('Add sample versions (for testing)', 'addSampleVersions')
    .addToUi();
  if (typeof onOpenSupabase_ === 'function') onOpenSupabase_(SpreadsheetApp.getUi());
}

function setupSheets() {
  const book = SpreadsheetApp.getActiveSpreadsheet();
  PropertiesService.getScriptProperties().setProperty('SPREADSHEET_ID', book.getId());
  Object.keys(COLS).forEach(name => {
    let sh = book.getSheetByName(name);
    if (!sh) sh = book.insertSheet(name);
    if (sh.getLastRow() === 0) {
      sh.appendRow(COLS[name]);
      sh.setFrozenRows(1);
      sh.getRange(1, 1, 1, COLS[name].length).setFontWeight('bold').setBackground('#dcd3c2');
    } else {
      // Upgrading an older sheet: add any new columns at the end.
      const have = headersOf(name);
      COLS[name].filter(c => have.indexOf(c) < 0).forEach(c => sh.getRange(1, sh.getLastColumn() + 1).setValue(c).setFontWeight('bold'));
    }
  });
  const users = book.getSheetByName('Users');
  users.getRange('C:D').setFontColor('#999999');
  if (book.getSheetByName('Categories').getLastRow() === 1) seedRateBook(book);
  const blank = book.getSheetByName('Sheet1');
  if (blank && book.getSheets().length > 1 && blank.getLastRow() === 0) book.deleteSheet(blank);
  rootFolder();
  SpreadsheetApp.getUi().alert('Sheets are ready. Next: Estimator → "2. Add or reset a user".');
}

function addUserPrompt() {
  const ui = SpreadsheetApp.getUi();
  const e = ui.prompt('Add or reset a user', 'Email address:', ui.ButtonSet.OK_CANCEL);
  if (e.getSelectedButton() !== ui.Button.OK) return;
  const email = e.getResponseText().trim().toLowerCase();
  if (!email) return;
  const n = ui.prompt('Add or reset a user', 'Name (e.g. Romi):', ui.ButtonSet.OK_CANCEL);
  if (n.getSelectedButton() !== ui.Button.OK) return;
  const pw = ui.prompt('Add or reset a user', 'Password (at least 6 characters):', ui.ButtonSet.OK_CANCEL);
  if (pw.getSelectedButton() !== ui.Button.OK) return;
  const password = pw.getResponseText();
  if (password.length < 6) { ui.alert('Password must be at least 6 characters.'); return; }

  const sheet = sheetOf(TABS.users);
  const salt = Utilities.getUuid();
  const row = rowFor(TABS.users, { email: email, name: n.getResponseText().trim() || email, passwordHash: hashPassword(password, salt), salt: salt, active: true });
  const values = sheet.getDataRange().getValues();
  const E = headersOf(TABS.users).indexOf('email');
  for (let r = 1; r < values.length; r++) {
    if (String(values[r][E]).trim().toLowerCase() === email) {
      sheet.getRange(r + 1, 1, 1, row.length).setValues([row]);
      ui.alert('Password reset for ' + email + '.');
      return;
    }
  }
  sheet.appendRow(row);
  ui.alert('User ' + email + ' added. They can now sign in to the app.');
}

function removeUserPrompt() {
  const ui = SpreadsheetApp.getUi();
  const e = ui.prompt('Remove a user', 'Email address to remove:', ui.ButtonSet.OK_CANCEL);
  if (e.getSelectedButton() !== ui.Button.OK) return;
  const email = e.getResponseText().trim().toLowerCase();
  const sheet = sheetOf(TABS.users);
  const values = sheet.getDataRange().getValues();
  const E = headersOf(TABS.users).indexOf('email');
  for (let r = values.length - 1; r >= 1; r--) {
    if (String(values[r][E]).trim().toLowerCase() === email) sheet.deleteRow(r + 1);
  }
  ui.alert(email + ' removed. Their sessions end on their next request.');
}

function signOutAll() {
  const props = PropertiesService.getScriptProperties();
  Object.keys(props.getProperties()).forEach(k => { if (k.indexOf('sess_') === 0) props.deleteProperty(k); });
  SpreadsheetApp.getUi().alert('Everyone has been signed out.');
}

function seedRateBook(book) {
  clearCatalogCache();
  const c = seedCatalog();
  c.categories.forEach(cat => book.getSheetByName('Categories').appendRow(rowFor(TABS.categories, cat)));
  const rows = c.items.map(it => rowFor(TABS.items, Object.assign({}, it, { parentId: it.parentId === null ? '' : it.parentId })));
  book.getSheetByName('Items').getRange(2, 1, rows.length, rows[0].length).setValues(rows);
}

/** The starter rate book (mid-market Kolkata rates, 2026) as { categories, items }. */
function seedCatalog(raw) {
  const cats = ['Living Room', 'Dining', 'Kitchen', 'Master Bedroom', 'Bedroom 2', 'Bedroom 3', 'Bedroom 4',
    'Bathrooms', 'False Ceiling & Lighting', 'Painting & Finishes', 'Design & Services'];
  const categories = cats.map((c, i) => ({ id: i + 1, name: c, sortOrder: i + 1 }));

  // [category, name, description, unit, std, prem, lux, 1BHK, 2BHK, 3BHK, 4BHK, scalesWithArea]
  // A nested add-on is written as { under: <main item name>, item: [...] } right after its main item.
  const W = 'Sliding / hinged wardrobe up to the ceiling';
  const H = 'Upholstered / fluted headboard wall';
  const S = 'Wall-mounted desk with shelves';
  // loft quantities follow the wardrobe it sits on (Bedroom 2 from 2 BHK, Bedroom 3 from 3 BHK)
  const LQ = { 4: [0, 12, 14, 14], 5: [0, 12, 14, 14], 6: [0, 0, 14, 14] };
  const L = (cat) => ({ under: 'Wardrobe', item: [cat, 'Wardrobe Loft', 'Loft storage above the wardrobe', 'sqft', 900, 1200, 1700].concat(LQ[cat], [false]) });
  const seed = [
    [1, 'TV Unit', 'Feature TV wall with back-lit panelling', 'sqft', 950, 1300, 1800, 45, 55, 60, 70, false],
    { under: 'TV Unit', item: [1, 'Puja Unit', 'Puja niche with back-lit jali and drawers', 'sqft', 1200, 1650, 2300, 12, 14, 15, 18, false] },
    { under: 'TV Unit', item: [1, 'Crockery Display', 'Glass-fronted crockery display with profile lights', 'sqft', 1150, 1550, 2150, 15, 18, 20, 22, false] },
    { under: 'TV Unit', item: [1, 'Hidden Sliding Door', 'Concealed sliding door integrated in the panelling', 'nos', 0, 0, 0, 1, 1, 1, 1, false] },
    [1, 'Louver Wall Panelling', 'Fluted louvers on the feature / passage wall', 'sqft', 750, 1050, 1500, 30, 38, 43, 52, false],
    [1, 'Partition with Showpiece Sections', 'Open partition with display shelves', 'sqft', 950, 1300, 1850, 25, 32, 38, 45, false],
    [1, 'Sofa', 'Custom sofa', 'nos', 34000, 56000, 100000, 1, 1, 1, 1, false],
    { under: 'Sofa', item: [1, 'Ottomans (2 × 2)', 'Pair of matching ottomans', 'nos', 6000, 9000, 15000, 1, 1, 1, 1, false] },
    [1, 'Seating with Storage', 'Built-in seating with underneath storage', 'sqft', 850, 1150, 1650, 10, 12, 13, 15, false],
    [1, 'Foyer & Shoe Unit', 'Concealed shoe storage with seating ledge', 'sqft', 1050, 1400, 1950, 12, 15, 18, 20, false],
    [2, 'Crockery Unit', 'Glass-fronted crockery and storage unit', 'sqft', 1150, 1550, 2150, 18, 24, 28, 32, false],
    [2, 'Dining Table Set', 'Dining table with chairs', 'nos', 35000, 60000, 110000, 1, 1, 1, 1, false],
    [2, 'Bar / Coffee Counter', 'Compact counter with bottle and glass storage', 'sqft', 1200, 1650, 2300, 0, 0, 12, 15, false],
    [3, 'Modular Kitchen', 'Base and wall units with soft-close hardware', 'rft', 7500, 10500, 15500, 10, 12, 14, 16, false],
    { under: 'Modular Kitchen', item: [3, 'Tall Unit', 'Pantry / appliance tall unit', 'sqft', 1200, 1650, 2300, 0, 14, 16, 18, false] },
    { under: 'Modular Kitchen', item: [3, 'Countertop', 'Granite (Standard) · Quartz (Premium) · Solid surface (Luxury)', 'rft', 1200, 2200, 3800, 10, 12, 14, 16, false] },
    { under: 'Modular Kitchen', item: [3, 'Kitchen Dado', 'Backsplash tiles above the counter', 'sqft', 180, 320, 650, 30, 36, 42, 48, false] },
    [4, 'Wardrobe', W, 'sqft', 1100, 1500, 2100, 49, 56, 56, 63, false],
    L(4),
    [4, 'Bed with Hydraulic Storage', 'King size bed with hydraulic storage', 'nos', 38000, 62000, 105000, 1, 1, 1, 1, false],
    { under: 'Bed with Hydraulic Storage', item: [4, 'Bedside Tables (Pair)', 'Pair of bedside tables', 'nos', 12000, 20000, 35000, 1, 1, 1, 1, false] },
    [4, 'Dresser with Mirror', 'Dresser unit with mirror and drawers', 'sqft', 1150, 1550, 2150, 12, 14, 14, 16, false],
    [4, 'Headboard Wall Panelling', H, 'sqft', 650, 950, 1400, 40, 48, 48, 56, false],
    [4, 'Study / Work Desk', S, 'sqft', 1050, 1400, 1950, 0, 10, 12, 12, false],
    [5, 'Wardrobe', W, 'sqft', 1100, 1500, 2100, 0, 42, 49, 49, false],
    L(5),
    [5, 'Bed with Storage', 'Queen size bed with storage', 'nos', 32000, 52000, 88000, 0, 1, 1, 1, false],
    { under: 'Bed with Storage', item: [5, 'Bedside Tables (Pair)', 'Pair of bedside tables', 'nos', 10000, 17000, 30000, 0, 1, 1, 1, false] },
    [5, 'Headboard Wall Panelling', H, 'sqft', 650, 950, 1400, 0, 36, 40, 40, false],
    [5, 'Study / Work Desk', S, 'sqft', 1050, 1400, 1950, 0, 10, 10, 10, false],
    [6, 'Wardrobe', W, 'sqft', 1100, 1500, 2100, 0, 0, 42, 49, false],
    L(6),
    [6, 'Bed with Storage', 'Queen size bed with storage', 'nos', 32000, 52000, 88000, 0, 0, 1, 1, false],
    [6, 'Headboard Wall Panelling', H, 'sqft', 650, 950, 1400, 0, 0, 36, 40, false],
    [6, 'Study / Work Desk', S, 'sqft', 1050, 1400, 1950, 0, 0, 10, 10, false],
    [7, 'Wardrobe', W, 'sqft', 1100, 1500, 2100, 0, 0, 0, 42, false],
    [7, 'Bed with Storage', 'Queen size bed with storage', 'nos', 32000, 52000, 88000, 0, 0, 0, 1, false],
    [7, 'Headboard Wall Panelling', H, 'sqft', 650, 950, 1400, 0, 0, 0, 36, false],
    [8, 'Vanity Unit', 'Wall-hung vanity with storage', 'nos', 14000, 24000, 42000, 1, 2, 3, 3, false],
    { under: 'Vanity Unit', item: [8, 'Mirror Cabinet with Light', 'Mirror cabinet with back-lighting', 'nos', 6000, 11000, 20000, 1, 2, 3, 3, false] },
    [9, 'Gypsum False Ceiling', 'Minimalist gypsum ceiling with recesses', 'sqft', 115, 150, 220, 300, 520, 780, 1100, true],
    { under: 'Gypsum False Ceiling', item: [9, 'Cove / Profile Lighting', 'LED cove and profile light runs', 'rft', 180, 320, 550, 60, 100, 140, 190, true] },
    [9, 'Electrical Labour & Wiring', 'Rewiring, points and ceiling light wiring', 'sqft', 45, 65, 95, 450, 750, 1100, 1600, true],
    [9, 'Light Fixtures', 'Spot lights, panels and LED strips', 'sqft', 40, 85, 160, 450, 750, 1100, 1600, true],
    [10, 'Interior Painting', 'Putty, primer and two coats on walls & ceiling', 'sqft', 22, 35, 60, 1350, 2250, 3300, 4800, true],
    [10, 'Texture / Wallpaper Feature Wall', 'Texture paint or wallpaper on a feature wall', 'sqft', 120, 220, 400, 40, 60, 80, 100, false],
    [11, '3D Design & Visualisation', 'Photo-real 3D views and working drawings', 'sqft', 0, 0, 0, 1, 1, 1, 1, true],
    [11, 'Project Management & Supervision', 'Site supervision through to handover', 'sqft', 0, 0, 0, 1, 1, 1, 1, true],
    [11, 'Site Cleaning & Debris Removal', 'Cleaning and removing debris at handover', 'sqft', 0, 0, 0, 1, 1, 1, 1, true],
  ];

  const lastMain = {}; // `${cat}|${name}` → id
  const sortCount = {};
  const items = seed.map((entry, i) => {
    const nested = !Array.isArray(entry);
    const it = nested ? entry.item : entry;
    const id = i + 1;
    let parentId = null;
    if (nested) {
      parentId = lastMain[it[0] + '|' + entry.under];
      if (!parentId) throw new Error('Seed: no main item "' + entry.under + '" before "' + it[1] + '"');
    } else {
      lastMain[it[0] + '|' + it[1]] = id;
    }
    sortCount[it[0]] = (sortCount[it[0]] || 0) + 1;
    return {
      id: id, categoryId: it[0], parentId: parentId, name: it[1], description: it[2], unit: it[3],
      rateStandard: it[4], ratePremium: it[5], rateLuxury: it[6], qtyBhk1: it[7], qtyBhk2: it[8], qtyBhk3: it[9], qtyBhk4: it[10],
      scalesWithArea: it[11], active: true, sortOrder: sortCount[it[0]],
    };
  });
  return { categories: categories, items: raw ? items : items.map(toCarpetArea) };
}
