// 輸出 PDF（Phase 31）：問卷列表 P 欄「輸出PDF」＝Google 文件範本 ID，送出後產生、登入頁補拿。
// 以 new Function 載入 Code.js 並 stub GAS 全域（比照 mySubmitStatus.test.js 的載入模式）。
// DocumentApp 用「一個 section 一段文字」的假文件模擬 replaceText／findText／insertText——
// 測得到兩輪替換的邏輯與位移，測不到真正的 Google 文件排版（那要實機驗證，見 plan.md Phase 31）。
// 守的紅線：
//   1. 舊 15 欄問卷列表不能因為多讀 P 欄就讓整站掛掉；P 欄不是範本 ID 就當沒設
//   2. 填寫者輸入的 {{…}} 不會被當成佔位符再換一次
//   3. PDF 產生失敗不擋送出；暫存文件不論成敗都丟垃圾桶
//   4. 登入頁取得走與登入相同的認證骨架；最新版就不重產
//   5. 連結不變：同名檔留最早建立的、覆蓋不蓋掉更新的送出、覆蓋不上全站鎖
//   6. 每人產生次數有上限（保護全系統共用的建立文件額度）
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { createHmac, createHash } from 'node:crypto';
import _ from 'lodash';

const source = readFileSync(new URL('../src/Code.js', import.meta.url), 'utf8');

const REFER = 'REFER_SHEET_ID';
const RECORD = 'RECORD_SHEET_ID';
// 範本 ID 要長得像 Drive ID（pdfTemplateOf_ 只認 25 字以上的 [-\w]）
const TEMPLATE = 'TEMPLATE_DOC_ID_0123456789abcdef';
const FOLDER = 'PDF_FOLDER_ID';
const PKEY = 'S001';
const PASSWORD = 'A123456789';
const DAY = 24 * 60 * 60 * 1000;

function toBuffer(data) {
  if (typeof data === 'string') return Buffer.from(data, 'utf8');
  return Buffer.from(data.map((b) => b & 0xff));
}

// 問卷結構（pos＝欄索引）：
// 0 uid 主鍵 P-T／1 pw 認證 A-T／2 name 輸出 O／3 cls 分組 G-G／4 memo 文字 F-T／
// 5 pick 多選 F-U／6 score 滑桿 F-L／7 doc 檔案 F-F／8 calc 計算 C-S
const referRows = [
  ['uid', 'pw', 'name', 'cls', 'memo', 'pick', 'score', 'doc', 'calc'],
  ['學號', '密碼', '姓名', '班級', '備註', '選項', '分數', '附件', '金額'],
  ['P', 'A', 'O', 'G', 'F', 'F', 'F', 'F', 'C'],
  ['T', 'T', '', 'G', 'T', 'U', 'L', 'F', 'S'],
  ['', '', '', '', '', '', '', '', ''],
  ['', '', '', '', '', '3::甲;乙;丙', '1;0;10', '', 'score:10'],
  ['', '', '', '', '', '', '', '', ''],
  ['', '', '', '', '', '', '', 'N', ''],
  [PKEY, PASSWORD, '王小明', '仙人掌班', '', '', '', '', ''],
];

function makeListRow({ cols = 16, template = TEMPLATE, signNames = '' } = {}) {
  const row = new Array(cols).fill('');
  row[0] = '測試問卷';
  row[1] = REFER;
  row[2] = RECORD;
  row[3] = Date.now() + 30 * DAY;
  row[4] = Date.now() + 60 * DAY;
  row[6] = signNames;
  row[11] = '是';
  row[12] = 'admin@example.com';
  row[13] = '是';
  if (cols > 15) row[15] = template;
  return row;
}

// 紀錄列：A 時間、B accept、C 主鍵、D 簽名、E 分組、F 起依 pos（pos+5）
function makeRecordRow(tick, { memo = '', pick = '', score = '', doc = '', signs = '' } = {}) {
  return [tick, true, PKEY, signs, '仙人掌班', '', '', '', '', memo, pick, score, doc, ''];
}

// 假 Google 文件：一個 section 就是一段文字（一個 Text 元素）。
// unreplaceable：模擬「佔位符被超連結等格式切開」——replaceText 比對不到這些字串
function makeSection(initialText, images, { unreplaceable = [] } = {}) {
  const state = { value: initialText, replaceCalls: 0 };
  const paragraph = {
    getChildIndex: () => 0,
    insertInlineImage: (index, blob) => {
      const image = {
        width: 600,
        height: 200,
        getWidth() {
          return this.width;
        },
        getHeight() {
          return this.height;
        },
        setWidth(w) {
          this.width = w;
          return this;
        },
        setHeight(h) {
          this.height = h;
          return this;
        },
      };
      images.push({ index, blob, image, textAtInsert: state.value });
      return image;
    },
  };
  const textEl = {
    getText: () => state.value,
    getParent: () => paragraph,
    insertText: (offset, text) => {
      // 真實 API 要求 offset 在文字範圍內；等於長度的情況程式應改走 appendText
      if (offset < 0 || offset >= state.value.length) throw new Error('offset out of range');
      state.value = state.value.slice(0, offset) + text + state.value.slice(offset);
    },
    appendText: (text) => {
      state.value += text;
    },
    deleteText: (start, end) => {
      state.value = state.value.slice(0, start) + state.value.slice(end + 1);
    },
  };
  return {
    state,
    getText: () => state.value,
    replaceText: (pattern, replacement) => {
      state.replaceCalls += 1;
      const re = new RegExp(pattern);
      if (unreplaceable.some((raw) => re.test(raw))) return;
      state.value = state.value.replace(new RegExp(pattern, 'g'), () => replacement);
    },
    findText: (pattern) => {
      const m = new RegExp(pattern).exec(state.value);
      if (m === null) return null;
      return {
        getElement: () => ({ asText: () => textEl }),
        getStartOffset: () => m.index,
        getEndOffsetInclusive: () => m.index + m[0].length - 1,
      };
    },
  };
}

