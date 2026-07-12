// 暫存試算表定期重建（Phase 18；src/Code.js 是 GAS 檔，非 ES module）：
// 以 new Function 載入原始碼並 stub 掉 GAS 全域，測壓縮純函數與 rebuildDraftSpreadsheet 編排
// （fake SpreadsheetApp/DriveApp/LockService/PropertiesService，比照 tests/inviteRpc.test.js 手法）。
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import _ from 'lodash';

const source = readFileSync(new URL('../src/Code.js', import.meta.url), 'utf8');

// --- fake Sheet / Spreadsheet 模型 ---
function makeSheet(name, rows) {
  const state = { name, rows: rows.map((r) => [...r]), frozenRows: 0 };
  return {
    state,
    getName: () => state.name,
    setName: (n) => {
      state.name = n;
    },
    getLastRow: () => state.rows.length,
    getLastColumn: () => state.rows.reduce((m, r) => Math.max(m, r.length), 0),
    setFrozenRows: (n) => {
      state.frozenRows = n;
    },
    getRange: (row, col, numRows = 1, numCols = 1) => ({
      getValues: () =>
        Array.from({ length: numRows }, (_v, i) =>
          Array.from({ length: numCols }, (_w, j) => {
            const r = state.rows[row - 1 + i];
            const cell = r ? r[col - 1 + j] : undefined;
            return cell === undefined ? '' : cell;
          })
        ),
      setValues: (vals) => {
        for (let i = 0; i < vals.length; i++) {
          state.rows[row - 1 + i] = [...vals[i]];
        }
      },
    }),
  };
}

function makeSpreadsheet(id, name, sheets) {
  const state = { id, name, sheets: [...sheets] };
  return {
    state,
    getId: () => id,
    getName: () => state.name,
    getSheets: () => [...state.sheets],
    getSheetByName: (n) => state.sheets.find((s) => s.getName() === n) || null,
    insertSheet: (n) => {
      // 模擬 GAS 行為：同名分頁 insertSheet 會拋錯（驗證預設分頁改暫名的防線）
      if (state.sheets.some((s) => s.getName() === n)) {
        throw new Error('分頁同名：' + n);
      }
      const sheet = makeSheet(n, []);
      state.sheets.push(sheet);
      return sheet;
    },
    deleteSheet: (sheet) => {
      state.sheets = state.sheets.filter((s) => s !== sheet);
    },
  };
}

