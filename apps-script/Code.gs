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

const TABS = { categories: 'Categories', items: 'Items', contracts: 'Contracts', users: 'Users' };
const COLS = {
  Categories: ['id', 'name', 'sortOrder'],
  Items: ['id', 'categoryId', 'name', 'description', 'unit', 'rateStandard', 'ratePremium', 'rateLuxury',
    'qtyBhk1', 'qtyBhk2', 'qtyBhk3', 'qtyBhk4', 'scalesWithArea', 'active', 'sortOrder'],
  Contracts: ['id', 'quotationNo', 'createdAt', 'clientName', 'clientPhone', 'clientEmail', 'siteAddress',
    'projectScope', 'bhk', 'carpetArea', 'tier', 'total', 'designerName', 'createdBy', 'lineItemsJson',
    'clientSigFileId', 'designerSigFileId', 'pdfFileId', 'pdfUrl'],
  Users: ['email', 'name', 'passwordHash', 'salt', 'active'],
};
const SESSION_DAYS = 30;
const STUDIO_MINUTES = 30;
const UNITS = ['sqft', 'rft', 'nos', 'lumpsum'];
const TIERS = ['standard', 'premium', 'luxury'];

/* ───────────────────────── Web app entry points ───────────────────────── */

function doGet() {
  return json({ ok: true, service: 'Interior Editors Estimator API' });
}