function loadGas({
  listCols = 16,
  template = TEMPLATE,
  signNames = '',
  folderProp = FOLDER,
  props = {},
  recordRows = [],
  folderFiles = [],
  driveEnabled = true,
  templateUpdated = 1000,
  templateText = '',
  headerText = null,
  uuid = '00000000-0000-4000-8000-000000000001',
} = {}) {
  const store = {
    jwtSecret: 'unit-test-secret',
    draftEncSecret: 'unit-test-draft-secret',
    listSheetID: 'LIST_SHEET_ID',
    universalStorageID: 'STORAGE_FOLDER_ID',
    systemTitle: '測試系統',
    ...props,
  };
  if (folderProp !== '') store.pdfFolderID = folderProp;
  const listRow = makeListRow({ cols: listCols, template, signNames });
  const listHeader = new Array(listCols).fill('標題');
  const trace = {
    requestedListRanges: [],
    copies: [],
    trashedTemp: [],
    driveUpdates: [],
    images: [],
    savedText: null,
    lockWaits: 0,
    referOpens: 0,
  };

  const fakeSpreadsheetApp = {
    openById: (id) => {
      if (id === REFER) {
        trace.referOpens += 1;
        return { getSheets: () => [{ getDataRange: () => ({ getValues: () => referRows }) }] };
      }
      if (id === RECORD) {
        return {
          getSheets: () => [
            {
              appendRow: (row) => recordRows.push([...row]),
              getDataRange: () => ({ getValues: () => recordRows.map((r) => [...r]) }),
            },
          ],
        };
      }
      return {
        getSheets: () => [
          {
            getMaxColumns: () => listCols,
            getRange: (a1) => {
              trace.requestedListRanges.push(a1);
              return { getValues: () => [listHeader, listRow] };
            },
          },
        ],
      };
    },
  };

  const makeFile = (spec) => ({
    id: spec.id,
    name: spec.name,
    description: spec.description === undefined ? null : spec.description,
    created: spec.created || 1,
    updated: spec.updated || 1,
    trashed: spec.trashed === true,
    getId() {
      return this.id;
    },
    getName() {
      return this.name;
    },
    getUrl() {
      return 'https://drive.example/file/' + this.id;
    },
    getDescription() {
      return this.description;
    },
    setDescription(d) {
      this.description = d;
      return this;
    },
    getDateCreated() {
      return new Date(this.created);
    },
    getLastUpdated() {
      return new Date(this.updated);
    },
    isTrashed() {
      return this.trashed;
    },
    setTrashed(v) {
      this.trashed = v;
      return this;
    },
  });
  const files = folderFiles.map(makeFile);
  const iteratorOf = (list) => {
    let i = 0;
    return { hasNext: () => i < list.length, next: () => list[i++] };
  };

  let docSection = null;
  const fakeDriveApp = {
    getRootFolder: () => ({ root: true }),
    getFolderById: (id) => {
      if (id !== FOLDER) throw new Error('folder not found: ' + id);
      return {
        getFilesByName: (name) => iteratorOf(files.filter((f) => f.name === name)),
        getFiles: () => iteratorOf(files),
        createFile: (blob) => {
          const n = 5000 + files.length;
          const file = makeFile({ id: 'PDF_FILE_' + files.length, name: blob.getName(), created: n, updated: n });
          files.push(file);
          return file;
        },
      };
    },
    getFileById: (id) => {
      if (id === TEMPLATE) {
        return {
          getLastUpdated: () => new Date(templateUpdated),
          makeCopy: (name, folder) => {
            trace.copies.push({ name, folder });
            docSection = makeSection(templateText, trace.images);
            return {
              getId: () => 'TEMP_DOC',
              getAs: (mime) => ({
                getBytes: () => [...Buffer.from(mime + '|' + (trace.savedText ?? 'UNSAVED'), 'utf8')],
              }),
              setTrashed: (v) => trace.trashedTemp.push(v),
            };
          },
        };
      }
      if (id === 'MISSING_FILE') {
        throw new Error('找不到檔案');
      }
      return {
        getUrl: () => 'https://drive.example/file/' + id,
        getDateCreated: () => new Date(1),
        getBlob: () => ({ name: 'blob-' + id }),
      };
    },
  };
  const fakeDocumentApp = {
    openById: (id) => {
      if (id !== 'TEMP_DOC') throw new Error('doc not found');
      const header = headerText === null ? null : makeSection(headerText, trace.images);
      trace.header = header;
      return {
        getBody: () => docSection,
        getHeader: () => header,
        getFooter: () => null,
        saveAndClose: () => {
          trace.savedText = docSection.getText() + (header ? '||' + header.getText() : '');
        },
      };
    },
  };
  const fakeDrive = driveEnabled
    ? {
        Files: {
          update: (meta, id, blob, options) => {
            trace.driveUpdates.push({ meta, id, blob, options, lockHeld: trace.lockHeld === true });
            const file = files.find((f) => f.id === id);
            file.description = meta.description;
            file.updated += 1;
          },
        },
      }
    : undefined;
  const fakeUtilities = {
    computeHmacSha256Signature: (data, key) => {
      const digest = createHmac('sha256', key).update(data).digest();
      return [...digest].map((b) => (b > 127 ? b - 256 : b));
    },
    DigestAlgorithm: { SHA_256: 'sha256' },
    computeDigest: (alg, str) =>
      [...createHash(alg).update(str, 'utf8').digest()].map((b) => (b > 127 ? b - 256 : b)),
    base64EncodeWebSafe: (data) => toBuffer(data).toString('base64url'),
    base64DecodeWebSafe: (str) => [...Buffer.from(str, 'base64url')],
    base64Encode: (data) => toBuffer(data).toString('base64'),
    base64Decode: (str) => [...Buffer.from(str, 'base64')],
    newBlob: (bytes, type, name) => ({
      getBytes: () => bytes,
      getContentType: () => type,
      getName: () => name,
      getDataAsString: () => toBuffer(bytes).toString('utf8'),
    }),
    formatDate: (date, tz, fmt) => 'FMT[' + fmt + ']' + date.getTime(),
    getUuid: () => uuid,
  };
  const cacheMap = new Map();
  const factory = new Function(
    'LodashGS',
    'PropertiesService',
    'Utilities',
    'SpreadsheetApp',
    'DriveApp',
    'DocumentApp',
    'Drive',
    'LockService',
    'MailApp',
    'ScriptApp',
    'Session',
    'CacheService',
    `${source}\n;return {
      listValues_, getQList_, pdfTemplateOf_, pdfPlaceholders_, pdfMissingKeys_, pdfValueMap_,
      pdfDescription_, pdfTickOf_, pdfFileName_, getPdfNameSecret_, fillPdfDocument_, latestRecordRowsByPkey_,
      pdfGenDecision_, myRecordPdf_, writeRecord_, issueToken_, getHeaders
    };`
  );
  const gas = factory(
    { load: () => _ },
    {
      getScriptProperties: () => ({
        getProperty: (key) => (key in store ? store[key] : null),
        setProperty: (key, value) => {
          store[key] = value;
        },
      }),
    },
    fakeUtilities,
    fakeSpreadsheetApp,
    fakeDriveApp,
    fakeDocumentApp,
    fakeDrive,
    {
      getScriptLock: () => ({
        waitLock: () => {
          trace.lockWaits += 1;
          trace.lockHeld = true;
        },
        releaseLock: () => {
          trace.lockHeld = false;
        },
      }),
    },
    { getRemainingDailyQuota: () => 0, sendEmail: () => {} },
    { getService: () => ({ getUrl: () => 'https://script.example/exec' }) },
    {
      getActiveUser: () => ({ getEmail: () => '' }),
      getEffectiveUser: () => ({ getEmail: () => 'owner@example.com' }),
      getScriptTimeZone: () => 'Asia/Taipei',
    },
    {
      getScriptCache: () => ({
        get: (k) => (cacheMap.has(k) ? cacheMap.get(k) : null),
        put: (k, v) => cacheMap.set(k, String(v)),
        remove: (k) => cacheMap.delete(k),
      }),
    }
  );
  return { gas, store, trace, files, recordRows, listRow, cacheMap };
}