// --- 測試環境組裝 ---
function makeEnv({ props = {}, oldSheets = [], corruptAfterFlush = false } = {}) {
  const store = { draftSheetID: 'OLD_SS', ...props };
  const oldSS = makeSpreadsheet('OLD_SS', '暫存表', oldSheets);
  const registry = { OLD_SS: oldSS };
  const created = [];
  const log = []; // 事件順序（setProperty / setName / moveTo）
  const fakeSpreadsheetApp = {
    openById: (id) => {
      if (!(id in registry)) {
        throw new Error('unknown spreadsheet ' + id);
      }
      return registry[id];
    },
    create: (name) => {
      const ss = makeSpreadsheet('NEW_SS_' + (created.length + 1), name, [
        makeSheet('工作表1', []),
      ]);
      registry[ss.getId()] = ss;
      created.push(ss);
      return ss;
    },
    flush: () => {
      if (corruptAfterFlush && created.length > 0) {
        // 模擬寫入沒生效：砍掉新表第一個有資料分頁的最後一列 → sanity check 必須擋下
        const target = created[0].state.sheets.find((s) => s.state.rows.length > 0);
        if (target) {
          target.state.rows.pop();
        }
      }
    },
  };
  const backupFolder = { __id: 'BACKUP_FOLDER', getName: () => '備份夾' };
  const parentFolder = { __id: 'PARENT', getName: () => '原資料夾' };
  const files = {};
  function fileFor(id) {
    if (!files[id]) {
      files[id] = {
        name: registry[id] ? registry[id].getName() : id,
        parent: parentFolder,
        getName() {
          return this.name;
        },
        setName(n) {
          this.name = n;
          log.push('setName:' + id);
        },
        getParents() {
          let used = false;
          const parent = this.parent;
          return {
            hasNext: () => !used,
            next: () => {
              used = true;
              return parent;
            },
          };
        },
        moveTo(folder) {
          this.parent = folder;
          log.push('moveTo:' + id + ':' + folder.__id);
        },
      };
    }
    return files[id];
  }
  const fakeDriveApp = {
    getFolderById: (id) => {
      if (id === 'BACKUP_FOLDER') {
        return backupFolder;
      }
      throw new Error('unknown folder ' + id);
    },
    getFileById: (id) => fileFor(id),
  };
  const factory = new Function(
    'LodashGS',
    'PropertiesService',
    'Utilities',
    'SpreadsheetApp',
    'DriveApp',
    'LockService',
    'Session',
    `${source}\n;return {
      compactDraftRows_, compactInviteRows_, draftRebuildMinRows_, rebuildDraftSpreadsheet,
      DRAFT_HEADER, INVITE_HEADER,
    };`
  );
  const gas = factory(
    { load: () => _ },
    {
      getScriptProperties: () => ({
        getProperty: (key) => (key in store ? store[key] : null),
        setProperty: (key, value) => {
          store[key] = value;
          log.push('setProperty:' + key);
        },
      }),
    },
    { formatDate: () => '2026-07-11 03:00' },
    fakeSpreadsheetApp,
    fakeDriveApp,
    { getScriptLock: () => ({ waitLock: () => {}, releaseLock: () => {} }) },
    { getScriptTimeZone: () => 'Asia/Taipei' }
  );
  return { gas, store, oldSS, created, files, log, backupFolder, parentFolder };
}

// 純函數用：不需要 fake 環境的輕量載入
const { gas: pure } = makeEnv();
const { compactDraftRows_, compactInviteRows_, DRAFT_HEADER, INVITE_HEADER } = pure;

// 14 欄邀請列（欄序對齊 inviteRowOf_；虛構測試資料）
function inviteRow(token, referSSID, primaryValue, signName, status) {
  return [
    token,
    referSSID,
    'REC_1',
    primaryValue,
    signName,
    'invitee@example.com',
    1700000000000,
    status,
    '',
    1690000000000,
    1690000000000,
    '',
    0,
    0,
  ];
}

describe('compactDraftRows_（草稿分頁壓縮：每 (主鍵, referSSID) 複合鍵最新列）', () => {
  it('多版本 → 留最新一列（superseded 舊版被丟），保留複合鍵首次出現順序', () => {
    const rows = [
      DRAFT_HEADER,
      ['測試生甲', 1, 'REF_1', 'gz:v1'],
      ['測試生乙', 2, 'REF_1', 'gz:x'],
      ['測試生甲', 3, 'REF_1', 'gz:v2'],
    ];
    expect(compactDraftRows_(rows)).toEqual([
      ['測試生甲', 3, 'REF_1', 'gz:v2'],
      ['測試生乙', 2, 'REF_1', 'gz:x'],
    ]);
  });

  it('跨問卷同主鍵各自保留（複合鍵，Phase 19 單表化）', () => {
    const rows = [
      DRAFT_HEADER,
      ['測試生甲', 1, 'REF_1', 'gz:formA'],
      ['測試生甲', 2, 'REF_2', 'gz:formB'],
    ];
    expect(compactDraftRows_(rows)).toEqual([
      ['測試生甲', 1, 'REF_1', 'gz:formA'],
      ['測試生甲', 2, 'REF_2', 'gz:formB'],
    ]);
  });

  it('表頭列（首欄字面字串）被跳過、不當資料', () => {
    expect(compactDraftRows_([DRAFT_HEADER, ['測試生甲', 1, 'REF_1', 'gz:v1']]).length).toBe(1);
  });

  it('變長 chunk 列補 \'\' 對齊成矩形', () => {
    const out = compactDraftRows_([
      DRAFT_HEADER,
      ['測試生甲', 1, 'REF_1', 'c1', 'c2', 'c3'],
      ['測試生乙', 2, 'REF_1', 'x'],
    ]);
    expect(out[0].length).toBe(6);
    expect(out[1]).toEqual(['測試生乙', 2, 'REF_1', 'x', '', '']);
  });

  it('空陣列與只有表頭都回空', () => {
    expect(compactDraftRows_([])).toEqual([]);
    expect(compactDraftRows_([DRAFT_HEADER])).toEqual([]);
  });

  it('無主鍵的空列被跳過', () => {
    expect(
      compactDraftRows_([DRAFT_HEADER, ['', '', '', ''], ['測試生甲', 1, 'REF_1', 'gz:v1']]).length
    ).toBe(1);
  });
});

