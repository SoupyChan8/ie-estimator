/**
 * Supabase link for the Interior Editors estimator.
 *
 * Add this as a second file in the same Apps Script project (next to Code.gs). It adds a "Supabase" menu
 * to the Sheet:
 *   1. Connect           – stores the project URL and secret key (in Script Properties, never in the app)
 *   2. Copy everything   – one-time move of the rate book, versions, contracts and staff names
 *   3. Nightly backup    – every night copies everything back into "Backup …" tabs in this Sheet.
 *                          The same run keeps the free Supabase project from pausing.
 */

function onOpenSupabase_(ui) {
  ui.createMenu('Supabase')
    .addItem('1. Connect', 'supabaseConnect')
    .addItem('2. Copy everything from this Sheet', 'supabaseCopyEverything')
    .addItem('3. Turn on nightly backup', 'supabaseInstallBackup')
    .addSeparator()
    .addItem('Back up now', 'supabaseBackup')
    .addToUi();
}

function supabaseConnect() {
  const ui = SpreadsheetApp.getUi();
  const props = PropertiesService.getScriptProperties();
  const u = ui.prompt('Supabase project URL', 'Looks like https://abcd1234.supabase.co', ui.ButtonSet.OK_CANCEL);
  if (u.getSelectedButton() !== ui.Button.OK) return;
  const k = ui.prompt('Supabase SECRET key', 'Project Settings → API Keys → Secret keys (sb_secret_…), or the legacy service_role key.\nIt stays in this script only.', ui.ButtonSet.OK_CANCEL);
  if (k.getSelectedButton() !== ui.Button.OK) return;
  props.setProperty('SUPABASE_URL', u.getResponseText().trim().replace(/\/+$/, ''));
  props.setProperty('SUPABASE_SECRET', k.getResponseText().trim());
  try {
    sbFetch_('GET', '/rest/v1/settings?select=key&limit=1');
    ui.alert('Connected to Supabase ✓');
  } catch (e) {
    ui.alert('Could not connect: ' + e.message + '\n\nCheck the URL and key, and that you ran schema.sql in the SQL Editor.');
  }
}

/* ───────────── HTTP ───────────── */

function sbFetch_(method, path, body, extraHeaders) {
  const props = PropertiesService.getScriptProperties();
  const base = props.getProperty('SUPABASE_URL');
  const key = props.getProperty('SUPABASE_SECRET');
  if (!base || !key) throw new Error('Run Supabase → 1. Connect first.');
  const headers = Object.assign({ apikey: key, 'Content-Type': 'application/json' }, extraHeaders || {});
  if (/^eyJ/.test(key)) headers.Authorization = 'Bearer ' + key; // legacy service_role JWT
  const res = UrlFetchApp.fetch(base + path, {
    method: method, headers: headers, muteHttpExceptions: true,
    payload: body === undefined ? undefined : JSON.stringify(body),
  });
  const code = res.getResponseCode();
  const text = res.getContentText();
  if (code >= 300) throw new Error(code + ' ' + text.slice(0, 300));
  return text ? JSON.parse(text) : null;
}

const sbUpsert_ = (table, rows) => {
  for (let i = 0; i < rows.length; i += 25) {
    sbFetch_('POST', '/rest/v1/' + table, rows.slice(i, i + 25), { Prefer: 'resolution=merge-duplicates,return=minimal' });
  }
};
const sbRpc_ = (fn, args) => sbFetch_('POST', '/rest/v1/rpc/' + fn, args || {});
const iso_ = v => (v instanceof Date ? v.toISOString() : v ? new Date(v).toISOString() : new Date().toISOString());

/* ───────────── one-time copy ───────────── */