function authOf({ pkey = PKEY, pw = PASSWORD } = {}) {
  return [
    { id: 'uid', value: pkey },
    { id: 'pw', value: pw },
  ];
}

// pdfValueMap_ 用的 ctx：formatTick／formatDate／fileUrl 注入，讓純函數不碰 Utilities／DriveApp
function valueCtx(gas, overrides = {}) {
  return {
    headers: gas.getHeaders(REFER),
    recordRow: makeRecordRow(1700000000000),
    rosterRow: referRows[8],
    listRow: makeListRow(),
    pkey: PKEY,
    formatTick: (ms) => 'T' + ms,
    formatDate: (d) => 'D' + d.getTime(),
    fileUrl: (id) => 'URL:' + id,
    ...overrides,
  };
}

// 事先放進資料夾的檔：名字要用同一把 pdfNameSecret 算，所以先用 probe 生出密鑰再帶進去
function withExistingFiles(specsOf, options = {}) {
  const probe = loadGas();
  const name = probe.gas.pdfFileName_(REFER, RECORD, PKEY);
  const describe = (tick, updated = 1000) => probe.gas.pdfDescription_(tick, TEMPLATE, updated);
  const ctx = loadGas({
    ...options,
    props: { pdfNameSecret: probe.store.pdfNameSecret, ...(options.props || {}) },
    folderFiles: specsOf({ name, describe }),
  });
  return ctx;
}

describe('問卷列表 P 欄：舊 15 欄表不能讓整站掛掉', () => {
  it('listValues_ 依 getMaxColumns 決定讀 A:P 或 A:O', () => {
    const { gas } = loadGas();
    const ranges = [];
    const sheetOf = (cols) => ({
      getMaxColumns: () => cols,
      getRange: (a1) => {
        ranges.push(a1);
        return { getValues: () => [] };
      },
    });
    gas.listValues_(sheetOf(16));
    gas.listValues_(sheetOf(15));
    expect(ranges).toEqual(['A:P', 'A:O']);
  });

  it('pdfTemplateOf_：只認長得像 Drive ID 的值；備註文字、舊 15 欄表都當沒設', () => {
    const { gas } = loadGas();
    const rowWith = (value) => {
      const row = new Array(16).fill('');
      row[15] = value;
      return row;
    };
    expect(gas.pdfTemplateOf_(rowWith('  ' + TEMPLATE + '  '))).toBe(TEMPLATE);
    expect(gas.pdfTemplateOf_(rowWith('負責人王老師'))).toBe('');
    expect(gas.pdfTemplateOf_(rowWith('否'))).toBe('');
    expect(gas.pdfTemplateOf_(rowWith('https://docs.google.com/document/d/' + TEMPLATE + '/edit'))).toBe('');
    expect(gas.pdfTemplateOf_(new Array(15).fill('x'))).toBe('');
    expect(gas.pdfTemplateOf_(null)).toBe('');
  });

  it('getQList_ 的 pdfEnabled：16 欄且 P 是範本 ID 才是 true；舊 15 欄表照常回清單', () => {
    expect(loadGas({ listCols: 16 }).gas.getQList_()[0].pdfEnabled).toBe(true);
    expect(loadGas({ listCols: 16, template: '' }).gas.getQList_()[0].pdfEnabled).toBe(false);
    expect(loadGas({ listCols: 16, template: '這欄先放備註' }).gas.getQList_()[0].pdfEnabled).toBe(false);
    const narrow = loadGas({ listCols: 15 });
    const list = narrow.gas.getQList_();
    expect(list).toHaveLength(1);
    expect(list[0].pdfEnabled).toBe(false);
    expect(narrow.trace.requestedListRanges).toEqual(['A:O']);
  });
});