describe('compactInviteRows_（_invites 壓縮：每格最新列原樣快照）', () => {
  it('同格多快照 → 留最新一列；不同格各自保留，依格首次出現排序', () => {
    const rowOld = inviteRow('a'.repeat(64), 'REF_1', '測試生甲', '家長', 'pending');
    const rowNew = inviteRow('b'.repeat(64), 'REF_1', '測試生甲', '家長', 'signed');
    const rowOther = inviteRow('c'.repeat(64), 'REF_1', '測試生甲', '學生', 'pending');
    expect(compactInviteRows_([INVITE_HEADER, rowOld, rowOther, rowNew])).toEqual([
      rowNew,
      rowOther,
    ]);
  });

  it('終態（revoked/consumed）列是最新列就原樣保留，零語意判讀', () => {
    const revoked = inviteRow('d'.repeat(64), 'REF_1', '測試生乙', '家長', 'revoked');
    const out = compactInviteRows_([INVITE_HEADER, revoked]);
    expect(out).toEqual([revoked]);
    expect(out[0]).toBe(revoked); // 原列參照照抄，未被改寫
  });

  it('表頭列被跳過；空表回空', () => {
    expect(compactInviteRows_([INVITE_HEADER])).toEqual([]);
    expect(compactInviteRows_([])).toEqual([]);
  });
});