function supabaseCopyEverything() {
  const ui = SpreadsheetApp.getUi();
  const ok = ui.alert('Copy everything to Supabase?',
    'This replaces the rate book in Supabase with the one in this Sheet and copies all versions, contracts and staff names. Safe to run again.',
    ui.ButtonSet.OK_CANCEL);
  if (ok !== ui.Button.OK) return;
  migrateCarpetArea();
  const props = PropertiesService.getScriptProperties();
  const counts = {};

  // rate book (ids kept, so saved versions and contracts still line up)
  clearCatalogCache();
  const catalog = getCatalog();
  sbRpc_('replace_rate_book', { book: catalog });
  counts.items = catalog.items.length;

  // saved versions
  versionsSheet();
  const versions = readTable(TABS.versions).map(v => {
    let data = null;
    try { data = versionData(v); } catch (e) { /* unreadable */ }
    if (!data) return null;
    return {
      id: Number(v.id), kind: String(v.kind), name: String(v.name), created_at: iso_(v.createdAt), updated_at: iso_(v.updatedAt || v.createdAt),
      created_by: String(v.createdBy || ''), summary: String(v.summary || ''), data: data, hash: null,
    };
  }).filter(Boolean);
  if (versions.length) sbUpsert_('versions', versions);
  counts.versions = versions.length;

  // contracts (signatures come across as images; older PDFs keep their Drive link)
  const contracts = readTable(TABS.contracts).map(c => {
    let lines = [];
    try { lines = JSON.parse(c.lineItemsJson || '[]'); } catch (e) { /* bad JSON */ }
    let opts = null;
    try { opts = c.pdfOptionsJson ? JSON.parse(c.pdfOptionsJson) : null; } catch (e) { /* bad JSON */ }
    return {
      id: Number(c.id), quotation_no: String(c.quotationNo), created_at: iso_(c.createdAt), created_by: String(c.createdBy || ''),
      client_name: String(c.clientName || ''), client_phone: String(c.clientPhone || ''), client_email: String(c.clientEmail || ''),
      site_address: String(c.siteAddress || ''), project_scope: String(c.projectScope || ''),
      bhk: Number(c.bhk) || 2, carpet_area: num(c.carpetArea), tier: TIERS.indexOf(c.tier) >= 0 ? c.tier : 'standard',
      total: num(c.total), designer_name: String(c.designerName || ''), line_items: lines,
      client_signature: pngDataUrl(c.clientSigFileId), designer_signature: pngDataUrl(c.designerSigFileId),
      pdf_path: '', pdf_url: String(c.pdfUrl || ''), pdf_options: opts,
    };
  });
  if (contracts.length) sbUpsert_('contracts', contracts);
  counts.contracts = contracts.length;

  // settings: staff names, default terms, version in use
  const settings = readTable(TABS.users).filter(u => u.email && u.name)
    .map(u => ({ key: 'name:' + String(u.email).trim().toLowerCase(), value: String(u.name) }));
  const def = props.getProperty('DEFAULT_TERMS_VERSION');
  if (def) settings.push({ key: 'default_terms_version', value: def });
  const active = props.getProperty('ACTIVE_RATEBOOK_VERSION');
  if (active) settings.push({ key: 'active_ratebook_version', value: active });
  if (settings.length) sbUpsert_('settings', settings);

  sbRpc_('sync_sequences');
  sbRpc_('set_next_quotation_no', { n: Number(props.getProperty('NEXT_QUOTE_NO') || 154) });

  ui.alert('Copied to Supabase ✓\n\n' + counts.items + ' rate book items\n' + counts.versions + ' saved versions\n' +
    counts.contracts + ' contracts\n' + settings.length + ' settings / staff names');
}

/* ───────────── nightly backup (also keeps the project awake) ───────────── */

function supabaseInstallBackup() {
  ScriptApp.getProjectTriggers().filter(t => t.getHandlerFunction() === 'supabaseBackup').forEach(t => ScriptApp.deleteTrigger(t));
  ScriptApp.newTrigger('supabaseBackup').timeBased().everyDays(1).atHour(2).create();
  supabaseBackup();
  SpreadsheetApp.getUi().alert('Nightly backup is on ✓\n\nEvery night around 2 AM everything is copied into the "Backup …" tabs. This also stops the free Supabase project from pausing.');
}

function supabaseBackup() {
  const book = ss();
  const stamp = Utilities.formatDate(new Date(), 'Asia/Kolkata', 'dd MMM yyyy, h:mm a');
  const tables = [
    ['categories', 'id,name,sort_order'],
    ['items', 'id,category_id,parent_id,name,description,unit,rate_standard,rate_premium,rate_luxury,qty_bhk1,qty_bhk2,qty_bhk3,qty_bhk4,scales_with_area,active,sort_order'],
    ['contracts', 'id,quotation_no,created_at,created_by,client_name,client_phone,client_email,site_address,project_scope,bhk,carpet_area,tier,total,designer_name,line_items,pdf_path,pdf_url,pdf_options'],
    ['versions', 'id,kind,name,created_at,updated_at,created_by,summary,hash,data'],
    ['settings', 'key,value'],
  ];
  tables.forEach(([table, cols]) => {
    const rows = sbFetch_('GET', '/rest/v1/' + table + '?select=' + cols + '&order=' + cols.split(',')[0]) || [];
    const head = cols.split(',');
    const values = [head].concat(rows.map(r => head.map(h => {
      const v = r[h];
      if (v === null || v === undefined) return '';
      const s = typeof v === 'object' ? JSON.stringify(v) : v;
      return typeof s === 'string' && s.length > 49000 ? s.slice(0, 49000) + '…(cut)' : s;
    })));
    const name = 'Backup ' + table;
    const sh = book.getSheetByName(name) || book.insertSheet(name);
    sh.clearContents();
    sh.getRange(1, 1, values.length, head.length).setValues(values);
    sh.getRange(1, 1, 1, head.length).setFontWeight('bold').setBackground('#dcd3c2');
    sh.setFrozenRows(1);
    sh.getRange(1, head.length + 2).setValue('Backed up ' + stamp);
  });
}