describe('純函數：佔位符與值', () => {
  it('pdfPlaceholders_ 抽出 {{…}}：去重、key 去空白、全形冒號視同半形、不跨行', () => {
    const { gas } = loadGas();
    const found = gas.pdfPlaceholders_('A{{uid}}B{{ name }}C{{uid}}D{{簽名：家長}}E{{}}F{{壞\n掉}}');
    expect(found).toEqual([
      { raw: '{{uid}}', key: 'uid' },
      { raw: '{{ name }}', key: 'name' },
      { raw: '{{簽名：家長}}', key: '簽名:家長' },
    ]);
  });

  it('pdfValueMap_：填寫欄取紀錄列、名冊欄取名冊列、主鍵取伺服器值；C-S 不進對照', () => {
    const { gas } = loadGas();
    const map = gas.pdfValueMap_(
      valueCtx(gas, {
        recordRow: makeRecordRow(1700000000000, { memo: '備註文字', pick: '甲;丙', score: '📝7', doc: 'F1;F2' }),
      })
    );
    expect(map.uid).toEqual({ text: PKEY });
    expect(map.pw).toEqual({ text: PASSWORD });
    expect(map.name).toEqual({ text: '王小明' });
    expect(map.cls).toEqual({ text: '仙人掌班' });
    expect(map.memo).toEqual({ text: '備註文字' });
    expect(map.pick).toEqual({ text: '甲、丙' });
    expect(map.score).toEqual({ text: '7' });
    // 檔案欄的連結交給注入的 fileUrl（實際是 DriveApp 的 getUrl，不自己拼網址）
    expect(map.doc).toEqual({ text: 'URL:F1 URL:F2' });
    expect('calc' in map).toBe(false);
    expect(map['送出時間']).toEqual({ text: 'T1700000000000' });
    expect(map['問卷名稱']).toEqual({ text: '測試問卷' });
  });

  it('「不提供資料」「無資料」照原樣印，不被當成檔案 ID 或多選拆開', () => {
    const { gas } = loadGas();
    const map = gas.pdfValueMap_(
      valueCtx(gas, { recordRow: makeRecordRow(1, { doc: '不提供資料', pick: '無資料' }) })
    );
    expect(map.doc).toEqual({ text: '不提供資料' });
    expect(map.pick).toEqual({ text: '無資料' });
  });

  it('簽名：依 G 欄格名順序對 D 欄 fileID，空格名跳過、沒簽的是空字串', () => {
    const { gas } = loadGas();
    const map = gas.pdfValueMap_(
      valueCtx(gas, {
        listRow: makeListRow({ signNames: '導師;;家長;校長' }),
        recordRow: makeRecordRow(1, { signs: 'SIGN_T;;SIGN_P' }),
      })
    );
    expect(map['簽名:導師']).toEqual({ signFileId: 'SIGN_T' });
    expect(map['簽名:家長']).toEqual({ signFileId: 'SIGN_P' });
    expect(map['簽名:校長']).toEqual({ text: '' });
    expect('簽名:' in map).toBe(false);
  });

  it('欄位 ID 與系統鍵撞名時欄位優先', () => {
    const { gas } = loadGas();
    const headers = gas.getHeaders(REFER).map((h) => (h.id === 'memo' ? { ...h, id: '送出時間' } : h));
    const map = gas.pdfValueMap_(valueCtx(gas, { headers, recordRow: makeRecordRow(1, { memo: '欄位值' }) }));
    expect(map['送出時間']).toEqual({ text: '欄位值' });
  });

  it('pdfMissingKeys_ 回對不到值的 key（去重）', () => {
    const { gas } = loadGas();
    const map = gas.pdfValueMap_(valueCtx(gas));
    const phs = gas.pdfPlaceholders_('{{uid}}{{calc}}{{typo}}{{ calc }}');
    expect(gas.pdfMissingKeys_(phs, map)).toEqual(['calc', 'typo']);
  });

  it('pdfFileName_：同輸入同名、換人或換紀錄表就不同；檔名不含主鍵、只有 base64url 字元；可傳入先讀好的密鑰', () => {
    const { gas, store } = loadGas();
    const name = gas.pdfFileName_(REFER, RECORD, PKEY);
    expect(name).toBe(gas.pdfFileName_(REFER, RECORD, PKEY));
    expect(name).toBe(gas.pdfFileName_(REFER, RECORD, PKEY, store.pdfNameSecret));
    expect(name).not.toBe(gas.pdfFileName_(REFER, RECORD, 'S002'));
    expect(name).not.toBe(gas.pdfFileName_(REFER, 'OTHER_RECORD', PKEY));
    expect(name).toMatch(/^[A-Za-z0-9_-]+\.pdf$/);
    expect(name).not.toContain(PKEY);
  });

  it('pdfNameSecret 第一次自動生成並保存，之後沿用同一把', () => {
    const { gas, store } = loadGas();
    expect(store.pdfNameSecret).toBeUndefined();
    const first = gas.getPdfNameSecret_();
    expect(first).toMatch(/^[0-9a-f]{64}$/);
    expect(store.pdfNameSecret).toBe(first);
    expect(gas.getPdfNameSecret_()).toBe(first);
  });

  it('pdfTickOf_ 從 description 取回送出時間；不是本系統寫的回 NaN', () => {
    const { gas } = loadGas();
    expect(gas.pdfTickOf_(gas.pdfDescription_(1783627864298, TEMPLATE, 5))).toBe(1783627864298);
    expect(gas.pdfTickOf_('管理者自己寫的說明')).toBeNaN();
    expect(gas.pdfTickOf_(null)).toBeNaN();
  });

  it('pdfGenDecision_：窗口內計數、滿了擋下並給剩餘時間、窗口過了重新計', () => {
    const { gas } = loadGas();
    const W = 60000;
    expect(gas.pdfGenDecision_(null, 1000, 2, W)).toEqual({ allowed: true, next: { count: 1, since: 1000 }, retryMs: 0 });
    expect(gas.pdfGenDecision_({ count: 1, since: 1000 }, 2000, 2, W)).toEqual({
      allowed: true,
      next: { count: 2, since: 1000 },
      retryMs: 0,
    });
    const blocked = gas.pdfGenDecision_({ count: 2, since: 1000 }, 31000, 2, W);
    expect(blocked.allowed).toBe(false);
    expect(blocked.retryMs).toBe(30000);
    expect(gas.pdfGenDecision_({ count: 2, since: 1000 }, 61000, 2, W).next).toEqual({ count: 1, since: 61000 });
    expect(gas.pdfGenDecision_({ garbage: true }, 5, 2, W).allowed).toBe(true);
  });

  it('latestRecordRowsByPkey_：每個主鍵取最後一列，A 欄不是數字的標題列跳過', () => {
    const { gas } = loadGas();
    const rows = [
      ['送出時間', '有效', '主鍵'],
      [1000, true, PKEY],
      [2000, true, 'S002'],
      [3000, true, PKEY],
    ];
    const latest = gas.latestRecordRowsByPkey_(rows);
    expect(Object.keys(latest).sort()).toEqual(['S001', 'S002']);
    expect(latest[PKEY][0]).toBe(3000);
  });
});