describe('rebuildDraftSpreadsheet（重建編排）', () => {
  // 標準 fixture：_invites（同格兩版）＋ _draft 單表（甲兩版含變長 chunk＋乙＋跨問卷）
  // ＋ Phase 19 前殘留的舊亂數名草稿分頁（首格同表頭字串，按名稱分派認不得 → 原樣照抄）
  // ＋認不得的分頁＋空分頁
  function standardSheets() {
    return [
      makeSheet('_invites', [
        INVITE_HEADER,
        inviteRow('a'.repeat(64), 'REF_1', '測試生甲', '家長', 'pending'),
        inviteRow('b'.repeat(64), 'REF_1', '測試生甲', '家長', 'signed'),
        inviteRow('c'.repeat(64), 'REF_1', '測試生乙', '家長', 'pending'),
      ]),
      makeSheet('_draft', [
        DRAFT_HEADER,
        ['測試生甲', 1, 'REF_1', 'gz:v1'],
        ['測試生甲', 2, 'REF_1', 'gz:v2a', 'gz:v2b'],
        ['測試生乙', 3, 'REF_1', 'gz:x'],
        ['測試生甲', 4, 'REF_2', 'gz:other-form'],
      ]),
      makeSheet('REF_OLD', [
        ['primaryKey 主鍵', 'updatedAt 存檔(ms)', 'payload 草稿(gz:base64，超長切塊)'],
        ['測試生甲', 1, 'gz:old'],
      ]),
      makeSheet('隨手記', [['未知格式'], ['第二列', 'x']]),
      makeSheet('空分頁', []),
    ];
  }

  it('未設 draftBackupFolderID → 中止，不建新表、property 不變', () => {
    const { gas, store, created } = makeEnv({ oldSheets: standardSheets() });
    const msg = gas.rebuildDraftSpreadsheet();
    expect(msg).toContain('未設定 draftBackupFolderID');
    expect(store.draftSheetID).toBe('OLD_SS');
    expect(created.length).toBe(0);
  });

  it('備份資料夾開不起來 → 中止，不建新表', () => {
    const { gas, store, created } = makeEnv({
      props: { draftBackupFolderID: 'BAD_FOLDER' },
      oldSheets: standardSheets(),
    });
    const msg = gas.rebuildDraftSpreadsheet();
    expect(msg).toContain('draftBackupFolderID 開啟失敗');
    expect(store.draftSheetID).toBe('OLD_SS');
    expect(created.length).toBe(0);
  });

  it('未達 draftRebuildMinRows 門檻 → 跳過重建（資料列數扣掉表頭列）', () => {
    const { gas, store, created } = makeEnv({
      // fixture 資料列：邀請 3 + _draft 4 + 舊亂數分頁 2（Phase 20 改表頭字串後，
      // 舊分頁首格不再等於 DRAFT_HEADER[0]、其表頭列計為資料——門檻計數保守方向）+ 未知 2 + 空 0 = 11
      props: { draftBackupFolderID: 'BACKUP_FOLDER', draftRebuildMinRows: '12' },
      oldSheets: standardSheets(),
    });
    const msg = gas.rebuildDraftSpreadsheet();
    expect(msg).toContain('未達門檻（資料 11 列 < draftRebuildMinRows 12）');
    expect(store.draftSheetID).toBe('OLD_SS');
    expect(created.length).toBe(0);
  });

  it('門檻剛好達標 → 照常重建', () => {
    const { gas, store } = makeEnv({
      props: { draftBackupFolderID: 'BACKUP_FOLDER', draftRebuildMinRows: '11' },
      oldSheets: standardSheets(),
    });
    expect(gas.rebuildDraftSpreadsheet()).toContain('重建完成');
    expect(store.draftSheetID).toBe('NEW_SS_1');
  });

  it('成功路徑：壓縮內容、表頭凍結、原樣分頁、換手、改名搬移順序都正確', () => {
    const { gas, store, created, oldSS, files, log, backupFolder, parentFolder } = makeEnv({
      props: { draftBackupFolderID: 'BACKUP_FOLDER' },
      oldSheets: standardSheets(),
    });
    const msg = gas.rebuildDraftSpreadsheet();
    expect(msg).toContain('重建完成');
    expect(msg).toContain('NEW_SS_1');

    // property 原子換手
    expect(store.draftSheetID).toBe('NEW_SS_1');
    const newSS = created[0];

    // _invites：表頭＋每格最新列（甲家長 signed、乙家長 pending），凍結首列
    const invites = newSS.getSheetByName('_invites');
    expect(invites.state.frozenRows).toBe(1);
    expect(invites.state.rows.length).toBe(3);
    expect(invites.state.rows[0]).toEqual(INVITE_HEADER);
    expect(invites.state.rows[1][0]).toBe('b'.repeat(64));
    expect(invites.state.rows[1][7]).toBe('signed');
    expect(invites.state.rows[2][0]).toBe('c'.repeat(64));

    // _draft 單表：表頭＋每 (主鍵, referSSID) 複合鍵最新列，表頭與短列補 '' 對齊成矩形
    const draft = newSS.getSheetByName('_draft');
    expect(draft.state.frozenRows).toBe(1);
    expect(draft.state.rows.length).toBe(4);
    expect(draft.state.rows[0]).toEqual(DRAFT_HEADER.concat(['']));
    expect(draft.state.rows[1]).toEqual(['測試生甲', 2, 'REF_1', 'gz:v2a', 'gz:v2b']);
    expect(draft.state.rows[2]).toEqual(['測試生乙', 3, 'REF_1', 'gz:x', '']);
    expect(draft.state.rows[3]).toEqual(['測試生甲', 4, 'REF_2', 'gz:other-form', '']);

    // Phase 19 前殘留的舊亂數名草稿分頁：首格同表頭字串，但按名稱分派認不得 → 原樣照抄、不壓、不凍結
    const oldDraft = newSS.getSheetByName('REF_OLD');
    expect(oldDraft.state.frozenRows).toBe(0);
    expect(oldDraft.state.rows).toEqual([
      ['primaryKey 主鍵', 'updatedAt 存檔(ms)', 'payload 草稿(gz:base64，超長切塊)'],
      ['測試生甲', 1, 'gz:old'],
    ]);

    // 認不得的分頁原樣複製、不凍結；空分頁照建（空的）
    const notes = newSS.getSheetByName('隨手記');
    expect(notes.state.frozenRows).toBe(0);
    expect(notes.state.rows).toEqual([
      ['未知格式', ''],
      ['第二列', 'x'],
    ]);
    expect(newSS.getSheetByName('空分頁').state.rows).toEqual([]);

    // 預設空白分頁已刪、無 __rebuild_ 暫名殘留
    expect(newSS.getSheets().map((s) => s.getName())).toEqual([
      '_invites',
      '_draft',
      'REF_OLD',
      '隨手記',
      '空分頁',
    ]);

    // 舊表原封不動（純讀，邀請/草稿資料照舊）
    expect(oldSS.getSheetByName('_invites').state.rows.length).toBe(4);
    expect(oldSS.getSheetByName('_draft').state.rows.length).toBe(5);

    // 檔案搬移：新表搬到舊表原父資料夾、舊表改名（帶「備份」字樣）搬進備份資料夾
    expect(files.NEW_SS_1.parent).toBe(parentFolder);
    expect(files.OLD_SS.parent).toBe(backupFolder);
    expect(files.OLD_SS.name).toContain('備份');
    expect(files.OLD_SS.name).toContain('暫存表');

    // 順序：翻 property（生效點）→ 新表搬家 → 舊表改名 → 舊表搬備份夾
    expect(log).toEqual([
      'setProperty:draftSheetID',
      'moveTo:NEW_SS_1:PARENT',
      'setName:OLD_SS',
      'moveTo:OLD_SS:BACKUP_FOLDER',
    ]);
  });

  it('sanity check 失敗 → 不翻 property、不搬移，新表留存供人工檢查', () => {
    const { gas, store, created, log } = makeEnv({
      props: { draftBackupFolderID: 'BACKUP_FOLDER' },
      oldSheets: standardSheets(),
      corruptAfterFlush: true,
    });
    const msg = gas.rebuildDraftSpreadsheet();
    expect(msg).toContain('sanity check 失敗');
    expect(msg).toContain('NEW_SS_1');
    expect(store.draftSheetID).toBe('OLD_SS');
    expect(created.length).toBe(1); // 新表留存
    expect(log).toEqual([]); // 沒翻 property、沒改名、沒搬移
  });

  it('舊表有分頁與新表預設分頁同名（工作表1）→ 暫名防線讓重建照常', () => {
    const { gas, store, created } = makeEnv({
      props: { draftBackupFolderID: 'BACKUP_FOLDER' },
      oldSheets: [
        makeSheet('_invites', [INVITE_HEADER]),
        makeSheet('工作表1', [['手動加的分頁']]),
      ],
    });
    expect(gas.rebuildDraftSpreadsheet()).toContain('重建完成');
    expect(store.draftSheetID).toBe('NEW_SS_1');
    expect(created[0].getSheetByName('工作表1').state.rows).toEqual([['手動加的分頁']]);
  });

  it('線上暫存未啟用（無 draftSheetID）→ 中止', () => {
    const { gas } = makeEnv({ props: { draftSheetID: '' } });
    expect(gas.rebuildDraftSpreadsheet()).toContain('線上暫存未啟用');
  });
});

describe('draftRebuildMinRows_（門檻讀取）', () => {
  it('未設/非正整數/負數 → 0（永遠重建）；正整數照讀', () => {
    expect(makeEnv().gas.draftRebuildMinRows_()).toBe(0);
    expect(makeEnv({ props: { draftRebuildMinRows: 'abc' } }).gas.draftRebuildMinRows_()).toBe(0);
    expect(makeEnv({ props: { draftRebuildMinRows: '-5' } }).gas.draftRebuildMinRows_()).toBe(0);
    expect(makeEnv({ props: { draftRebuildMinRows: '500' } }).gas.draftRebuildMinRows_()).toBe(500);
  });
});