function doPost(e) {
  try {
    const req = JSON.parse(e.postData.contents);
    const action = String(req.action || '');
    const p = req.payload || {};

    if (action === 'login') return json(login(p.email, p.password));

    const session = getSession(req.token);
    if (!session) return json({ error: 'Please sign in again.', code: 'auth' });

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
      case 'saveCategory': return json(withLock(() => saveCategory(p)));
      case 'deleteCategory': return json(withLock(() => deleteCategory(Number(p.id))));
      case 'saveItem': return json(withLock(() => saveItem(p)));
      case 'deleteItem': return json(withLock(() => deleteRowById(TABS.items, Number(p.id))));
      case 'savePdf': return json(withLock(() => savePdf(p)));
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
    for (let r = 1; r < rows.length; r++) {
      if (String(rows[r][0]).trim().toLowerCase() === session.email) {
        if (hashPassword(String(currentPassword || ''), rows[r][3]) !== rows[r][2]) return { error: 'Current password is wrong.' };
        const salt = Utilities.getUuid();
        sheet.getRange(r + 1, 3, 1, 2).setValues([[hashPassword(newPassword, salt), salt]]);
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

function rowFor(name, obj) {
  return COLS[name].map(c => (obj[c] === undefined || obj[c] === null ? '' : obj[c]));
}

function findRowIndex(name, id) {
  const ids = sheetOf(name).getRange(1, 1, sheetOf(name).getLastRow(), 1).getValues();
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

function getCatalog() {
  const categories = readTable(TABS.categories)
    .map(c => ({ id: Number(c.id), name: String(c.name), sortOrder: num(c.sortOrder) }))
    .sort((a, b) => a.sortOrder - b.sortOrder || a.id - b.id);
  const items = readTable(TABS.items)
    .map(i => ({
      id: Number(i.id), categoryId: Number(i.categoryId), name: String(i.name), description: String(i.description || ''),
      unit: UNITS.indexOf(i.unit) >= 0 ? i.unit : 'sqft',
      rateStandard: num(i.rateStandard), ratePremium: numOrNull(i.ratePremium), rateLuxury: numOrNull(i.rateLuxury),
      qtyBhk1: num(i.qtyBhk1), qtyBhk2: num(i.qtyBhk2), qtyBhk3: num(i.qtyBhk3), qtyBhk4: num(i.qtyBhk4),
      scalesWithArea: bool(i.scalesWithArea), active: i.active === '' ? true : bool(i.active), sortOrder: num(i.sortOrder),
    }))
    .sort((a, b) => a.sortOrder - b.sortOrder || a.id - b.id);
  return { categories: categories, items: items };
}

function saveCategory(p) {
  const name = String(p.name || '').trim();
  if (!name) throw new Error('Category name is required.');
  if (p.id) {
    const row = findRowIndex(TABS.categories, Number(p.id));
    if (row < 0) throw new Error('Category not found.');
    sheetOf(TABS.categories).getRange(row, 2).setValue(name);
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
  for (let r = values.length - 1; r >= 1; r--) if (Number(values[r][1]) === id) sheet.deleteRow(r + 1);
  return deleteRowById(TABS.categories, id);
}

function saveItem(p) {
  const name = String(p.name || '').trim();
  if (!name) throw new Error('Item name is required.');
  const item = {
    categoryId: Number(p.categoryId), name: name, description: String(p.description || '').trim(),
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
    const old = sheet.getRange(row, 1, 1, COLS.Items.length).getValues()[0];
    item.id = Number(p.id);
    item.sortOrder = old[COLS.Items.indexOf('sortOrder')];
    sheet.getRange(row, 1, 1, COLS.Items.length).setValues([rowFor(TABS.items, item)]);
    return { id: item.id };
  }
  item.id = nextId(TABS.items);
  item.sortOrder = readTable(TABS.items).filter(i => Number(i.categoryId) === item.categoryId)
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
  if (!(bhk >= 1 && bhk <= 4)) throw new Error('Invalid BHK.');
  const lines = (Array.isArray(p.lineItems) ? p.lineItems : []).slice(0, 300).map(l => {
    const qty = Math.max(0, num(l.qty));
    const rate = Math.max(0, num(l.rate));
    return {
      itemId: Number(l.itemId), categoryName: String(l.categoryName || '').slice(0, 200),
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
  return out;
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
  const pdfCol = COLS.Contracts.indexOf('pdfFileId') + 1;
  const oldId = sheet.getRange(row, pdfCol).getValue();
  if (oldId) { try { DriveApp.getFileById(oldId).setTrashed(true); } catch (e) { /* ignore */ } }
  const file = folder('PDF_FOLDER_ID', 'Quotations').createFile(blob);
  sheet.getRange(row, pdfCol, 1, 2).setValues([[file.getId(), file.getUrl()]]);
  return { url: file.getUrl() };
}

/* ───────────────────────── Sheet menu & setup ───────────────────────── */

function onOpen() {
  SpreadsheetApp.getUi()
    .createMenu('Estimator')
    .addItem('1. Set up sheets (first time only)', 'setupSheets')
    .addItem('2. Add or reset a user', 'addUserPrompt')
    .addItem('Remove a user', 'removeUserPrompt')
    .addItem('Sign everyone out', 'signOutAll')
    .addToUi();
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
      sh.getRange(1, 1, 1, COLS[name].length).setFontWeight('bold').setBackground('#e6dfd2');
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
  const row = [email, n.getResponseText().trim() || email, hashPassword(password, salt), salt, true];
  const values = sheet.getDataRange().getValues();
  for (let r = 1; r < values.length; r++) {
    if (String(values[r][0]).trim().toLowerCase() === email) {
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
  for (let r = values.length - 1; r >= 1; r--) {
    if (String(values[r][0]).trim().toLowerCase() === email) sheet.deleteRow(r + 1);
  }
  ui.alert(email + ' removed. Their sessions end on their next request.');
}

function signOutAll() {
  const props = PropertiesService.getScriptProperties();
  Object.keys(props.getProperties()).forEach(k => { if (k.indexOf('sess_') === 0) props.deleteProperty(k); });
  SpreadsheetApp.getUi().alert('Everyone has been signed out.');
}

function seedRateBook(book) {
  const cats = ['Living Room', 'Dining', 'Kitchen', 'Master Bedroom', 'Bedroom 2', 'Bedroom 3', 'Bedroom 4',
    'Bathrooms', 'False Ceiling & Lighting', 'Painting & Finishes', 'Design & Services'];
  book.getSheetByName('Categories').getRange(2, 1, cats.length, 3)
    .setValues(cats.map((c, i) => [i + 1, c, i + 1]));

  // [cat, name, description, unit, std, prem, lux, q1, q2, q3, q4, scales]
  const W = 'Sliding / hinged wardrobe, floor to loft';
  const H = 'Upholstered / fluted headboard wall';
  const S = 'Wall-mounted desk with shelves';
  const items = [
    [1, 'TV Unit with Puja & Crockery', 'Feature wall unit with puja niche, crockery display and back-lit panelling', 'sqft', 1150, 1550, 2150, 70, 85, 95, 110, false],
    [1, 'Louver Wall Panelling', 'Fluted louvers on the feature / passage wall', 'sqft', 750, 1050, 1500, 30, 38, 43, 52, false],
    [1, 'Partition with Showpiece Sections', 'Open partition with display shelves', 'sqft', 950, 1300, 1850, 25, 32, 38, 45, false],
    [1, 'Sofa with Ottomans', 'Custom sofa with 2 × 2 ottoman', 'nos', 40000, 65000, 115000, 1, 1, 1, 1, false],
    [1, 'Seating with Storage', 'Built-in seating with underneath storage', 'sqft', 850, 1150, 1650, 10, 12, 13, 15, false],
    [1, 'Foyer & Shoe Unit', 'Concealed shoe storage with seating ledge', 'sqft', 1050, 1400, 1950, 12, 15, 18, 20, false],
    [1, 'Hidden Sliding Door', 'Concealed sliding door integrated in panelling', 'lumpsum', 0, 0, 0, 1, 1, 1, 1, false],
    [2, 'Crockery Unit', 'Glass-fronted crockery and storage unit', 'sqft', 1150, 1550, 2150, 18, 24, 28, 32, false],
    [2, 'Dining Table Set', 'Dining table with chairs', 'nos', 35000, 60000, 110000, 1, 1, 1, 1, false],
    [2, 'Bar / Coffee Counter', 'Compact counter with bottle and glass storage', 'sqft', 1200, 1650, 2300, 0, 0, 12, 15, false],
    [3, 'Modular Kitchen – Base & Wall Units', 'Carcass, shutters and soft-close hardware', 'rft', 7500, 10500, 15500, 10, 12, 14, 16, false],
    [3, 'Tall Unit', 'Pantry / appliance tall unit', 'sqft', 1200, 1650, 2300, 0, 14, 16, 18, false],
    [3, 'Countertop', 'Granite (Standard) · Quartz (Premium) · Solid surface (Luxury)', 'rft', 1200, 2200, 3800, 10, 12, 14, 16, false],
    [3, 'Kitchen Dado', 'Backsplash tiles above the counter', 'sqft', 180, 320, 650, 30, 36, 42, 48, false],
    [4, 'Wardrobe', W, 'sqft', 1100, 1500, 2100, 49, 56, 56, 63, false],
    [4, 'Bed with Hydraulic Storage', 'King size bed with hydraulic storage', 'nos', 38000, 62000, 105000, 1, 1, 1, 1, false],
    [4, 'Bedside Tables (Pair)', 'Pair of bedside tables', 'nos', 12000, 20000, 35000, 1, 1, 1, 1, false],
    [4, 'Dresser with Mirror', 'Dresser unit with mirror and drawers', 'sqft', 1150, 1550, 2150, 12, 14, 14, 16, false],
    [4, 'Headboard Wall Panelling', H, 'sqft', 650, 950, 1400, 40, 48, 48, 56, false],
    [4, 'Study / Work Desk', S, 'sqft', 1050, 1400, 1950, 0, 10, 12, 12, false],
    [5, 'Wardrobe', W, 'sqft', 1100, 1500, 2100, 0, 42, 49, 49, false],
    [5, 'Bed with Storage', 'Queen size bed with storage', 'nos', 32000, 52000, 88000, 0, 1, 1, 1, false],
    [5, 'Bedside Tables (Pair)', 'Pair of bedside tables', 'nos', 10000, 17000, 30000, 0, 1, 1, 1, false],
    [5, 'Headboard Wall Panelling', H, 'sqft', 650, 950, 1400, 0, 36, 40, 40, false],
    [5, 'Study / Work Desk', S, 'sqft', 1050, 1400, 1950, 0, 10, 10, 10, false],
    [6, 'Wardrobe', W, 'sqft', 1100, 1500, 2100, 0, 0, 42, 49, false],
    [6, 'Bed with Storage', 'Queen size bed with storage', 'nos', 32000, 52000, 88000, 0, 0, 1, 1, false],
    [6, 'Headboard Wall Panelling', H, 'sqft', 650, 950, 1400, 0, 0, 36, 40, false],
    [6, 'Study / Work Desk', S, 'sqft', 1050, 1400, 1950, 0, 0, 10, 10, false],
    [7, 'Wardrobe', W, 'sqft', 1100, 1500, 2100, 0, 0, 0, 42, false],
    [7, 'Bed with Storage', 'Queen size bed with storage', 'nos', 32000, 52000, 88000, 0, 0, 0, 1, false],
    [7, 'Headboard Wall Panelling', H, 'sqft', 650, 950, 1400, 0, 0, 0, 36, false],
    [8, 'Vanity Unit', 'Wall-hung vanity with storage', 'nos', 14000, 24000, 42000, 1, 2, 3, 3, false],
    [8, 'Mirror Cabinet with Light', 'Mirror cabinet with back-lighting', 'nos', 6000, 11000, 20000, 1, 2, 3, 3, false],
    [9, 'Gypsum False Ceiling', 'Minimalist gypsum ceiling with recesses', 'sqft', 115, 150, 220, 300, 520, 780, 1100, true],
    [9, 'Cove / Profile Lighting', 'LED cove and profile light runs', 'rft', 180, 320, 550, 60, 100, 140, 190, true],
    [9, 'Electrical Labour & Wiring', 'Rewiring, points and ceiling light wiring', 'sqft', 45, 65, 95, 450, 750, 1100, 1600, true],
    [9, 'Light Fixtures', 'Spot lights, panels and LED strips', 'sqft', 40, 85, 160, 450, 750, 1100, 1600, true],
    [10, 'Interior Painting', 'Putty, primer and two coats on walls & ceiling', 'sqft', 22, 35, 60, 1350, 2250, 3300, 4800, true],
    [10, 'Texture / Wallpaper Feature Wall', 'Texture paint or wallpaper on a feature wall', 'sqft', 120, 220, 400, 40, 60, 80, 100, false],
    [11, '3D Design & Visualisation', 'Photo-real 3D views and working drawings', 'lumpsum', 0, 0, 0, 1, 1, 1, 1, false],
    [11, 'Project Management & Supervision', 'Site supervision through to handover', 'lumpsum', 0, 0, 0, 1, 1, 1, 1, false],
    [11, 'Site Cleaning & Debris Removal', 'Cleaning and removing debris at handover', 'lumpsum', 0, 0, 0, 1, 1, 1, 1, false],
  ];
  const sortCount = {};
  const rows = items.map((it, i) => {
    sortCount[it[0]] = (sortCount[it[0]] || 0) + 1;
    return [i + 1, it[0], it[1], it[2], it[3], it[4], it[5], it[6], it[7], it[8], it[9], it[10], it[11], true, sortCount[it[0]]];
  });
  book.getSheetByName('Items').getRange(2, 1, rows.length, rows[0].length).setValues(rows);
}