describe('fillPdfDocument_：兩輪替換', () => {
  // 直接組假 doc 呼叫 fillPdfDocument_；回傳值＝PDF 上會原樣留下的 key
  function fillText(text, map, { headerText = null, unreplaceable = [] } = {}) {
    const images = [];
    const body = makeSection(text, images, { unreplaceable });
    const header = headerText === null ? null : makeSection(headerText, images);
    const { gas } = loadGas();
    const doc = { getBody: () => body, getHeader: () => header, getFooter: () => null };
    const leftover = gas.fillPdfDocument_(doc, map);
    return { body: body.getText(), header: header ? header.getText() : null, leftover, images, bodySection: body, headerSection: header };
  }

  it('佔位符換成值、位置正確；內文與頁首都換', () => {
    const result = fillText(
      '姓名：{{name}}，班級：{{cls}}。',
      { name: { text: '王小明' }, cls: { text: '仙人掌班' } },
      { headerText: '{{cls}} 報名表' }
    );
    expect(result.body).toBe('姓名：王小明，班級：仙人掌班。');
    expect(result.header).toBe('仙人掌班 報名表');
    expect(result.leftover).toEqual([]);
  });

  it('只對文字裡有這個佔位符的區段呼叫替換（每次都是遠端呼叫）', () => {
    const result = fillText('{{name}}{{memo}}', { name: { text: 'A' }, memo: { text: 'B' }, cls: { text: 'C' } }, {
      headerText: '{{cls}}',
    });
    expect(result.body).toBe('AB');
    expect(result.header).toBe('C');
    expect(result.bodySection.state.replaceCalls).toBe(2);
    expect(result.headerSection.state.replaceCalls).toBe(1);
  });

  it('填寫者在欄位裡打 {{uid}}：照原樣印出，不被當成佔位符換成主鍵', () => {
    const result = fillText('備註：{{memo}}／學號：{{uid}}', {
      memo: { text: '請看 {{uid}} 這欄' },
      uid: { text: PKEY },
    });
    expect(result.body).toBe('備註：請看 {{uid}} 這欄／學號：' + PKEY);
  });

  it('值裡的 $ 與反斜線照字面印（不走 replaceText 的替換字串）', () => {
    const result = fillText('{{memo}}', { memo: { text: 'NT$100 $1 $& \\n' } });
    expect(result.body).toBe('NT$100 $1 $& \\n');
  });

  it('記號在文字結尾（走 appendText）、值為空字串（只刪記號）都正確', () => {
    expect(fillText('結尾{{memo}}', { memo: { text: '值' } }).body).toBe('結尾值');
    expect(fillText('A{{memo}}B', { memo: { text: '' } }).body).toBe('AB');
  });

  it('對不到值的佔位符原樣保留並回報', () => {
    const result = fillText('{{uid}}／{{calc}}／{{typo}}', { uid: { text: PKEY } });
    expect(result.body).toBe(PKEY + '／{{calc}}／{{typo}}');
    expect(result.leftover).toEqual(['calc', 'typo']);
  });

  it('佔位符被格式切開、replaceText 換不到：原樣留下，也要回報（不能默默失敗）', () => {
    const result = fillText('{{name}}／{{cls}}', { name: { text: '王小明' }, cls: { text: '仙人掌班' } }, {
      unreplaceable: ['{{cls}}'],
    });
    expect(result.body).toBe('王小明／{{cls}}');
    expect(result.leftover).toEqual(['cls']);
  });

  it('同一個佔位符出現多次全部換掉', () => {
    expect(fillText('{{uid}}-{{uid}}-{{ uid }}', { uid: { text: 'X' } }).body).toBe('X-X-X');
  });

  it('簽名：記號在段首插在前面（index 0）、其他位置插在後面（index 1）；寬度縮到 180 等比例', () => {
    const atStart = fillText('{{簽名:家長}}', { '簽名:家長': { signFileId: 'SIGN_P' } });
    expect(atStart.body).toBe('');
    expect(atStart.images).toHaveLength(1);
    expect(atStart.images[0].index).toBe(0);
    expect(atStart.images[0].image.getWidth()).toBe(180);
    expect(atStart.images[0].image.getHeight()).toBe(60);
    const inMiddle = fillText('家長簽名：{{簽名:家長}}', { '簽名:家長': { signFileId: 'SIGN_P' } });
    expect(inMiddle.body).toBe('家長簽名：');
    expect(inMiddle.images[0].index).toBe(1);
  });
});

describe('writeRecord_：送出後產生 PDF', () => {
  const TEMPLATE_TEXT =
    '{{問卷名稱}}｜{{uid}}｜{{name}}｜{{cls}}｜{{memo}}｜{{pick}}｜{{score}}｜{{calc}}｜{{送出時間}}';

  function submit(ctx) {
    const token = ctx.gas.issueToken_(REFER, PKEY, Date.now());
    return ctx.gas.writeRecord_(
      REFER,
      RECORD,
      token,
      [
        { id: 'memo', value: '請看 {{uid}}' },
        { id: 'pick', value: '甲;丙' },
        { id: 'score', value: 5 },
      ],
      true,
      [],
      ''
    );
  }

  it('第一次送出：建新 PDF、回 Drive 給的連結、description 記送出時間與範本版本、暫存文件丟垃圾桶', () => {
    const ctx = loadGas({ templateText: TEMPLATE_TEXT });
    const report = submit(ctx);
    expect(report.status).toBe(true);
    expect(report.pdfError).toBe(false);
    expect(report.pdfThrottled).toBe(null);
    expect(ctx.recordRows).toHaveLength(1);
    expect(ctx.files).toHaveLength(1);
    const file = ctx.files[0];
    expect(report.pdf).toEqual({ url: file.getUrl() });
    expect(file.name).toBe(ctx.gas.pdfFileName_(REFER, RECORD, PKEY));
    expect(file.description).toBe(ctx.gas.pdfDescription_(report.tick, TEMPLATE, 1000));
    // 暫存文件：建在根目錄（不進分享資料夾）、用完丟垃圾桶
    expect(ctx.trace.copies).toHaveLength(1);
    expect(ctx.trace.copies[0].folder).toEqual({ root: true });
    expect(ctx.trace.trashedTemp).toEqual([true]);
    // 存檔後才轉 PDF，內容是換好的
    expect(ctx.trace.savedText).toBe(
      '測試問卷｜S001｜王小明｜仙人掌班｜請看 {{uid}}｜甲、丙｜5｜{{calc}}｜FMT[yyyy/MM/dd HH:mm:ss]' + report.tick
    );
  });

  it('重新送出：覆蓋同一個檔（帶 supportsAllDrives）、連結不變，而且覆蓋時不佔全站鎖', () => {
    const ctx = loadGas({ templateText: TEMPLATE_TEXT });
    const first = submit(ctx);
    ctx.trace.lockWaits = 0;
    const second = submit(ctx);
    expect(ctx.files).toHaveLength(1);
    expect(second.pdf).toEqual(first.pdf);
    expect(ctx.trace.driveUpdates).toHaveLength(1);
    expect(ctx.trace.driveUpdates[0].id).toBe(ctx.files[0].id);
    expect(ctx.trace.driveUpdates[0].options).toEqual({ supportsAllDrives: true });
    expect(ctx.trace.driveUpdates[0].lockHeld).toBe(false);
    expect(ctx.trace.lockWaits).toBe(0);
    expect(ctx.files[0].description).toBe(ctx.gas.pdfDescription_(second.tick, TEMPLATE, 1000));
  });

  it('沒設 pdfFolderID：紀錄照樣寫入、pdfError=true、不建暫存文件', () => {
    const ctx = loadGas({ templateText: TEMPLATE_TEXT, folderProp: '' });
    const report = submit(ctx);
    expect(report.status).toBe(true);
    expect(report.pdf).toBe(null);
    expect(report.pdfError).toBe(true);
    expect(ctx.recordRows).toHaveLength(1);
    expect(ctx.trace.copies).toHaveLength(0);
  });

  it('沒啟用進階 Drive 服務：一開始就擋下，不白做複製範本（不浪費建立文件額度），也不擋送出', () => {
    const ctx = loadGas({ templateText: TEMPLATE_TEXT, driveEnabled: false });
    const report = submit(ctx);
    expect(report.status).toBe(true);
    expect(report.pdfError).toBe(true);
    expect(ctx.recordRows).toHaveLength(1);
    expect(ctx.trace.copies).toHaveLength(0);
    expect(ctx.files).toHaveLength(0);
  });

  it('P 欄沒設、是備註文字、或舊 15 欄表：完全不碰 PDF', () => {
    for (const opts of [{ template: '' }, { template: '王老師負責' }, { listCols: 15 }]) {
      const ctx = loadGas({ templateText: TEMPLATE_TEXT, ...opts });
      const report = submit(ctx);
      expect(report.status).toBe(true);
      expect(report.pdf).toBe(null);
      expect(report.pdfError).toBe(false);
      expect(ctx.trace.copies).toHaveLength(0);
    }
  });

  it('產生次數超過上限：紀錄照樣寫入，這次不產生、回 pdfThrottled（不複製範本）', () => {
    const ctx = loadGas({ templateText: TEMPLATE_TEXT, props: { pdfGenMax: '2', pdfGenWindowMinutes: '30' } });
    submit(ctx);
    submit(ctx);
    const third = submit(ctx);
    expect(third.status).toBe(true);
    expect(ctx.recordRows).toHaveLength(3);
    expect(third.pdf).toBe(null);
    expect(third.pdfError).toBe(true);
    expect(third.pdfThrottled.retryMinutes).toBeGreaterThan(0);
    expect(third.pdfThrottled.retryMinutes).toBeLessThanOrEqual(30);
    expect(ctx.trace.copies).toHaveLength(2);
  });
});

describe('myRecordPdf_：登入頁取得我的 PDF', () => {
  const TEMPLATE_TEXT = '{{name}} {{memo}}';

  it('認證失敗回 false（與登入同一套骨架），不碰 Drive', () => {
    const ctx = loadGas({ templateText: TEMPLATE_TEXT, recordRows: [makeRecordRow(1000)] });
    expect(ctx.gas.myRecordPdf_(REFER, RECORD, authOf({ pw: 'WRONG' }))).toBe(false);
    expect(ctx.trace.copies).toHaveLength(0);
  });

  it('P 欄空或舊 15 欄表 → {pdfDisabled}', () => {
    expect(loadGas({ template: '' }).gas.myRecordPdf_(REFER, RECORD, authOf())).toEqual({ pdfDisabled: true });
    expect(loadGas({ listCols: 15 }).gas.myRecordPdf_(REFER, RECORD, authOf())).toEqual({ pdfDisabled: true });
  });

  it('沒送出過 → {noRecord}', () => {
    expect(loadGas().gas.myRecordPdf_(REFER, RECORD, authOf())).toEqual({ noRecord: true });
  });

  it('名冊只讀一次就完成驗證骨架以外的查詢（原本一次呼叫讀 9～10 遍）', () => {
    const ctx = loadGas({ recordRows: [makeRecordRow(1000)], folderProp: '' });
    ctx.gas.myRecordPdf_(REFER, RECORD, authOf());
    // draftKey_ 1 ＋ authRecord 3（與 readRecord_ 共用、未動）＋ 骨架讀名冊 1
    expect(ctx.trace.referOpens).toBeLessThanOrEqual(5);
  });

  it('現有檔是最新版 → 直接回 Drive 給的連結、不重產', () => {
    const ctx = withExistingFiles(({ name, describe }) => [{ id: 'EXISTING', name, description: describe(2000) }], {
      templateText: TEMPLATE_TEXT,
      recordRows: [makeRecordRow(1000), makeRecordRow(2000)],
    });
    expect(ctx.gas.myRecordPdf_(REFER, RECORD, authOf())).toEqual({
      url: 'https://drive.example/file/EXISTING',
      lastTick: 2000,
      generated: false,
    });
    expect(ctx.trace.copies).toHaveLength(0);
  });

  it('範本改過（或送出時間對不上）→ 用最後一筆紀錄重產並覆蓋同一檔', () => {
    const ctx = withExistingFiles(({ name, describe }) => [{ id: 'EXISTING', name, description: describe(2000) }], {
      templateText: TEMPLATE_TEXT,
      templateUpdated: 9999,
      recordRows: [makeRecordRow(2000, { memo: '最新備註' })],
    });
    const result = ctx.gas.myRecordPdf_(REFER, RECORD, authOf());
    expect(result).toEqual({ url: 'https://drive.example/file/EXISTING', lastTick: 2000, generated: true });
    expect(ctx.trace.driveUpdates).toHaveLength(1);
    expect(ctx.files[0].description).toBe(ctx.gas.pdfDescription_(2000, TEMPLATE, 9999));
    expect(ctx.trace.savedText).toBe('王小明 最新備註');
  });

  it('現有檔已經是更新的送出（比較慢的舊版產生晚到）→ 不覆蓋', () => {
    const ctx = withExistingFiles(({ name, describe }) => [{ id: 'EXISTING', name, description: describe(3000) }], {
      templateText: TEMPLATE_TEXT,
      recordRows: [makeRecordRow(2000)],
    });
    const result = ctx.gas.myRecordPdf_(REFER, RECORD, authOf());
    expect(result.url).toBe('https://drive.example/file/EXISTING');
    expect(ctx.trace.driveUpdates).toHaveLength(0);
    expect(ctx.files[0].description).toBe(ctx.gas.pdfDescription_(3000, TEMPLATE, 1000));
  });

  it('功能中途才開啟（有紀錄沒檔）→ 產生新檔', () => {
    const ctx = loadGas({ templateText: TEMPLATE_TEXT, recordRows: [makeRecordRow(2000, { memo: 'x' })] });
    const result = ctx.gas.myRecordPdf_(REFER, RECORD, authOf());
    expect(result.generated).toBe(true);
    expect(ctx.files).toHaveLength(1);
    expect(result.url).toBe(ctx.files[0].getUrl());
  });

  it('同名檔有兩個（競態留下的）：沿用最早建立的（它的連結最早發出去），重產時覆蓋它、丟掉晚建的', () => {
    const ctx = withExistingFiles(
      ({ name, describe }) => [
        { id: 'NEWER', name, description: describe(1000), created: 20, updated: 30 },
        { id: 'OLDER', name, description: describe(1000), created: 10, updated: 11 },
        { id: 'TRASHED', name, description: describe(1000), created: 1, trashed: true },
      ],
      { templateText: TEMPLATE_TEXT, recordRows: [makeRecordRow(2000)] }
    );
    const result = ctx.gas.myRecordPdf_(REFER, RECORD, authOf());
    expect(result.url).toBe('https://drive.example/file/OLDER');
    expect(ctx.trace.driveUpdates.map((u) => u.id)).toEqual(['OLDER']);
    expect(ctx.files.find((f) => f.id === 'NEWER').trashed).toBe(true);
    expect(ctx.files.find((f) => f.id === 'OLDER').trashed).toBe(false);
  });

  it('產生次數超過上限 → {pdfThrottled, retryMinutes}；已是最新版的取得不算次數', () => {
    const ctx = loadGas({
      templateText: TEMPLATE_TEXT,
      templateUpdated: 1000,
      recordRows: [makeRecordRow(2000)],
      props: { pdfGenMax: '1' },
    });
    expect(ctx.gas.myRecordPdf_(REFER, RECORD, authOf()).generated).toBe(true);
    // 同一版再取：沿用，不算產生
    expect(ctx.gas.myRecordPdf_(REFER, RECORD, authOf()).generated).toBe(false);
    // 有新的送出 → 需要重產，但額度用完
    ctx.recordRows.push(makeRecordRow(3000));
    const throttled = ctx.gas.myRecordPdf_(REFER, RECORD, authOf());
    expect(throttled.pdfThrottled).toBe(true);
    expect(throttled.retryMinutes).toBeGreaterThan(0);
    expect(ctx.trace.copies).toHaveLength(1);
  });

  it('範本檔案欄的連結走 Drive 的 getUrl；檔案不見時印提示、整份 PDF 照樣產生', () => {
    const ctx = loadGas({
      templateText: '{{doc}}',
      recordRows: [makeRecordRow(2000, { doc: 'UPLOADED;MISSING_FILE' })],
    });
    expect(ctx.gas.myRecordPdf_(REFER, RECORD, authOf()).generated).toBe(true);
    expect(ctx.trace.savedText).toBe('https://drive.example/file/UPLOADED （找不到檔案）');
  });

  it('沒設 pdfFolderID → {failed}（不丟例外給前端）', () => {
    const ctx = loadGas({ folderProp: '', recordRows: [makeRecordRow(2000)] });
    expect(ctx.gas.myRecordPdf_(REFER, RECORD, authOf())).toEqual({ failed: true });
  });
});

describe('tools/export.js 的範本檢查（與 Code.js 同規則）', () => {
  const toolSource = readFileSync(new URL('../tools/export.js', import.meta.url), 'utf8');

  function loadTool(docText) {
    const factory = new Function(
      'LodashGS',
      'SpreadsheetApp',
      'PropertiesService',
      'DocumentApp',
      `${toolSource}\n;return { pdfPlaceholderKeys_, checkPdfTemplate_, checkListRow_ };`
    );
    return factory(
      { load: () => _ },
      {
        getUi: () => {
          throw new Error('no ui in tests');
        },
      },
      { getScriptProperties: () => ({ getProperty: () => null }) },
      {
        openById: (id) => {
          if (id !== 'T'.repeat(30)) throw new Error('找不到文件');
          return {
            getBody: () => ({ getText: () => docText }),
            getHeader: () => null,
            getFooter: () => null,
          };
        },
      }
    );
  }

  const referSS = { getSheets: () => [{ getDataRange: () => ({ getValues: () => referRows }) }] };
  function listRow(template, signNames = '家長') {
    const row = makeListRow({ signNames });
    row[15] = template;
    return row;
  }

  it('佔位符抽取規則與 Code.js 的 pdfPlaceholders_ 一致', () => {
    const text = 'A{{uid}}B{{ name }}C{{uid}}D{{簽名：家長}}E{{}}F{{壞\n掉}}G{{送出時間}}';
    const tool = loadTool('');
    const { gas } = loadGas();
    expect(tool.pdfPlaceholderKeys_(text)).toEqual(_.uniq(gas.pdfPlaceholders_(text).map((ph) => ph.key)));
  });

  it('對不到的欄位 ID、C-S 欄、不存在的簽名格各給一條警告；合法的鍵不警告', () => {
    const tool = loadTool('{{uid}}{{name}}{{送出時間}}{{問卷名稱}}{{簽名:家長}}{{calc}}{{typo}}{{簽名:校長}}');
    const report = { errors: [], warnings: [] };
    tool.checkPdfTemplate_(listRow('T'.repeat(30)), referSS, report);
    expect(report.errors).toEqual([]);
    expect(report.warnings).toHaveLength(3);
    expect(report.warnings.join('\n')).toMatch(/\{\{calc\}\} 是 C-S 欄/);
    expect(report.warnings.join('\n')).toMatch(/\{\{typo\}\} 對不到任何欄位 ID/);
    expect(report.warnings.join('\n')).toMatch(/\{\{簽名:校長\}\} 對不到 G 欄的簽名格/);
  });

  it('範本打不開＝錯誤；P 欄填了網址而不是 ID＝錯誤；留空不檢查', () => {
    const tool = loadTool('');
    const openFail = { errors: [], warnings: [] };
    tool.checkPdfTemplate_(listRow('X'.repeat(30)), referSS, openFail);
    expect(openFail.errors[0]).toMatch(/範本打不開/);

    const urlReport = { errors: [], warnings: [] };
    tool.checkListRow_(listRow('https://docs.google.com/document/d/' + 'T'.repeat(30) + '/edit'), urlReport);
    expect(urlReport.errors.join()).toMatch(/P 輸出PDF 要填 Google 文件範本的 ID/);

    const empty = { errors: [], warnings: [] };
    tool.checkListRow_(listRow(''), empty);
    tool.checkPdfTemplate_(listRow(''), referSS, empty);
    expect(empty.errors).toEqual([]);
  });
});
