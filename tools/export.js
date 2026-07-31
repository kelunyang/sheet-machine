// 「問卷列表」試算表的 container-bound Apps Script（手動貼進該試算表的 Apps Script 編輯器）。
// 功能表「問卷管理」提供三個功能，操作對象一律是「問卷列表」分頁上目前點選的那一列：
//   1. 新增問卷：貼上對照表單 ID → 跑格式檢查 → 自動建立填入表、附掛到列表新列
//   2. 輸出問卷：匯出點選列的填答結果（取代舊「輸出主控台」分頁，該分頁可刪除）
//   3. 檢查問卷格式：對點選列跑完整檢查（列設定＋對照表單＋紀錄表對齊）
// 檢查規則清單與凍結決策見 repo 的 plan/2026-summer.md；欄列語意見 plan/dataformat.md。
// 需要的 ScriptProperties：exportStorage（匯出目的資料夾 ID）。舊的 listSheet 屬性已不再使用。

const _ = LodashGS.load();
// 時間觸發器（定時匯出）執行時沒有 UI，getUi() 會直接拋例外——全域常數是在任何函式
// 執行前就求值的，不包起來的話定時匯出根本進不了函式。選單類功能才會用到 ui，
// 定時路徑一律不碰（ui 為 null）
const ui = (function () {
  try {
    return SpreadsheetApp.getUi();
  } catch {
    return null;
  }
})();
const appProperties = PropertiesService.getScriptProperties();
const loggerName = "執行紀錄";
const LIST_SHEET_NAME = "問卷列表";
const SCHEDULE_SHEET_NAME = "定時匯出";

function onOpen() {
  ui.createMenu("問卷管理")
    .addItem("新增問卷（貼上對照表單ID）", "createQuestionnaire")
    .addItem("建立新問卷骨架（從零開始）", "createScaffoldQuestionnaire")
    .addItem("欄位輔助精靈（生成欄位設定）", "openFieldWizard")
    .addItem("修改問卷設定（先點選要改的列）", "editSheetSettings")
    .addItem("修改問卷內容（先點選要改的列）", "openReferForEdit")
    .addItem("輸出問卷（先點選要輸出的列）", "exportSheet")
    .addItem("檢查問卷格式（先點選要檢查的列）", "checkSheetFormat")
    .addSeparator()
    .addItem("定時匯出排程（新增／修改）", "openScheduleDialog")
    .addItem("立即試跑定時匯出", "runScheduledExportNow")
    .addToUi();
  // 多帳號登入的已知坑：對話框內按鈕（google.script.run）一律以瀏覽器「預設帳號」
  // 執行，不是開表帳號——預設帳號沒權限就會炸 PERMISSION_DENIED，程式端救不了
  ui.alert("問卷管理提醒",
    "要使用「問卷管理」選單（尤其是對話框裡的按鈕）時，\n" +
    "建議用「只登入管理員帳號」的瀏覽器視窗操作——\n" +
    "例如無痕模式，或專屬的瀏覽器設定檔。\n\n" +
    "瀏覽器同時登入多個 Google 帳號時，對話框功能會以「預設帳號」\n" +
    "執行，若那不是管理員帳號，會出現 PERMISSION_DENIED 錯誤。",
    ui.ButtonSet.OK);
}

function logger(fileName, msg, ssObj) {
  var sheet = ssObj.getSheetByName(loggerName);
  // 分頁不存在就退回 console（定時觸發器沒有 UI，不該因為缺紀錄分頁整場炸掉）
  if (sheet === null) {
    console.log("[" + fileName + "] " + msg);
    return;
  }
  var who;
  try {
    who = Session.getActiveUser().getEmail();
  } catch {
    who = "（觸發器）";
  }
  sheet.appendRow([Utilities.formatDate(new Date(), "GMT+8", "yyyy/MM/dd HH:mm:ss"), who, fileName, msg]);
}

// ===== 共用：選取列與 ID 解析 =====

// 回傳目前點選的問卷列（{rowIndex, row}），不合法時 alert 並回 null
function selectedListRow_(listSS) {
  let sheet = listSS.getActiveSheet();
  if (sheet.getName() !== LIST_SHEET_NAME) {
    ui.alert("請先切到「" + LIST_SHEET_NAME + "」分頁，點選要操作的問卷那一列再執行");
    return null;
  }
  let rowIndex = sheet.getActiveRange().getRow();
  if (rowIndex < 2) {
    ui.alert("你點選的是標題列，請點選第 2 列起的問卷資料列");
    return null;
  }
  let row = sheet.getRange(rowIndex, 1, 1, 15).getValues()[0];
  if (row[0].toString().trim() === "") {
    ui.alert("第 " + rowIndex + " 列沒有表單名稱，請點選有資料的列");
    return null;
  }
  return { rowIndex: rowIndex, row: row };
}

// 從網址或純 ID 字串抽出試算表 ID
function extractSheetId_(text) {
  let match = text.toString().trim().match(/[-\w]{25,}/);
  return match ? match[0] : "";
}

// ===== 共用：資料夾屬性與建表 =====
// ScriptProperties（皆選填）：referStorage＝結構表資料夾、recordStorage＝寫入表資料夾、
// webAppAccount＝web app 執行帳號（供填入表保護編輯者）。資料夾各共享一次給執行帳號
// （結構表夾檢視權、寫入表夾編輯權），之後建立的表自動繼承，不用逐卷手動共享。

// 讀資料夾屬性：有設就回該資料夾，沒設（或打不開）回 fallback（可為 null）
function storageFolder_(propName, fallbackFolder) {
  let id = appProperties.getProperty(propName);
  if (id !== null && id.toString().trim() !== "") {
    try {
      return DriveApp.getFolderById(id.toString().trim());
    } catch { /* 屬性設錯就落回 fallback，不中斷流程 */ }
  }
  return fallbackFolder;
}

function parentFolderOf_(fileID) {
  try {
    let parents = DriveApp.getFileById(fileID).getParents();
    return parents.hasNext() ? parents.next() : null;
  } catch {
    return null;
  }
}

// 建填入表：兩列標題（第 1 列欄位 ID、第 2 列名稱＋A-E 人讀標籤）、移入 recordStorage
// （沒設則放對照表單旁）、整張保護（編輯者只留擁有者＋webAppAccount）——填答資料
// 不准人工改，從紀律變機制。回傳 {recordSS, protectWarning}
function buildRecordSheet_(referSS, referID, formName) {
  let referArr = referSS.getSheets()[0].getDataRange().getValues();
  let recordSS = SpreadsheetApp.create(formName + "（填入表）");
  let recordSheet = recordSS.getSheets()[0];
  let idRow = ["", "", "", "", ""];
  let nameRow = ["送出時間", "有效", "主鍵", "簽名檔ID", "分組"];
  for (let i = 0; i < referArr[0].length; i++) {
    idRow.push(referArr[0][i].toString());
    nameRow.push(referArr[1][i].toString());
  }
  recordSheet.appendRow(idRow);
  recordSheet.appendRow(nameRow);
  let folder = storageFolder_('recordStorage', parentFolderOf_(referID));
  if (folder !== null) {
    DriveApp.getFileById(recordSS.getId()).moveTo(folder);
  }
  let protectWarning = "";
  try {
    let protection = recordSheet.protect().setDescription("填答紀錄由系統寫入，請勿手動修改");
    let editors = protection.getEditors();
    if (editors.length > 0) {
      protection.removeEditors(editors.map(function(user) { return user.getEmail(); }));
    }
    let webAppAccount = appProperties.getProperty('webAppAccount');
    if (webAppAccount !== null && webAppAccount.toString().trim() !== "") {
      protection.addEditor(webAppAccount.toString().trim());
    } else {
      protectWarning = "（ScriptProperties 沒設 webAppAccount，保護編輯者只有你；請把執行帳號加進保護，否則 web app 寫不進去）";
    }
  } catch (e) {
    protectWarning = "（保護設定失敗：" + e.message + "，請手動保護填入表分頁）";
  }
  return { recordSS: recordSS, protectWarning: protectWarning };
}

// 掛上問卷列表新列：顯示／開放進入預設「否」。回傳 {rowIndex, dueMs, viewMs}
// 問卷列表為 A~O 共 15 欄（舊「固定ID」欄已於 2026-07-31 整欄刪除，原 O/P 前移成 N/O）。
// 問卷識別一律用 B 欄 refer（Drive ID，本身就唯一，深連結 ?sheet= 用它）。
function appendListRow_(listSS, formName, referID, recordID, days) {
  let nowMs = (new Date()).getTime();
  let dueMs = nowMs + days * 24 * 60 * 60 * 1000;
  let viewMs = dueMs + 14 * 24 * 60 * 60 * 1000;
  let listSheet = listSS.getSheetByName(LIST_SHEET_NAME);
  listSheet.appendRow([
    formName, referID, recordID, dueMs, viewMs,
    "是", "",
    "請依照各欄位說明填寫", "請輸入認證資料登入", "已收到你的填答，感謝", "登入失敗，請確認輸入的資料",
    "否", Session.getActiveUser().getEmail(), "否", "否"
  ]);
  logger(formName, "新增問卷（列 " + listSheet.getLastRow() + "）", listSS);
  return { rowIndex: listSheet.getLastRow(), dueMs: dueMs, viewMs: viewMs };
}

// ===== 功能 1：新增問卷 =====

function createQuestionnaire() {
  let listSS = SpreadsheetApp.getActiveSpreadsheet();
  let idResp = ui.prompt("新增問卷（1/3）", "請貼上「對照表單」（欄位定義＋名冊）的試算表網址或 ID：", ui.ButtonSet.OK_CANCEL);
  if (idResp.getSelectedButton() !== ui.Button.OK) { return; }
  let referID = extractSheetId_(idResp.getResponseText());
  if (referID === "") { ui.alert("看不懂這個網址／ID，操作取消"); return; }
  let referSS;
  try {
    referSS = SpreadsheetApp.openById(referID);
  } catch {
    ui.alert("打不開這份試算表（ID：" + referID + "），請確認 ID 正確且你有存取權限");
    return;
  }
  // 新增一定先過格式檢查：有錯擋下，只有警告則讓管理者決定
  let report = checkReferFormat_(referSS);
  if (report.errors.length > 0) {
    ui.alert("對照表單格式檢查未通過，請修正後再新增", formatReport_(report), ui.ButtonSet.OK);
    return;
  }
  if (report.warnings.length > 0) {
    let go = ui.alert("對照表單格式檢查有警告", formatReport_(report) + "\n\n仍要繼續建立嗎？", ui.ButtonSet.YES_NO);
    if (go !== ui.Button.YES) { return; }
  }
  let nameResp = ui.prompt("新增問卷（2/3）", "表單名稱（留空＝使用對照表單檔名「" + referSS.getName() + "」）：", ui.ButtonSet.OK_CANCEL);
  if (nameResp.getSelectedButton() !== ui.Button.OK) { return; }
  let formName = nameResp.getResponseText().trim() === "" ? referSS.getName() : nameResp.getResponseText().trim();
  let daysResp = ui.prompt("新增問卷（3/3)", "填表期限為幾天後？（留空＝14 天；檢視期限自動再加 14 天，之後都可在列上直接改 timestamp）", ui.ButtonSet.OK_CANCEL);
  if (daysResp.getSelectedButton() !== ui.Button.OK) { return; }
  let days = parseInt(daysResp.getResponseText());
  if (isNaN(days) || days <= 0) { days = 14; }
  let built = buildRecordSheet_(referSS, referID, formName);
  let listRow = appendListRow_(listSS, formName, referID, built.recordSS.getId(), days);
  ui.alert("「" + formName + "」已建立在第 " + listRow.rowIndex + " 列！\n\n" +
    "填入表已建好並保護（禁止手動修改）" + built.protectWarning + "\n" +
    "接下來：\n" +
    "1. 若 recordStorage 資料夾沒共享給 web app 執行帳號，記得補共享（編輯權）\n" +
    "2. 用「修改問卷設定」調整說明文字、簽名欄、截止時間\n" +
    "3. 確認無誤後把「顯示」「開放進入」改成「是」才會上線\n" +
    "（格式檢查已通過" + (report.warnings.length > 0 ? "，但有 " + report.warnings.length + " 條警告，見前一個視窗" : "") + "）");
}

// ===== 功能 1b：建立新問卷骨架（從零開始） =====

// 骨架欄位（每欄 9 格：ID/名稱/type/format/group/content/must/nullable/名冊示範值），
// 全部虛構資料。作者建完後在結構表裡手動編欄位（配合欄位輔助精靈），編完跑格式檢查
const SCAFFOLD_COLUMNS_ = [
  ["G01", "班級", "G", "G", "", "", "", "", "101"],
  ["G02", "座號", "G", "N", "", "", "", "", "1"],
  ["P01", "身分證", "P", "I", "", "", "", "", "A123456789"],
  ["O01", "姓名", "O", "", "", "", "", "", "王小明"],
  ["C01", "填寫說明", "C", "M", "", "請依照各欄位說明填寫（示範說明區塊，支援 **markdown**）", "", "", ""],
  ["T01", "文字題示範", "F", "T", "", "", "", "", ""],
  ["S01", "下拉題示範", "F", "S", "", "選項A;選項B;選項C", "M", "", ""]
];

function createScaffoldQuestionnaire() {
  let listSS = SpreadsheetApp.getActiveSpreadsheet();
  let nameResp = ui.prompt("建立新問卷骨架（1/2）", "表單名稱：", ui.ButtonSet.OK_CANCEL);
  if (nameResp.getSelectedButton() !== ui.Button.OK) { return; }
  let formName = nameResp.getResponseText().trim();
  if (formName === "") { ui.alert("表單名稱不能是空的，操作取消"); return; }
  let daysResp = ui.prompt("建立新問卷骨架（2/2）", "填表期限為幾天後？（留空＝14 天；檢視期限自動再加 14 天）", ui.ButtonSet.OK_CANCEL);
  if (daysResp.getSelectedButton() !== ui.Button.OK) { return; }
  let days = parseInt(daysResp.getResponseText());
  if (isNaN(days) || days <= 0) { days = 14; }
  // 建結構表：8 列 meta＋1 列假名冊，示範欄位轉置寫入
  let referSS = SpreadsheetApp.create(formName + "（結構表）");
  let referSheet = referSS.getSheets()[0];
  let rows = [];
  for (let r = 0; r < 9; r++) {
    let row = [];
    for (let c = 0; c < SCAFFOLD_COLUMNS_.length; c++) {
      row.push(SCAFFOLD_COLUMNS_[c][r]);
    }
    rows.push(row);
  }
  referSheet.getRange(1, 1, 9, SCAFFOLD_COLUMNS_.length).setValues(rows);
  let referFolder = storageFolder_('referStorage', null);
  if (referFolder !== null) {
    DriveApp.getFileById(referSS.getId()).moveTo(referFolder);
  }
  let built = buildRecordSheet_(referSS, referSS.getId(), formName);
  let listRow = appendListRow_(listSS, formName, referSS.getId(), built.recordSS.getId(), days);
  ui.alert("「" + formName + "」骨架已建立在第 " + listRow.rowIndex + " 列！\n\n" +
    "結構表：" + referSS.getUrl() + "\n" +
    (referFolder === null ? "（ScriptProperties 沒設 referStorage，結構表放在你的雲端硬碟根目錄）\n" : "") +
    "填入表已建好並保護" + built.protectWarning + "\n\n" +
    "接下來：\n" +
    "1. 打開結構表，把示範欄位改成真正的題目（可用「欄位輔助精靈」生成欄位設定）\n" +
    "2. 名冊（第 9 列起）換成真實名單\n" +
    "3. 編完跑「檢查問卷格式」，通過後再把「顯示」「開放進入」改「是」");
}

// ===== 功能 2：輸出問卷（原輸出主控台三參數改為點選列＋兩個問答） =====

function exportSheet() {
  let listSS = SpreadsheetApp.getActiveSpreadsheet();
  let selected = selectedListRow_(listSS);
  if (selected === null) { return; }
  let sheetData = selected.row;
  let response = ui.alert("問卷匯出機器人", "要匯出「" + sheetData[0].toString() + "」的填答結果嗎？", ui.ButtonSet.YES_NO);
  if (response !== ui.Button.YES) { ui.alert("操作取消！"); return; }
  let headerResp = ui.prompt("問卷匯出機器人", "紀錄表開頭有幾列標題？（留空＝2，即欄位ID＋欄位名稱兩列）", ui.ButtonSet.OK_CANCEL);
  if (headerResp.getSelectedButton() !== ui.Button.OK) { return; }
  let headerCount = parseInt(headerResp.getResponseText());
  if (isNaN(headerCount) || headerCount < 0) { headerCount = 2; }
  let uniqueResp = ui.alert("問卷匯出機器人", "同一人填多次時，只輸出最新一筆嗎？\n（「否」＝每一筆都輸出）", ui.ButtonSet.YES_NO);
  let uniquePrimary = uniqueResp === ui.Button.YES;
  let result = runExport_(listSS, sheetData, { headerCount: headerCount, uniquePrimary: uniquePrimary });
  if (!result.ok) {
    ui.alert("「" + sheetData[0].toString() + "」" + result.message);
    return;
  }
  ui.alert("「" + sheetData[0].toString() + "」輸出完成！\n原始資料有" + result.sourceCount + "行，輸出後為" + result.rowCount + "行！\n有" + result.lengthMismatch + "行長度和其他人對不起來，可能是簽名檔遺失，請自行打開輸出檔案之後檢查\n請記得自己刪掉數字前面的「📝」（為了避免數字前的0被吃掉）\n本次匯出耗時" + result.elapsed + "秒\n輸出的位置是" + result.folderName + "\\" + sheetData[0].toString() + "\\" + result.sheetName);
}

// 匯出核心：手動（exportSheet）與定時（scheduledExport）共用，完全不碰 ui。
// options＝{headerCount, uniquePrimary}；回傳 {ok, message, sourceCount, rowCount,
// lengthMismatch, elapsed, url, sheetName, folderName}
function runExport_(listSS, sheetData, options) {
  let headerCount = options.headerCount;
  let uniquePrimary = options.uniquePrimary;
  let start = (new Date()).getTime();
  let writeSID = "";
  let exportStorage = appProperties.getProperty('exportStorage');
  let destFolder = DriveApp.getFolderById(exportStorage);
  // 精確比對檔名（原本 title contains 會誤中「數學測驗」vs「數學測驗補考」，
  // 自動排程匯錯檔沒人會當場發現）；輸出檔就是以問卷名稱建立的，精確比對必中
  let existCheck = DriveApp.searchFiles('parents in "' + exportStorage + '" and title = "' + sheetData[0].toString().replace(/"/g, '\\"') + '"');
  while (existCheck.hasNext()) {
    let file = existCheck.next();
    writeSID = file.getId();
    break;
  }
  let logMsg = writeSID === "" ? "第一次輸出，要建立新的問卷" : "已經輸出過了";
  logger(sheetData[0].toString(), "開始輸出問卷（" + logMsg + "）", listSS);
  let referSS = SpreadsheetApp.openById(sheetData[1].toString());
  let referSheet = referSS.getSheets()[0];
  let referRange = referSheet.getDataRange();
  let referArr = referRange.getValues();
  let headers = [];
  if(referArr.length > 3) {
    if(referArr[2].length > 0) {
      for(let i=0; i<referArr[2].length; i++) {
        if(/G|O|C|A|P|F/.test(referArr[2][i].toString())) {
          headers.push({
            type: referArr[2][i].toString(),
            format: referArr[3][i].toString(),
            pos: i
          });
        }
      }
    }
  }
  let recordSS = SpreadsheetApp.openById(sheetData[2].toString());
  let recordSheet = recordSS.getSheets()[0];
  let recordRange = recordSheet.getDataRange();
  let recordArr = recordRange.getValues();
  let newSS = writeSID === "" ? SpreadsheetApp.create(sheetData[0].toString()) : SpreadsheetApp.openById(writeSID);
  if(writeSID === "") {
    // 建完就搬進匯出資料夾（原本只在「有資料」時才搬，空表會留一份在雲端硬碟根目錄，
    // 下次匯出因為搜不到而重建，等於每次空跑都掉一個孤兒檔）
    DriveApp.getFileById(newSS.getId()).moveTo(destFolder);
  }
  let now = new Date();
  let sheetName = "輸出日期：" + now.toLocaleString();
  // 同一秒內重複輸出會撞名（insertSheet 重名直接 throw），補流水號
  let dedup = 2;
  while(newSS.getSheetByName(sheetName) !== null) {
    sheetName = "輸出日期：" + now.toLocaleString() + "（" + dedup + "）";
    dedup++;
  }
  // 放在第一個分頁：最新一次輸出永遠在最左邊，不用往右捲找
  let newSheet = newSS.insertSheet(sheetName, 0);
  if(writeSID === "") {
    let newSheets = newSS.getSheets();
    for(let i=0; i<newSheets.length; i++) {
      if(newSheets[i].getName() !== sheetName) {
        newSS.deleteSheet(newSheets[i]);
      }
    }
  }
  // 標題列先取出來但不能直接貼：資料列會被 injectRefer 重排（簽名檔ID 一格拆成 n 格
  // URL、非題目欄位整欄丟掉），照抄的表頭跟資料對不齊——簽名格 1 格時剛好巧合對上，
  // 2 格以上整排答案往右錯一格。下面算出簽名格數後用同一套排法重組表頭。
  let headerRows = recordArr.slice(0, Math.min(headerCount, recordArr.length));
  recordArr.splice(0, headerCount);
  // 簽名格數取全表最大值，每列一律補滿（沒簽的補「無簽名」），讓每一列與表頭同寬同序
  let sigCount = 0;
  for(let i=0; i<recordArr.length; i++) {
    let cell = recordArr[i][3] === undefined ? "" : recordArr[i][3].toString();
    let n = cell === "" ? 0 : cell.split(";").length;
    if(n > sigCount) { sigCount = n; }
  }
  let referCtx = buildReferContext_(headers, referArr);
  referCtx.sigCount = sigCount;
  // getDataRange 回來的陣列是矩形，全表同寬；表頭與資料列共用同一組來源欄索引
  let recordWidth = recordArr.length > 0 ? recordArr[0].length
    : (headerRows.length > 0 ? headerRows[0].length : SIG_COL_ + 1);
  referCtx.dataCols = exportDataCols_(referCtx, recordWidth);
  if(headerRows.length > 0) {
    let mappedHeaders = [];
    for(let i=0; i<headerRows.length; i++) {
      mappedHeaders.push(remapHeaderRow_(headerRows[i], referCtx));
    }
    newSheet.getRange(1, 1, mappedHeaders.length, mappedHeaders[0].length).setValues(mappedHeaders);
  }
  let resultArr = [];
  // 依主鍵一次分組（原本對每個主鍵各掃一次全表是 O(K×N)），injectRefer 的查表索引也一次建好
  let grouped = _.groupBy(recordArr, (row) => { return row[2].toString(); });
  let pirmaryKeys = _.keys(grouped);
  logger(sheetData[0].toString(), "原始資料有" + recordArr.length + "行，計算唯一值之後可以輸出" + pirmaryKeys.length + "行", listSS);
  let dupMsgs = [];
  for(let i=0; i<pirmaryKeys.length; i++) {
    let sameKey = grouped[pirmaryKeys[i]];
    if(sameKey.length > 1) {
      dupMsgs.push(pirmaryKeys[i] + "填了" + sameKey.length + "次");
      let orderedRows = _.orderBy(sameKey, (key) => { return key[0] }, ['desc']);
      if(uniquePrimary) {
        resultArr.push(injectRefer(pirmaryKeys[i], referCtx, orderedRows[0]));
      } else {
        for(let k=0; k<orderedRows.length; k++) {
          resultArr.push(injectRefer(pirmaryKeys[i], referCtx, orderedRows[k]));
        }
      }
    } else if(sameKey.length === 1) {
      resultArr.push(injectRefer(pirmaryKeys[i], referCtx, sameKey[0]));
    }
  }
  if(dupMsgs.length > 0) {
    // 彙總成一筆 log（原本每個重複主鍵 appendRow 一次，重複的人多時 API 開銷線性成長）
    logger(sheetData[0].toString(), "有" + dupMsgs.length + "人重複填答，程式取最後一次填寫：" + dupMsgs.join("、"), listSS);
  }
  resultArr = _.orderBy(resultArr, (key) => { return key[0] }, ['asc']);
  if(resultArr.length > 0) {
    let lengthnotMatch = 0;
    for(let i=0; i<resultArr.length; i++) {
      let time = new Date(resultArr[i][0]);
      resultArr[i][0] = time.toLocaleString();
    }
    let maxRow = resultArr[0].length;
    for(let i=0; i<resultArr.length; i++) {
      if(resultArr[i].length > maxRow) {
        maxRow = resultArr[i].length;
      }
    }
    for(let i=0; i<resultArr.length; i++) {
      if(resultArr[i].length < maxRow) {
        lengthnotMatch++;
        let diff = maxRow - resultArr[i].length;
        for(let k=0; k<diff; k++) {
          resultArr[i].push("");
        }
      }
    }
    // 簽名格補滿之後每列本來就同寬，這裡只是最後一道防線；真的大於 0 代表寫入表結構
    // 有預期外的狀況（欄數不一致），不再是「簽名檔遺失」那種常態
    logger(sheetData[0].toString(), "長度對不起來的資料有" + lengthnotMatch + "條，如果大於0代表寫入表的欄數不一致，請檢查資料和程式碼是否正確", listSS);
    let newRange = newSheet.getRange(headerCount + 1,1,resultArr.length, maxRow);
    newRange.setValues(resultArr);
    SpreadsheetApp.flush();
    let end = (new Date()).getTime();
    logger(sheetData[0].toString(), "輸出完成！耗時" + (end - start) / 1000 + "秒，總共輸出" + resultArr.length + "行", listSS);
    return {
      ok: true,
      message: "輸出完成",
      sourceCount: recordArr.length,
      rowCount: resultArr.length,
      lengthMismatch: lengthnotMatch,
      elapsed: (end - start) / 1000,
      fileId: newSS.getId(),
      url: newSS.getUrl(),
      sheetName: sheetName,
      folderName: destFolder.getName()
    };
  }
  // 空表也把分頁留著（有標題列），代表「這次跑過但沒資料」
  return { ok: false, message: "沒有可輸出的資料（扣掉標題列後是空的）", sourceCount: 0, rowCount: 0, lengthMismatch: 0, elapsed: ((new Date()).getTime() - start) / 1000, fileId: newSS.getId(), url: newSS.getUrl(), sheetName: sheetName, folderName: destFolder.getName() };
}

// injectRefer 的查表索引，整場匯出建一次（原本每列重掃 headers、每列全掃名冊）：
// pKeyPos＝主鍵欄位置；referMap＝主鍵值→名冊列（重複主鍵取第一列，與舊行為一致）；
// headerByPos＝pos→欄位設定
function buildReferContext_(headers, referArr) {
  let pKeyHeaders = _.filter(headers, (h) => { return /P/.test(h.type); });
  let ctx = {
    headers: headers,
    pKeyPos: pKeyHeaders.length > 0 ? pKeyHeaders[0].pos : -1,
    referMap: {},
    headerByPos: {}
  };
  for(let i=0; i<headers.length; i++) {
    ctx.headerByPos[headers[i].pos] = headers[i];
  }
  if(ctx.pKeyPos > -1) {
    for(let i=0; i<referArr.length; i++) {
      let key = referArr[i][ctx.pKeyPos].toString();
      if(!(key in ctx.referMap)) { ctx.referMap[key] = referArr[i]; }
    }
  }
  return ctx;
}

// Drive 檔案連結用固定格式拼接、不打 DriveApp API（open?id= 會自動轉址到正確的檢視器）。
// 檔案遺失時輸出的連結點開是 404，但匯出不會中斷（舊版 getFileById 遇壞檔會整場炸掉）
function driveFileUrl_(fileID) {
  return "https://drive.google.com/open?id=" + fileID;
}

// 紀錄表固定欄：0 送出時間／1 有效／2 主鍵／3 簽名檔ID／4 分組，題目答案從 5 起
const DATA_FROM_ = 5;
const SIG_COL_ = 3;

// 輸出時要保留的來源欄索引（題目區）：對照表單有設定就只留有設定的欄
// （type 不在 /G|O|C|A|P|F/ 的欄不輸出），沒設定（degenerate）就整段原樣輸出。
// 表頭與資料列共用這份索引，才不會因為「資料丟欄、表頭沒丟」而錯位。
function exportDataCols_(ctx, width) {
  let cols = [];
  let filtered = ctx.headers.length > 0;
  for(let k=DATA_FROM_; k<width; k++) {
    if(!filtered || ctx.headerByPos[k - DATA_FROM_] !== undefined) { cols.push(k); }
  }
  return cols;
}

// 把紀錄表的標題列改成輸出用排法：固定欄拿掉簽名檔ID（值改由後面的 URL 欄承接）、
// 插入 sigCount 個簽名欄、題目區只留 dataCols。有寫東西的那一列（欄位名稱列）給
// 「簽名檔連結N」，其餘（欄位ID列）留空。
function remapHeaderRow_(headerRow, ctx) {
  let cell = (i) => { return headerRow[i] === undefined ? "" : headerRow[i]; };
  let mapped = [cell(0), cell(1), cell(2), cell(4)];
  let labeled = cell(SIG_COL_).toString().trim() !== "";
  for(let k=0; k<ctx.sigCount; k++) {
    mapped.push(labeled ? "簽名檔連結" + (k + 1) : "");
  }
  for(let k=0; k<ctx.dataCols.length; k++) {
    mapped.push(cell(ctx.dataCols[k]));
  }
  return mapped;
}

function injectRefer(key, ctx, row) { //根據簽名挪移位置，然後把檔案ID轉換成url
  // 名冊回填：主鍵查得到才做（查不到就照填答者原本填的值輸出），
  // 但排法一律走同一套——原本查不到名冊會整列吐紀錄表的原始排法，混在輸出裡欄位全錯開
  if(ctx.pKeyPos > -1) {
    let referRow = ctx.referMap[key];
    if(referRow !== undefined) {
      for(let i=0; i<ctx.headers.length; i++) {
        let h = ctx.headers[i];
        if(!/F/.test(h.type)) {
          row[DATA_FROM_ + h.pos] = /L|N|M|P|G/.test(h.format) ? "📝" + referRow[h.pos].toString() : referRow[h.pos].toString();
        }
      }
    }
  }
  let cell = (i) => { return row[i] === undefined ? "" : row[i]; };
  let returnRow = [cell(0), cell(1), cell(2), cell(4)];
  let signatures = cell(SIG_COL_).toString() === "" ? [] : cell(SIG_COL_).toString().split(";");
  // 固定補滿 sigCount 格：少簽的人補「無簽名」，不再讓後面的答案整排往左縮
  for(let k=0; k<ctx.sigCount; k++) {
    let sig = k < signatures.length ? signatures[k].toString().trim() : "";
    returnRow.push(sig !== "" ? driveFileUrl_(sig) : "無簽名");
  }
  for(let i=0; i<ctx.dataCols.length; i++) {
    let k = ctx.dataCols[i];
    let columnConfig = ctx.headerByPos[k - DATA_FROM_];
    if(columnConfig !== undefined && /F/.test(columnConfig.type) && /F/.test(columnConfig.format)) {
      returnRow.push(cell(k).toString() !== "" ? driveFileUrl_(cell(k).toString()) : "無檔案");
    } else {
      returnRow.push(cell(k).toString());
    }
  }
  return returnRow;
}

// ===== 功能 7：定時匯出 =====
// 「定時匯出」分頁一列一條排程，管理者自行掛時間觸發器跑 scheduledExport()（建議凌晨；
// 程式不自建 trigger，比照 Code.js 的 rebuildDraftSpreadsheet／scanLoginLog）。
// 每次觸發逐列判斷「頻率到了嗎」「上次匯出後有沒有新填答」，兩者都成立才真的匯出，
// 匯完把時間／行數／結果回寫該列並寄通知信。H~K 欄由程式回寫，人不要手動改。

const SCHEDULE_HEADER_ = [
  "問卷列號", "問卷名稱（比對用）", "匯出頻率（幾天一次）", "匯出截止（日期或毫秒timestamp）",
  "通知Email（多筆用;分隔）", "標題列數（留空＝2）", "只留最新一筆（是/否）",
  "上次匯出時間（程式回寫）", "上次輸出行數（程式回寫）", "上次結果（程式回寫）", "排程狀態（程式回寫）"
];
const SCHEDULE_DONE_ = "已結束";
// 停用＝人為喊停（禁刪列規範下不刪列，改用狀態欄；對話框按儲存即可恢復）
const SCHEDULE_PAUSED_ = "已停用";
const DAY_MS_ = 24 * 60 * 60 * 1000;
// 頻率比對的寬限：排程固定凌晨跑，上次若是 03:00:05、今天 03:00:00 差一點點不到整日，
// 沒有寬限就會被判「還沒到」而整天順延（每天漂移一次，最後排程等於停擺）
const SCHEDULE_SLACK_MS_ = 60 * 60 * 1000;
// 一次觸發最多跑這麼久就收工（GAS 單次執行上限 6 分鐘），沒輪到的排程留到下次觸發
const SCHEDULE_MAX_RUN_MS_ = 4.5 * 60 * 1000;

// 時間值寬鬆解析：設定表是給人填的（Sheets 日期選擇器會存成 Date 物件），
// 但落地與比較一律換算成 ms timestamp（全系統慣例）
function toMs_(value) {
  if (value === null || value === undefined) { return null; }
  if (value instanceof Date) {
    let ms = value.getTime();
    return isNaN(ms) ? null : ms;
  }
  if (typeof value === "number") { return isNaN(value) ? null : value; }
  let text = value.toString().trim();
  if (text === "") { return null; }
  if (/^\d+$/.test(text)) { return parseInt(text); }
  let parsed = (new Date(text)).getTime();
  return isNaN(parsed) ? null : parsed;
}

// 紀錄表的填答概況：{count, latestMs}。只讀送出時間欄（A），不整張撈——
// 判斷「有沒有新填答」不需要全表，真的要匯出時 runExport_ 才會完整讀
function recordActivity_(recordSSID, headerCount) {
  let sheet;
  try {
    sheet = SpreadsheetApp.openById(recordSSID).getSheets()[0];
  } catch {
    return null;
  }
  let count = sheet.getLastRow() - headerCount;
  if (count <= 0) { return { count: 0, latestMs: null }; }
  let stamps = sheet.getRange(headerCount + 1, 1, count, 1).getValues();
  let latestMs = null;
  for (let i = 0; i < stamps.length; i++) {
    let ms = toMs_(stamps[i][0]);
    if (ms !== null && (latestMs === null || ms > latestMs)) { latestMs = ms; }
  }
  return { count: count, latestMs: latestMs };
}

function scheduleTime_(ms) {
  return Utilities.formatDate(new Date(ms), "GMT+8", "yyyy/MM/dd HH:mm");
}

function parseRecipients_(emailField) {
  return _.filter(emailField.toString().split(/[;,\s]+/), (mail) => { return mail.trim() !== ""; });
}

// 通知信裡有檔案連結，收件者沒權限點開只會看到「你需要存取權」——匯完自動補上檢視權。
// 已經是擁有者／編輯者／檢視者的人跳過（不重複授權、也不降權）。回傳結果描述
function ensureViewerAccess_(fileID, recipients) {
  if (recipients.length === 0) { return ""; }
  let file;
  try {
    file = DriveApp.getFileById(fileID);
  } catch (e) {
    return "，檢視權確認失敗（" + e.message + "）";
  }
  let known = {};
  try {
    let existing = file.getViewers().concat(file.getEditors());
    for (let i = 0; i < existing.length; i++) {
      known[existing[i].getEmail().toLowerCase()] = true;
    }
    let owner = file.getOwner();
    if (owner !== null) { known[owner.getEmail().toLowerCase()] = true; }
  } catch (e) {
    // 共用雲端硬碟等情境讀不到完整權限清單，就直接嘗試授權（addViewer 對已有權限者無副作用）
    console.log("讀取既有權限失敗，改為直接授權：" + e.message);
  }
  let added = [];
  let failed = [];
  for (let i = 0; i < recipients.length; i++) {
    if (known[recipients[i].toLowerCase()] === true) { continue; }
    try {
      file.addViewer(recipients[i]);
      added.push(recipients[i]);
    } catch (e) {
      failed.push(recipients[i] + "（" + e.message + "）");
    }
  }
  let note = "";
  if (added.length > 0) { note += "，已開檢視權給 " + added.length + " 人"; }
  if (failed.length > 0) { note += "，這些人開權限失敗需手動處理：" + failed.join("、"); }
  return note;
}

// 通知信：只給統計與連結，不放任何填答內容（信件不是輸出通路）。回傳寄送結果描述
function sendScheduleMail_(recipients, formName, result, finalRun, nextMs) {
  if (recipients.length === 0) { return "（沒填通知Email，未寄信）"; }
  let subject = "【問卷定時匯出】" + formName + (finalRun ? "（排程結束・最後一次匯出）" : "");
  let lines = [
    "問卷：" + formName,
    "匯出時間：" + scheduleTime_((new Date()).getTime()),
    ""
  ];
  if (result.ok) {
    lines.push("原始資料 " + result.sourceCount + " 行，輸出 " + result.rowCount + " 行");
    if (result.lengthMismatch > 0) {
      lines.push("其中 " + result.lengthMismatch + " 行長度與其他人對不起來（可能是簽名檔遺失），請打開檔案確認");
    }
    lines.push("輸出分頁：" + result.sheetName + "（放在最前面）");
    lines.push("檔案連結：" + result.url);
    lines.push("");
    lines.push("提醒：數字欄前面的「📝」是為了避免開頭的 0 被吃掉，使用前請自行去除。");
  } else {
    lines.push("這次沒有可輸出的資料：" + result.message);
  }
  lines.push("");
  lines.push(finalRun
    ? "本次為排程截止前的最後一次匯出，之後不會再自動匯出（要繼續請調整「定時匯出」分頁的截止時間並清掉「排程狀態」欄）。"
    : "下次預定匯出時間：" + scheduleTime_(nextMs) + "（若期間沒有新填答則自動略過）");
  try {
    MailApp.sendEmail(recipients.join(","), subject, lines.join("\n"));
    return "已通知 " + recipients.length + " 個信箱";
  } catch (e) {
    return "通知信寄送失敗：" + e.message;
  }
}

// 單條排程的處理。回傳 {status: exported|skip|error, message}
function runScheduleRow_(listSS, scheduleSheet, row, rowIndex) {
  // 使用者若把右邊幾欄整個留白，getDataRange 讀回來的列會比表頭短，補齊避免 undefined
  while (row.length < SCHEDULE_HEADER_.length) { row.push(""); }
  let listRowIndex = parseInt(row[0]);
  let registeredName = row[1].toString().trim();
  // 整列空白＝使用者還沒填，安靜跳過
  if (isNaN(listRowIndex) && registeredName === "" && row[4].toString().trim() === "") {
    return { status: "skip", message: "" };
  }
  let note = function (text) {
    scheduleSheet.getRange(rowIndex, 10).setValue(scheduleTime_((new Date()).getTime()) + " " + text);
  };
  let listSheet = listSS.getSheetByName(LIST_SHEET_NAME);
  if (isNaN(listRowIndex) || listRowIndex < 2 || listRowIndex > listSheet.getLastRow()) {
    note("問卷列號「" + row[0].toString() + "」不是有效的列號，這條排程沒有執行");
    return { status: "error", message: "列號無效" };
  }
  let sheetData = listSheet.getRange(listRowIndex, 1, 1, 15).getValues()[0];
  let actualName = sheetData[0].toString().trim();
  if (actualName === "") {
    note("問卷列表第 " + listRowIndex + " 列沒有表單名稱，這條排程沒有執行");
    return { status: "error", message: "指到空列" };
  }
  // 列號認人的代價：列表一排序／插刪列就會指到別份問卷。用登記的名稱當防呆，
  // 對不上寧可停手也不要自動匯錯卷（名稱空白＝第一次跑，順手補登記）
  if (registeredName === "") {
    scheduleSheet.getRange(rowIndex, 2).setValue(actualName);
  } else if (registeredName !== actualName) {
    note("問卷列表第 " + listRowIndex + " 列現在是「" + actualName + "」，與登記的「" + registeredName + "」對不上（列表可能被排序或插刪列），這條排程已停手，請修正列號後再清掉本欄");
    return { status: "error", message: "列號與登記名稱對不上" };
  }
  let nowMs = (new Date()).getTime();
  let status = row[10].toString().trim();
  if (status === SCHEDULE_PAUSED_) { return { status: "skip", message: "已停用" }; }
  let finished = status === SCHEDULE_DONE_;
  let deadlineMs = toMs_(row[3]);
  let finalRun = false;
  if (deadlineMs !== null && nowMs >= deadlineMs) {
    if (finished) { return { status: "skip", message: "排程已結束" }; }
    // 截止後補做最後一次收尾匯出：不看頻率、也不看有沒有新填答
    finalRun = true;
  } else if (finished) {
    // 截止時間被往後改了就自動復活
    scheduleSheet.getRange(rowIndex, 11).setValue("");
  }
  let everyDays = parseInt(row[2]);
  if (isNaN(everyDays) || everyDays < 1) { everyDays = 1; }
  let lastMs = toMs_(row[7]);
  if (!finalRun && lastMs !== null && nowMs - lastMs < everyDays * DAY_MS_ - SCHEDULE_SLACK_MS_) {
    return { status: "skip", message: "還沒到下次匯出時間" };
  }
  let headerCount = parseInt(row[5]);
  if (isNaN(headerCount) || headerCount < 0) { headerCount = 2; }
  let uniquePrimary = row[6].toString().trim() !== "否";
  let activity = recordActivity_(sheetData[2].toString().trim(), headerCount);
  if (activity === null) {
    note("打不開這份問卷的填入表（C 欄的新表單ID），這條排程沒有執行");
    return { status: "error", message: "填入表打不開" };
  }
  let lastCount = parseInt(row[8]);
  let hasNew = lastMs === null
    || activity.count > (isNaN(lastCount) ? -1 : lastCount)
    || (activity.latestMs !== null && activity.latestMs > lastMs);
  if (activity.count === 0) {
    if (!finalRun) { return { status: "skip", message: "還沒有任何填答" }; }
  } else if (!finalRun && !hasNew) {
    return { status: "skip", message: "上次匯出後沒有新填答" };
  }
  let result;
  try {
    result = runExport_(listSS, sheetData, { headerCount: headerCount, uniquePrimary: uniquePrimary });
  } catch (e) {
    note("匯出失敗：" + e.message);
    logger(actualName, "定時匯出失敗：" + e.message, listSS);
    return { status: "error", message: e.message };
  }
  let recipients = parseRecipients_(row[4]);
  // 先補權限再寄信：信到的時候連結就點得開
  let accessNote = ensureViewerAccess_(result.fileId, recipients);
  let mailNote = sendScheduleMail_(recipients, actualName, result, finalRun, nowMs + everyDays * DAY_MS_);
  let summary = scheduleTime_(nowMs) + " " +
    (result.ok ? "輸出 " + result.rowCount + " 行（原始 " + result.sourceCount + " 行）" : result.message) +
    accessNote + "，" + mailNote;
  // H~K 一次寫回：上次匯出時間（ms）／上次輸出行數／結果描述／排程狀態
  scheduleSheet.getRange(rowIndex, 8, 1, 4).setValues([[
    nowMs,
    activity.count,
    summary,
    finalRun ? SCHEDULE_DONE_ : ""
  ]]);
  logger(actualName, "定時匯出：" + summary, listSS);
  return { status: result.ok ? "exported" : "skip", message: summary };
}

// 觸發器入口：管理者在 Apps Script 編輯器手動掛「時間驅動」觸發器指向這支
function scheduledExport() {
  let listSS = SpreadsheetApp.getActiveSpreadsheet();
  let scheduleSheet = listSS.getSheetByName(SCHEDULE_SHEET_NAME);
  if (scheduleSheet === null) {
    console.log("沒有「" + SCHEDULE_SHEET_NAME + "」設定分頁，定時匯出略過");
    return { done: 0, skipped: 0, failed: 0, pending: 0, message: "沒有設定分頁" };
  }
  let lock = LockService.getScriptLock();
  if (!lock.tryLock(30000)) {
    console.log("上一輪定時匯出還在跑，本次略過");
    return { done: 0, skipped: 0, failed: 0, pending: 0, message: "前一輪還在跑" };
  }
  try {
    let startMs = (new Date()).getTime();
    let rows = scheduleSheet.getDataRange().getValues();
    let done = 0;
    let skipped = 0;
    let failed = 0;
    let pending = 0;
    for (let i = 1; i < rows.length; i++) {
      if ((new Date()).getTime() - startMs > SCHEDULE_MAX_RUN_MS_) {
        pending = rows.length - i;
        break;
      }
      let outcome;
      try {
        outcome = runScheduleRow_(listSS, scheduleSheet, rows[i], i + 1);
      } catch (e) {
        // 單列炸掉不能拖垮整輪
        outcome = { status: "error", message: e.message };
        logger("定時匯出", "第 " + (i + 1) + " 列處理失敗：" + e.message, listSS);
      }
      if (outcome.status === "exported") { done++; }
      else if (outcome.status === "error") { failed++; }
      else { skipped++; }
    }
    let summary = "本輪結束：匯出 " + done + " 條、略過 " + skipped + " 條、失敗 " + failed + " 條" +
      (pending > 0 ? "、時間不夠順延 " + pending + " 條到下次觸發" : "");
    logger("定時匯出", summary, listSS);
    return { done: done, skipped: skipped, failed: failed, pending: pending, message: summary };
  } finally {
    lock.releaseLock();
  }
}

// 設定分頁存取：不存在就建好表頭（人不必自己開分頁、不必知道欄位順序）
function ensureScheduleSheet_(listSS) {
  let sheet = listSS.getSheetByName(SCHEDULE_SHEET_NAME);
  if (sheet !== null) { return sheet; }
  sheet = listSS.insertSheet(SCHEDULE_SHEET_NAME);
  sheet.appendRow(SCHEDULE_HEADER_);
  sheet.getRange(1, 1, 1, SCHEDULE_HEADER_.length).setFontWeight("bold");
  sheet.setFrozenRows(1);
  sheet.setColumnWidths(1, SCHEDULE_HEADER_.length, 150);
  return sheet;
}

// 選單：開排程對話框（問卷用下拉選、時間用日曆選——列號與 timestamp 都不必手打）
function openScheduleDialog() {
  let html = HtmlService.createHtmlOutput(scheduleDialogHtml_(scheduleDialogData())).setWidth(560).setHeight(720);
  ui.showModalDialog(html, "定時匯出排程");
}

// 對話框資料：問卷清單（含預設帶入值）＋既有排程（以問卷列號為索引）
function scheduleDialogData() {
  let listSS = SpreadsheetApp.getActiveSpreadsheet();
  let listSheet = listSS.getSheetByName(LIST_SHEET_NAME);
  let listArr = listSheet.getDataRange().getValues();
  let questionnaires = [];
  for (let i = 1; i < listArr.length; i++) {
    let name = listArr[i][0].toString().trim();
    if (name === "") { continue; }
    questionnaires.push({
      listRow: i + 1,
      name: name,
      // 新排程的預設值：截止帶問卷的檢視截止（問卷都看不到了就不用再匯）、
      // 通知信箱帶列上的管理員Email
      defaultDeadlineMs: toMs_(listArr[i][4]),
      defaultEmail: listArr[i][12].toString().trim()
    });
  }
  let schedules = {};
  let scheduleSheet = listSS.getSheetByName(SCHEDULE_SHEET_NAME);
  if (scheduleSheet !== null) {
    let rows = scheduleSheet.getDataRange().getValues();
    for (let i = 1; i < rows.length; i++) {
      let listRow = parseInt(rows[i][0]);
      if (isNaN(listRow)) { continue; }
      schedules[listRow] = {
        scheduleRow: i + 1,
        registeredName: rows[i][1].toString().trim(),
        everyDays: parseInt(rows[i][2]),
        deadlineMs: toMs_(rows[i][3]),
        emails: rows[i][4].toString().trim(),
        headerCount: rows[i][5].toString().trim(),
        unique: rows[i][6].toString().trim() === "否" ? "否" : "是",
        lastExportMs: toMs_(rows[i][7]),
        lastResult: rows[i][9].toString().trim(),
        status: rows[i][10].toString().trim()
      };
    }
  }
  return { questionnaires: questionnaires, schedules: schedules };
}

// 對話框存檔回呼。同一份問卷只會有一列排程（既有就更新，沒有才新增）
function saveScheduleRow(payload) {
  let listSS = SpreadsheetApp.getActiveSpreadsheet();
  let listSheet = listSS.getSheetByName(LIST_SHEET_NAME);
  let listRow = parseInt(payload.listRow);
  if (isNaN(listRow) || listRow < 2 || listRow > listSheet.getLastRow()) {
    return { ok: false, message: "請先選擇要排程的問卷" };
  }
  let name = listSheet.getRange(listRow, 1).getValue().toString().trim();
  if (name === "") {
    return { ok: false, message: "問卷列表第 " + listRow + " 列沒有表單名稱，請重新選擇" };
  }
  let everyDays = parseInt(payload.everyDays);
  if (isNaN(everyDays) || everyDays < 1) {
    return { ok: false, message: "匯出頻率要填 1 以上的整數（1＝每天）" };
  }
  let headerCount = parseInt(payload.headerCount);
  if (payload.headerCount.toString().trim() === "") { headerCount = 2; }
  if (isNaN(headerCount) || headerCount < 0) {
    return { ok: false, message: "標題列數要填 0 以上的整數（留空＝2）" };
  }
  let deadlineMs = toMs_(payload.deadlineMs);
  let emails = _.filter(payload.emails.toString().split(/[;,\s]+/), (mail) => { return mail.trim() !== ""; });
  for (let i = 0; i < emails.length; i++) {
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(emails[i])) {
      return { ok: false, message: "通知Email「" + emails[i] + "」看起來不是有效的信箱" };
    }
  }
  let unique = payload.unique.toString().trim() === "否" ? "否" : "是";
  let scheduleSheet = ensureScheduleSheet_(listSS);
  let rows = scheduleSheet.getDataRange().getValues();
  let targetRow = 0;
  for (let i = 1; i < rows.length; i++) {
    if (parseInt(rows[i][0]) === listRow) { targetRow = i + 1; break; }
  }
  // B 欄（比對用名稱）每次存檔都同步成當下名稱：改過問卷名稱後排程不會因為對不上而停手
  let values = [listRow, name, everyDays, deadlineMs === null ? "" : deadlineMs, emails.join(";"), headerCount, unique];
  if (targetRow === 0) {
    scheduleSheet.appendRow(values.concat(["", "", "", ""]));
    targetRow = scheduleSheet.getLastRow();
  } else {
    scheduleSheet.getRange(targetRow, 1, 1, values.length).setValues([values]);
    // 存檔＝啟用：把「已停用」「已結束」清掉，讓調整過截止時間的排程重新開始跑
    scheduleSheet.getRange(targetRow, 11).setValue("");
  }
  logger(name, "定時匯出排程存檔（設定表第 " + targetRow + " 列，每 " + everyDays + " 天）", listSS);
  return { ok: true, message: "已儲存「" + name + "」的排程（設定表第 " + targetRow + " 列）" };
}

// 停用排程：照禁刪列規範不刪列，只把狀態欄寫成「已停用」（之後存檔即可恢復）
function pauseScheduleRow(listRow) {
  let listSS = SpreadsheetApp.getActiveSpreadsheet();
  let scheduleSheet = listSS.getSheetByName(SCHEDULE_SHEET_NAME);
  if (scheduleSheet === null) { return { ok: false, message: "還沒有任何排程" }; }
  let rows = scheduleSheet.getDataRange().getValues();
  for (let i = 1; i < rows.length; i++) {
    if (parseInt(rows[i][0]) === parseInt(listRow)) {
      scheduleSheet.getRange(i + 1, 11).setValue(SCHEDULE_PAUSED_);
      logger(rows[i][1].toString(), "定時匯出排程已停用（設定表第 " + (i + 1) + " 列）", listSS);
      return { ok: true, message: "已停用這條排程（資料列保留，之後按儲存即可恢復）" };
    }
  }
  return { ok: false, message: "找不到這份問卷的排程" };
}

// 排程對話框 HTML：資料以 JSON 注入（跳脫 < 防 </script> 逃逸），比照設定對話框
function scheduleDialogHtml_(data) {
  let json = JSON.stringify(data).replace(/</g, "\\u003c");
  return '<!DOCTYPE html><html><head><base target="_top"><style>' +
    'body{font-family:Arial,"Microsoft JhengHei",sans-serif;font-size:13px;margin:12px;color:#333}' +
    'label{display:block;margin-top:10px;font-weight:bold}' +
    'input[type=text],input[type=number],input[type=datetime-local],select{width:100%;box-sizing:border-box;padding:5px;margin-top:3px;border:1px solid #bbb;border-radius:3px;font-size:13px}' +
    '.hint{font-weight:normal;color:#888;font-size:12px}' +
    '.row2{display:flex;gap:8px}.row2>div{flex:1}' +
    '#state{margin-top:12px;padding:8px;border-radius:4px;background:#f1f3f4;white-space:pre-wrap;font-size:12px}' +
    '#saveBtn{margin-top:14px;width:100%;padding:9px;background:#1a73e8;color:#fff;border:none;border-radius:4px;font-size:14px;cursor:pointer}' +
    '#pauseBtn{margin-top:8px;width:100%;padding:7px;background:#fff;color:#c5221f;border:1px solid #c5221f;border-radius:4px;font-size:13px;cursor:pointer;display:none}' +
    'button:disabled{opacity:.5}' +
    '#msg{margin-top:8px;white-space:pre-wrap}.err{color:#c5221f}.ok{color:#188038}' +
    '#tip{margin-top:14px;padding:8px;border-radius:4px;background:#e8f0fe;color:#174ea6;font-size:12px;white-space:pre-wrap}' +
    // 可搜尋下拉：問卷一多，原生 select 只能一路捲
    '.combo{position:relative}' +
    '.combo-list{position:absolute;z-index:10;left:0;right:0;max-height:230px;overflow-y:auto;background:#fff;' +
    'border:1px solid #bbb;border-radius:3px;box-shadow:0 2px 8px rgba(0,0,0,.25);display:none}' +
    '.combo-list div{padding:6px 8px;cursor:pointer;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}' +
    '.combo-list div.active{background:#e8f0fe}' +
    '.combo-list div.empty{color:#888;cursor:default}' +
    '</style></head><body>' +
    '<label>要定時匯出的問卷 <span class="hint">（輸入名稱或列號即時篩選，↑↓ 選擇、Enter 確定）</span>' +
    '<div class="combo"><input type="text" id="pickText" autocomplete="off" placeholder="點這裡搜尋問卷…">' +
    '<div class="combo-list" id="pickList"></div></div></label>' +
    '<div class="row2">' +
    '<div><label>匯出頻率 <span class="hint">（每幾天一次，1＝每天）</span><input type="number" id="everyDays" min="1"></label></div>' +
    '<div><label>標題列數 <span class="hint">（留空＝2）</span><input type="number" id="headerCount" min="0"></label></div>' +
    '</div>' +
    '<label>匯出截止 <span class="hint">（到期會再補做最後一次匯出然後停止；留空＝不設限）</span><input type="datetime-local" id="deadline"></label>' +
    '<label>同一人填多次時 <select id="unique"><option value="是">只輸出最新一筆</option><option value="否">每一筆都輸出</option></select></label>' +
    '<label>通知Email <span class="hint">（多筆用分號分隔，留空＝不寄信）</span><input type="text" id="emails"></label>' +
    '<div id="state"></div>' +
    '<button id="saveBtn">儲存排程</button>' +
    '<button id="pauseBtn">停用這條排程</button>' +
    '<div id="msg"></div>' +
    '<div id="tip">排程存好之後，請到「擴充功能 → Apps Script → 觸發條件」新增一個時間驅動觸發器，' +
    '函式選「scheduledExport」、類型選日期計時器，建議設在凌晨。\n' +
    '每次觸發只有「頻率到了」且「上次匯出後有新填答」才會真的匯出，其餘安靜略過。</div>' +
    '<script>' +
    'var DATA=' + json + ';' +
    'function pad(n){return (n<10?"0":"")+n}' +
    'function msToLocal(ms){if(ms===null||ms===undefined||isNaN(ms)){return ""}var d=new Date(ms);' +
    'return d.getFullYear()+"-"+pad(d.getMonth()+1)+"-"+pad(d.getDate())+"T"+pad(d.getHours())+":"+pad(d.getMinutes())}' +
    'function fmt(ms){if(ms===null||ms===undefined||isNaN(ms)){return "—"}var d=new Date(ms);' +
    'return d.getFullYear()+"/"+pad(d.getMonth()+1)+"/"+pad(d.getDate())+" "+pad(d.getHours())+":"+pad(d.getMinutes())}' +
    'var box=document.getElementById("pickText");' +
    'var list=document.getElementById("pickList");' +
    'var selectedRow=null;var active=-1;' +
    'function label(q){return (DATA.schedules[q.listRow]?"［已排程］":"［未排程］")+" 第"+q.listRow+"列・"+q.name}' +
    'function find(listRow){var found=null;DATA.questionnaires.forEach(function(q){' +
    'if(q.listRow===parseInt(listRow)){found=q}});return found}' +
    // 已選中的項目原樣顯示在輸入框裡，所以「文字剛好等於選中項」時視同沒有關鍵字、列出全部
    'function matches(){var kw=box.value.trim().toLowerCase();' +
    'var picked=find(selectedRow);if(picked!==null&&box.value===label(picked)){kw=""}' +
    'return DATA.questionnaires.filter(function(q){return kw===""||label(q).toLowerCase().indexOf(kw)>-1})}' +
    'function openList(){' +
    '  var items=matches();list.innerHTML="";active=-1;' +
    '  if(items.length===0){var e=document.createElement("div");e.className="empty";e.textContent="沒有符合的問卷";list.appendChild(e)}' +
    '  else{items.forEach(function(q){var d=document.createElement("div");d.textContent=label(q);' +
    '    d.setAttribute("data-row",q.listRow);' +
    // mousedown 才選：click 之前 input 會先 blur，等到 click 選單已經收起來了
    '    d.addEventListener("mousedown",function(ev){ev.preventDefault();choose(q.listRow)});list.appendChild(d)})}' +
    '  list.style.display="block"}' +
    'function closeList(){list.style.display="none";active=-1}' +
    'function choose(listRow){selectedRow=parseInt(listRow);var q=find(selectedRow);' +
    'box.value=q===null?"":label(q);closeList();load()}' +
    'function setActive(delta){var nodes=list.querySelectorAll("div[data-row]");if(nodes.length===0){return}' +
    '  active=(active+delta+nodes.length)%nodes.length;' +
    '  for(var i=0;i<nodes.length;i++){nodes[i].className=(i===active?"active":"")}' +
    '  nodes[active].scrollIntoView({block:"nearest"})}' +
    'box.addEventListener("focus",openList);' +
    'box.addEventListener("input",openList);' +
    'box.addEventListener("blur",function(){setTimeout(closeList,150)});' +
    'box.addEventListener("keydown",function(ev){' +
    '  if(ev.key==="ArrowDown"){ev.preventDefault();if(list.style.display!=="block"){openList()}setActive(1)}' +
    '  else if(ev.key==="ArrowUp"){ev.preventDefault();setActive(-1)}' +
    '  else if(ev.key==="Enter"){var nodes=list.querySelectorAll("div[data-row]");' +
    '    if(list.style.display==="block"&&nodes.length>0){ev.preventDefault();' +
    '      choose(nodes[active>-1?active:0].getAttribute("data-row"))}}' +
    '  else if(ev.key==="Escape"){closeList()}});' +
    'function load(){' +
    '  var state=document.getElementById("state");' +
    '  var q=find(selectedRow);' +
    '  document.getElementById("msg").textContent="";' +
    '  if(q===null){' +
    '    document.getElementById("saveBtn").disabled=true;' +
    '    document.getElementById("pauseBtn").style.display="none";' +
    '    state.textContent=DATA.questionnaires.length===0' +
    '      ?"「' + LIST_SHEET_NAME + '」裡還沒有任何問卷，請先新增問卷再來設定排程。"' +
    '      :"請在上方搜尋並選擇要排程的問卷（可輸入問卷名稱或列號）。目前共 "+DATA.questionnaires.length+" 份問卷。";' +
    '    return}' +
    '  document.getElementById("saveBtn").disabled=false;' +
    '  var listRow=q.listRow;' +
    '  var s=DATA.schedules[listRow];' +
    '  if(s){' +
    '    document.getElementById("everyDays").value=isNaN(s.everyDays)?1:s.everyDays;' +
    '    document.getElementById("headerCount").value=s.headerCount===""?2:s.headerCount;' +
    '    document.getElementById("deadline").value=msToLocal(s.deadlineMs);' +
    '    document.getElementById("emails").value=s.emails;' +
    '    document.getElementById("unique").value=s.unique;' +
    '    document.getElementById("pauseBtn").style.display=s.status==="已停用"?"none":"";' +
    '    state.textContent="設定表第 "+s.scheduleRow+" 列｜狀態："+(s.status===""?"進行中":s.status)+"\\n"+' +
    '      "上次匯出："+fmt(s.lastExportMs)+"\\n"+(s.lastResult===""?"（還沒有執行紀錄）":s.lastResult);' +
    '  }else{' +
    '    document.getElementById("everyDays").value=1;' +
    '    document.getElementById("headerCount").value=2;' +
    '    document.getElementById("deadline").value=msToLocal(q.defaultDeadlineMs);' +
    '    document.getElementById("emails").value=q.defaultEmail;' +
    '    document.getElementById("unique").value="是";' +
    '    document.getElementById("pauseBtn").style.display="none";' +
    '    state.textContent="這份問卷還沒有排程。截止時間已預設帶入問卷的檢視截止、通知信箱帶入列上的管理員Email，可自行調整。";' +
    '  }' +
    '}' +
    'load();' +
    'document.getElementById("saveBtn").onclick=function(){' +
    '  var msg=document.getElementById("msg");msg.textContent="";msg.className="";' +
    '  var deadline=document.getElementById("deadline").value;' +
    '  var payload={listRow:selectedRow,everyDays:document.getElementById("everyDays").value,' +
    '    headerCount:document.getElementById("headerCount").value,' +
    '    deadlineMs:deadline===""?"":new Date(deadline).getTime(),' +
    '    emails:document.getElementById("emails").value,unique:document.getElementById("unique").value};' +
    '  var btn=this;btn.disabled=true;btn.textContent="儲存中…";' +
    '  google.script.run.withSuccessHandler(function(result){' +
    '    btn.disabled=false;btn.textContent="儲存排程";' +
    '    msg.textContent=result.message;msg.className=result.ok?"ok":"err";' +
    // 存檔後重讀一次資料，讓「［未排程］」標記與上次結果即時更新（選中的問卷維持不變）
    '    if(result.ok){google.script.run.withSuccessHandler(function(fresh){DATA=fresh;' +
    '      var q=find(selectedRow);if(q!==null){box.value=label(q)}' +
    '      load();msg.textContent=result.message;msg.className="ok"}).scheduleDialogData()}' +
    '  }).withFailureHandler(function(err){btn.disabled=false;btn.textContent="儲存排程";' +
    '    msg.textContent="儲存失敗："+err.message;msg.className="err"}).saveScheduleRow(payload);' +
    '};' +
    'document.getElementById("pauseBtn").onclick=function(){' +
    '  if(!confirm("停用後這份問卷就不會再自動匯出（設定資料會保留，之後按儲存即可恢復）。確定嗎？")){return}' +
    '  var msg=document.getElementById("msg");var btn=this;btn.disabled=true;btn.textContent="處理中…";' +
    '  google.script.run.withSuccessHandler(function(result){' +
    '    btn.disabled=false;btn.textContent="停用這條排程";' +
    '    msg.textContent=result.message;msg.className=result.ok?"ok":"err";' +
    '    if(result.ok){btn.style.display="none";' +
    '      google.script.run.withSuccessHandler(function(fresh){DATA=fresh;load();' +
    '        msg.textContent=result.message;msg.className="ok"}).scheduleDialogData()}' +
    '  }).withFailureHandler(function(err){btn.disabled=false;btn.textContent="停用這條排程";' +
    '    msg.textContent="停用失敗："+err.message;msg.className="err"}).pauseScheduleRow(selectedRow);' +
    '};' +
    '</script></body></html>';
}

// 選單：立刻跑一次定時匯出（掛觸發器前先試跑驗證設定）
function runScheduledExportNow() {
  let go = ui.alert("立即試跑定時匯出",
    "會照「" + SCHEDULE_SHEET_NAME + "」分頁的設定跑一輪（頻率沒到或沒有新填答的會略過）。\n要繼續嗎？",
    ui.ButtonSet.YES_NO);
  if (go !== ui.Button.YES) { return; }
  let outcome = scheduledExport();
  ui.alert("定時匯出試跑結果", outcome.message + "\n\n各列詳細結果請看「" + SCHEDULE_SHEET_NAME + "」分頁的「上次結果」欄。", ui.ButtonSet.OK);
}

// ===== 功能 3：檢查問卷格式 =====

// 完整檢查（列設定 → 對照表單 → 紀錄表標題對齊），選單與對話框共用
function runFullCheck_(row) {
  let report = { errors: [], warnings: [] };
  checkListRow_(row, report);
  let referSS = null;
  try {
    referSS = SpreadsheetApp.openById(row[1].toString().trim());
  } catch {
    report.errors.push("B 欄的對照表單ID打不開，後面的欄位檢查無法進行");
  }
  if (referSS !== null) {
    let referReport = checkReferFormat_(referSS);
    report.errors = report.errors.concat(referReport.errors);
    report.warnings = report.warnings.concat(referReport.warnings);
    checkRecordAlignment_(row[2].toString().trim(), referSS, report);
  }
  return report;
}

// 對點選列跑完整檢查（選單入口）
function checkSheetFormat() {
  let listSS = SpreadsheetApp.getActiveSpreadsheet();
  let selected = selectedListRow_(listSS);
  if (selected === null) { return; }
  let report = runFullCheck_(selected.row);
  logger(selected.row[0].toString(), "格式檢查：錯誤 " + report.errors.length + " 條、警告 " + report.warnings.length + " 條", listSS);
  if (report.errors.length === 0 && report.warnings.length === 0) {
    ui.alert("「" + selected.row[0].toString() + "」格式檢查全部通過！");
  } else {
    ui.alert("「" + selected.row[0].toString() + "」格式檢查結果", formatReport_(report), ui.ButtonSet.OK);
  }
}

// 對話框用的檢查回呼（google.script.run）：回純文字報告
function runCheckForRowIndex(rowIndex) {
  let listSS = SpreadsheetApp.getActiveSpreadsheet();
  let row = listSS.getSheetByName(LIST_SHEET_NAME).getRange(rowIndex, 1, 1, 15).getValues()[0];
  let report = runFullCheck_(row);
  logger(row[0].toString(), "格式檢查：錯誤 " + report.errors.length + " 條、警告 " + report.warnings.length + " 條", listSS);
  if (report.errors.length === 0 && report.warnings.length === 0) {
    return "格式檢查全部通過！";
  }
  return formatReport_(report);
}

// 問卷列表單列的設定檢查（布林欄、時間戳）
function checkListRow_(row, report) {
  let boolColumns = [[5, "F 預設修改"], [11, "L 顯示"], [13, "N 開放進入"], [14, "O 亂數出題"]];
  for (let i = 0; i < boolColumns.length; i++) {
    let value = row[boolColumns[i][0]].toString().trim();
    if (value !== "是" && value !== "否" && value !== "") {
      // 各布林欄真值判定不一致（預設修改是「≠否」、其他是「＝是」），非是/否的值行為難料
      report.warnings.push(boolColumns[i][1] + "欄填了「" + value + "」，請改用「是」或「否」（其他值在不同欄位會有相反的解讀）");
    }
  }
  let dueMs = parseInt(row[3].toString().trim());
  let viewMs = parseInt(row[4].toString().trim());
  if (isNaN(dueMs)) { report.errors.push("D 填表截止不是數字（要毫秒 timestamp）"); }
  if (isNaN(viewMs)) { report.errors.push("E 檢視截止不是數字（要毫秒 timestamp）"); }
  if (!isNaN(dueMs) && !isNaN(viewMs) && viewMs < dueMs) {
    report.warnings.push("E 檢視截止早於 D 填表截止，問卷會在還能填的時候就從列表消失");
  }
  if (!isNaN(viewMs) && viewMs < (new Date()).getTime()) {
    report.warnings.push("E 檢視截止已過，這份問卷目前不會出現在前台列表");
  }
}

// type × format 的合法組合（依 Code.js／前端實作整理，見 plan/dataformat.md）
const LEGAL_FORMATS_ = {
  "F": ["T", "X", "N", "I", "M", "E", "P", "L", "S", "U", "F"],
  "A": ["T", "N", "I", "M", "E", "P", "L", "S"],
  "P": ["I", "G", "N", "T", "E", "M"],
  "G": ["G", "N"],
  "C": ["T", "M", "S", "F"]
};

// 對照表單本體檢查：meta 八列＋名冊。回傳 {errors, warnings}
function checkReferFormat_(referSS) {
  let report = { errors: [], warnings: [] };
  let referArr = referSS.getSheets()[0].getDataRange().getValues();
  if (referArr.length < 8) {
    report.errors.push("對照表單只有 " + referArr.length + " 列，前 8 列（ID／名稱／type／format／group／content／must／nullable）是必要結構");
    return report;
  }
  // 逐欄整理 meta
  let columns = [];
  for (let i = 0; i < referArr[0].length; i++) {
    columns.push({
      pos: i,
      colName: columnLetter_(i),
      id: referArr[0][i].toString().trim(),
      name: referArr[1][i].toString().trim(),
      type: referArr[2][i].toString().trim(),
      format: referArr[3][i].toString().trim(),
      group: referArr[4][i].toString().trim(),
      content: referArr[5][i].toString().trim(),
      must: referArr[6][i].toString().trim(),
      nullable: referArr[7][i].toString().trim()
    });
  }
  let activeColumns = _.filter(columns, (column) => {
    return column.id !== "" || column.name !== "" || column.type !== "";
  });
  let allIds = _.map(_.filter(activeColumns, (column) => { return column.id !== ""; }), "id");
  // ID 缺漏與重複（真實案例：填入表出現過同一 ID 兩次）
  let dupIds = _.filter(_.uniq(allIds), (id) => {
    return _.filter(allIds, (item) => { return item === id; }).length > 1;
  });
  for (let i = 0; i < dupIds.length; i++) {
    report.errors.push("欄位 ID「" + dupIds[i] + "」重複出現，紀錄與計算欄引用會對錯欄");
  }
  // 主鍵欄唯一性
  let pkeyColumns = _.filter(activeColumns, (column) => { return /P/.test(column.type); });
  if (pkeyColumns.length === 0) {
    report.errors.push("沒有主鍵欄（type 含 P），問卷無法登入");
  } else if (pkeyColumns.length > 1) {
    report.errors.push("主鍵欄（type 含 P）有 " + pkeyColumns.length + " 個，只能有一個");
  }
  for (let i = 0; i < activeColumns.length; i++) {
    checkColumn_(activeColumns[i], allIds, report);
  }
  // 群組：只有一個成員的群組沒有意義
  let groupNames = _.countBy(_.filter(activeColumns, (column) => {
    return /F/.test(column.type) && column.group !== "";
  }), (column) => {
    return column.group.split(":")[0];
  });
  _.forEach(groupNames, (count, name) => {
    if (count === 1) {
      report.warnings.push("群組「" + name + "」只有一個欄位，「不得全空」的群組檢查等於單欄必填，確認是否漏編其他欄");
    }
  });
  checkRoster_(referArr, pkeyColumns, report);
  return report;
}

// 單一欄位的 meta 檢查
function checkColumn_(column, allIds, report) {
  let label = column.colName + " 欄（" + (column.id !== "" ? column.id : "無ID") + (column.name !== "" ? "・" + column.name : "") + "）";
  if (column.id === "") {
    report.errors.push(label + "第 1 列缺欄位 ID");
  }
  if (column.name === "") {
    report.warnings.push(label + "第 2 列缺欄位名稱");
  }
  if (column.type === "") {
    report.errors.push(label + "第 3 列缺 type");
    return;
  }
  if (!/^[PAOGFC]$/.test(column.type)) {
    report.errors.push(label + "type「" + column.type + "」不在合法集合（P/A/O/G/F/C）");
    return;
  }
  if (column.must !== "" && column.must !== "M") {
    report.warnings.push(label + "第 7 列（must）填了「" + column.must + "」，只有「M」有效");
  }
  // 合法詞彙 ''/N/D/ND（D＝可宣告無資料，Phase 15；後端上線前標了也不炸，只是尚未生效）
  if (column.nullable !== "" && !/^(N|D|ND|DN)$/.test(column.nullable)) {
    report.warnings.push(label + "第 8 列（nullable）填了「" + column.nullable + "」，只有「N」「D」或「ND」有效");
  }
  if (/D/.test(column.nullable) && column.type !== "F") {
    report.warnings.push(label + "「D」（可宣告無資料）只對填寫欄（type F）有意義，" + column.type + " 型欄位標了不會有作用");
  }
  if (column.type === "O") { return; } // O 純輸出欄，format 不參與行為
  let legal = LEGAL_FORMATS_[column.type];
  if (column.format === "") {
    if (column.type !== "O") {
      report.warnings.push(label + "第 4 列缺 format");
    }
    return;
  }
  if (legal.indexOf(column.format) === -1) {
    report.errors.push(label + "type " + column.type + " × format " + column.format + " 不是合法組合（" + column.type + " 只能配 " + legal.join("/") + "）");
    return;
  }
  checkContent_(column, allIds, label, report);
}

// content 參數依 format 的 mini-grammar 檢查
function checkContent_(column, allIds, label, report) {
  let content = column.content;
  let type = column.type;
  let format = column.format;
  if (type === "C") {
    if (format === "S") {
      // 計算欄：欄位ID:倍數;…
      if (content === "") {
        report.errors.push(label + "計算欄（C-S）content 是空的，不知道要加總哪些欄位");
        return;
      }
      let pairs = content.split(";");
      for (let i = 0; i < pairs.length; i++) {
        if (pairs[i] === "") { continue; }
        let pair = pairs[i].split(":");
        // allIds 為 null＝精靈單欄驗證（沒有整卷上下文），跳過引用存在性檢查
        if (allIds !== null && allIds.indexOf(pair[0]) === -1) {
          report.errors.push(label + "計算欄引用了不存在的欄位 ID「" + pair[0] + "」");
        }
        if (pair.length < 2 || isNaN(parseInt(pair[1]))) {
          report.errors.push(label + "計算欄「" + pairs[i] + "」缺倍數或倍數不是數字（格式：欄位ID:倍數）");
        }
      }
    } else if (format === "M") {
      if (content === "") {
        report.warnings.push(label + "說明區塊（C-M）content 是空的，會顯示空白區塊");
      }
    } else if (format === "F") {
      if (content !== "") {
        try {
          DriveApp.getFolderById(content);
        } catch {
          report.warnings.push(label + "檔案檢視（C-F）content 的資料夾 ID 打不開（沒權限或不存在）");
        }
      }
    }
    return;
  }
  // 以下 type 為 F/A/P
  if (format === "T") {
    if (content !== "") {
      let parts = content.split("::");
      if (parts.length < 2) {
        report.errors.push(label + "文字欄 content 有值但沒有「提示::正則」的 :: 分隔");
        return;
      }
      try {
        new RegExp(parts[1]);
      } catch (e) {
        report.errors.push(label + "文字欄的正則寫壞了：" + e.message);
      }
    }
  } else if (format === "X") {
    let parts = content.split(";");
    if (parts.length !== 4) {
      report.errors.push(label + "長文字欄 content 要四段「最長;最少;最小列;最大列」，目前是「" + content + "」");
    } else {
      for (let i = 0; i < 4; i++) {
        if (parts[i] !== "" && isNaN(parseInt(parts[i]))) {
          report.errors.push(label + "長文字欄 content 第 " + (i + 1) + " 段「" + parts[i] + "」不是數字");
        }
      }
    }
  } else if (format === "N") {
    if (content !== "" && isNaN(parseInt(content))) {
      report.errors.push(label + "數字欄 content 要是長度數字或「0」，目前是「" + content + "」");
    }
  } else if (format === "L") {
    let parts = content.split(";");
    if (parts.length !== 3 || isNaN(parseInt(parts[0])) || isNaN(parseInt(parts[1])) || isNaN(parseInt(parts[2]))) {
      report.errors.push(label + "滑桿欄 content 要三段數字「步進;最小;最大」，目前是「" + content + "」");
    } else if (parseInt(parts[1]) >= parseInt(parts[2])) {
      report.errors.push(label + "滑桿欄最小值 " + parts[1] + " 沒有小於最大值 " + parts[2]);
    }
  } else if (format === "P") {
    let parts = content.split(";");
    if (parts.length < 2 || isNaN(parseInt(parts[0]))) {
      report.errors.push(label + "郵遞區號欄 content 要「碼數;地址欄位ID,ID,…」，目前是「" + content + "」");
    } else {
      let refIds = parts[1].split(",");
      for (let i = 0; i < refIds.length; i++) {
        if (allIds !== null && refIds[i].trim() !== "" && allIds.indexOf(refIds[i].trim()) === -1) {
          report.errors.push(label + "郵遞區號欄引用了不存在的地址欄位 ID「" + refIds[i].trim() + "」");
        }
      }
    }
  } else if (format === "S") {
    // 空＝自動取名冊唯一值當選項，合法；有值則檢查選項非空
    if (content !== "") {
      let options = _.filter(content.split(";"), (option) => { return option !== ""; });
      if (options.length === 0) {
        report.errors.push(label + "下拉欄 content 有值但解析不出任何選項");
      }
    }
  } else if (format === "U") {
    let parts = content.split("::");
    if (parts.length < 2) {
      report.errors.push(label + "多選欄 content 缺「數量::選項」的 :: 分隔，目前是「" + content + "」");
    } else {
      if (parts[0] !== "" && isNaN(parseInt(parts[0]))) {
        report.errors.push(label + "多選欄的數量「" + parts[0] + "」不是數字（留空＝不限）");
      }
      let options = _.filter(parts[1].split(";"), (option) => { return option !== ""; });
      if (options.length === 0) {
        report.errors.push(label + "多選欄解析不出任何選項");
      } else if (options.length !== _.uniq(options).length) {
        report.warnings.push(label + "多選欄有重複的選項（前端會自動去重，但建議清掉）");
      }
    }
  } else if (format === "F") {
    let parts = content.split(";");
    if (content === "") {
      report.warnings.push(label + "檔案上傳欄 content 是空的（不限類型與大小），確認是否刻意");
    } else if (parts.length !== 4) {
      report.errors.push(label + "檔案上傳欄 content 要四段「類型說明;副檔名;大小MB;範例檔fileID」，目前有 " + parts.length + " 段");
    } else {
      if (parts[2] !== "" && isNaN(parseInt(parts[2]))) {
        report.errors.push(label + "檔案上傳欄的大小上限「" + parts[2] + "」不是數字");
      }
      if (parts[3] !== "") {
        try {
          DriveApp.getFileById(parts[3]);
        } catch {
          report.warnings.push(label + "檔案上傳欄的範例檔 fileID 打不開（沒權限或不存在）");
        }
      }
    }
  }
}

// 名冊列檢查：主鍵重複／缺漏、Excel 錯誤值殘留
function checkRoster_(referArr, pkeyColumns, report) {
  let excelError = /^#(N\/A|REF!|VALUE!|DIV\/0!|NAME\?|NULL!|NUM!|ERROR!)/;
  let pkeyPos = pkeyColumns.length === 1 ? pkeyColumns[0].pos : -1;
  let pkeyValues = [];
  let rosterCount = 0;
  for (let i = 8; i < referArr.length; i++) {
    let row = referArr[i];
    let hasValue = _.some(row, (cell) => { return cell.toString().trim() !== ""; });
    if (!hasValue) { continue; }
    rosterCount++;
    for (let k = 0; k < row.length; k++) {
      if (excelError.test(row[k].toString().trim())) {
        report.errors.push("名冊第 " + (i + 1) + " 列 " + columnLetter_(k) + " 欄殘留 Excel 錯誤值「" + row[k].toString().trim() + "」（公式帶入失敗），會原樣顯示給填寫者");
      }
    }
    if (pkeyPos > -1) {
      let pkeyValue = row[pkeyPos].toString().trim();
      if (pkeyValue === "") {
        report.warnings.push("名冊第 " + (i + 1) + " 列有資料但主鍵值是空的，這個人無法登入");
      } else if (pkeyValues.indexOf(pkeyValue) > -1) {
        report.errors.push("名冊主鍵值「" + maskValue_(pkeyValue) + "」重複出現（第 " + (i + 1) + " 列），登入會固定對到第一列");
      } else {
        pkeyValues.push(pkeyValue);
      }
    }
  }
  if (rosterCount === 0) {
    report.warnings.push("名冊（第 9 列起）是空的，沒有任何人能登入這份問卷");
  }
}

// 紀錄表標題列（F 欄起的欄位 ID）與對照表單對齊檢查——錯位是最危險的靜默壞法
function checkRecordAlignment_(recordSSID, referSS, report) {
  if (recordSSID === "") {
    report.errors.push("C 欄的新表單ID是空的，沒有地方可以寫入填答");
    return;
  }
  let recordArr;
  try {
    recordArr = SpreadsheetApp.openById(recordSSID).getSheets()[0].getDataRange().getValues();
  } catch {
    report.errors.push("C 欄的新表單ID打不開（沒權限或不存在）");
    return;
  }
  let referIds = [];
  let referArr = referSS.getSheets()[0].getDataRange().getValues();
  for (let i = 0; i < referArr[0].length; i++) {
    if (referArr[0][i].toString().trim() !== "") {
      referIds.push(referArr[0][i].toString().trim());
    }
  }
  if (recordArr.length === 0 || _.every(recordArr[0], (cell) => { return cell.toString().trim() === ""; })) {
    report.warnings.push("紀錄表沒有標題列，人工核對與輸出（標題列數）時要留意");
    return;
  }
  let recordIds = [];
  for (let i = 5; i < recordArr[0].length; i++) {
    if (recordArr[0][i].toString().trim() !== "") {
      recordIds.push(recordArr[0][i].toString().trim());
    }
  }
  if (recordIds.length === 0) {
    report.warnings.push("紀錄表第 1 列 F 欄起沒有欄位 ID，無法核對錯位");
    return;
  }
  if (recordIds.length !== referIds.length) {
    report.errors.push("紀錄表標題有 " + recordIds.length + " 欄、對照表單有 " + referIds.length + " 欄——欄位數不一致，舊紀錄可能已錯位（問卷上線後不要增刪欄位，要改請開新問卷）");
    return;
  }
  for (let i = 0; i < referIds.length; i++) {
    if (recordIds[i] !== referIds[i]) {
      report.errors.push("紀錄表第 " + columnLetter_(i + 5) + " 欄標題是「" + recordIds[i] + "」，對照表單同位置是「" + referIds[i] + "」——欄位順序已對不上，紀錄會寫到錯的欄");
      return;
    }
  }
}

// ===== 功能 4：修改問卷設定 =====

// 對點選列開設定對話框：時間用 datetime-local 日曆選（存回毫秒 timestamp）、
// 布林欄用下拉，不用再手查 timestamp。B/C（對照表單ID/新表單ID）唯讀——
// 換表等於換問卷，請走「新增問卷」。存檔整列覆寫 A~O 共 15 欄（舊「固定ID」欄已刪除）。
function editSheetSettings() {
  let listSS = SpreadsheetApp.getActiveSpreadsheet();
  let selected = selectedListRow_(listSS);
  if (selected === null) { return; }
  let row = selected.row;
  let data = {
    rowIndex: selected.rowIndex,
    name: row[0].toString(),
    refer: row[1].toString(),
    record: row[2].toString(),
    dueMs: parseInt(row[3]),
    viewMs: parseInt(row[4]),
    modify: row[5].toString().trim(),
    signatures: row[6].toString(),
    comment: row[7].toString(),
    loginTip: row[8].toString(),
    submitTip: row[9].toString(),
    loginfailTip: row[10].toString(),
    visible: row[11].toString().trim(),
    email: row[12].toString(),
    writeAllowed: row[13].toString().trim(),
    randomQ: row[14].toString().trim()
  };
  let html = HtmlService.createHtmlOutput(settingsDialogHtml_(data)).setWidth(560).setHeight(780);
  ui.showModalDialog(html, "修改問卷設定：" + data.name);
}

// 對話框存檔回呼（google.script.run 呼叫）。回 {ok, message}
function saveSheetSettings(data) {
  let listSS = SpreadsheetApp.getActiveSpreadsheet();
  let sheet = listSS.getSheetByName(LIST_SHEET_NAME);
  let current = sheet.getRange(data.rowIndex, 1, 1, 15).getValues()[0];
  // 防呆：開視窗到存檔之間列被動過（排序、插刪列）就拒寫，避免寫到別份問卷
  if (current[1].toString().trim() !== data.refer.toString().trim()) {
    return { ok: false, message: "這一列的內容已經變動（對照表單ID對不上），可能有人排序或插刪列，請關閉視窗重新點選" };
  }
  if (data.name.toString().trim() === "") {
    return { ok: false, message: "表單名稱不能是空的" };
  }
  let dueMs = parseInt(data.dueMs);
  let viewMs = parseInt(data.viewMs);
  if (isNaN(dueMs) || isNaN(viewMs)) {
    return { ok: false, message: "截止時間沒有選（兩個時間都必填）" };
  }
  let booleans = [data.modify, data.visible, data.writeAllowed, data.randomQ];
  for (let i = 0; i < booleans.length; i++) {
    if (booleans[i] !== "是" && booleans[i] !== "否") {
      return { ok: false, message: "布林欄位只能是「是」或「否」" };
    }
  }
  let newRow = [
    data.name.toString().trim(),
    current[1],  // B 對照表單ID 唯讀
    current[2],  // C 新表單ID 唯讀
    dueMs,
    viewMs,
    data.modify,
    data.signatures.toString().trim(),
    data.comment.toString(),
    data.loginTip.toString(),
    data.submitTip.toString(),
    data.loginfailTip.toString(),
    data.visible,
    data.email.toString().trim(),
    data.writeAllowed,
    data.randomQ
  ];
  sheet.getRange(data.rowIndex, 1, 1, 15).setValues([newRow]);
  logger(data.name.toString().trim(), "修改問卷設定（列 " + data.rowIndex + "）", listSS);
  return { ok: true, message: "已儲存" };
}

// ===== 輕量 markdown 編輯器（設定對話框與精靈共用） =====
// 工具列插入語法＋近似預覽。實際渲染是 web app 的 marked+DOMPurify（gfm、無 breaks：
// 單一換行不斷行、空行才分段），預覽行為比照；連結只認 http/https。
const MD_EDITOR_CSS_ =
  '.mdbar{display:flex;gap:4px;margin-top:3px}' +
  '.mdbar button{margin:0;padding:2px 8px;background:#eee;color:#333;border:1px solid #ccc;border-radius:3px;font-size:12px;cursor:pointer}' +
  '.mdprev{display:none;border:1px dashed #bbb;border-radius:3px;padding:6px;margin-top:3px;font-size:13px;background:#fafafa;max-height:130px;overflow-y:auto}' +
  '.mdprev h1,.mdprev h2,.mdprev h3{font-size:15px;margin:4px 0}' +
  '.mdprev p{margin:4px 0}.mdprev ul,.mdprev ol{margin:4px 0 4px 20px}';

const MD_EDITOR_JS_ =
  'function mdInline(s){' +
  's=s.replace(/\\*\\*([^*]+)\\*\\*/g,"<strong>$1</strong>");' +
  's=s.replace(/\\*([^*]+)\\*/g,"<em>$1</em>");' +
  's=s.replace(/\\[([^\\]]*)\\]\\((https?:[^\\s)]+)\\)/g,\'<a href="$2" target="_blank">$1</a>\');' +
  'return s}' +
  'function mdRender(src){' +
  'var esc=src.replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;");' +
  'var lines=esc.split(/\\r?\\n/);var html="";var para=[];var list=null;' +
  'function fp(){if(para.length){html+="<p>"+mdInline(para.join(" "))+"</p>";para=[]}}' +
  'function fl(){if(list){html+="<"+list.tag+">";list.items.forEach(function(it){html+="<li>"+mdInline(it)+"</li>"});html+="</"+list.tag+">";list=null}}' +
  'lines.forEach(function(line){' +
  'var h=line.match(/^(#{1,6})\\s+(.*)$/);var ul=line.match(/^[-*]\\s+(.*)$/);var ol=line.match(/^\\d+\\.\\s+(.*)$/);' +
  'if(line.trim()===""){fp();fl()}' +
  'else if(h){fp();fl();var n=Math.min(h[1].length,3);html+="<h"+n+">"+mdInline(h[2])+"</h"+n+">"}' +
  'else if(ul){fp();if(list&&list.tag!=="ul"){fl()}if(!list){list={tag:"ul",items:[]}}list.items.push(ul[1])}' +
  'else if(ol){fp();if(list&&list.tag!=="ol"){fl()}if(!list){list={tag:"ol",items:[]}}list.items.push(ol[1])}' +
  'else{fl();para.push(line)}' +
  '});fp();fl();' +
  'return html===""?\'<span style="color:#999">（沒有內容）</span>\':html}' +
  'function mdWrap(ta,before,after){' +
  'var s=ta.selectionStart,e=ta.selectionEnd,v=ta.value;var sel=v.substring(s,e);' +
  'ta.value=v.substring(0,s)+before+sel+after+v.substring(e);ta.focus();' +
  'ta.selectionStart=s+before.length;ta.selectionEnd=s+before.length+sel.length;' +
  'ta.dispatchEvent(new Event("input"))}' +
  'function mdEditor(id){' +
  'var ta=document.getElementById(id);if(!ta||ta.dataset.md==="1"){return}ta.dataset.md="1";' +
  'var bar=document.createElement("div");bar.className="mdbar";' +
  'var prev=document.createElement("div");prev.className="mdprev";' +
  'var defs=[["粗體","**","**"],["斜體","*","*"],["連結","[","](https://)"],["清單","\\n- ",""],["標題","\\n### ",""]];' +
  'defs.forEach(function(d){var b=document.createElement("button");b.type="button";b.textContent=d[0];' +
  'b.addEventListener("mousedown",function(ev){ev.preventDefault()});' +
  'b.addEventListener("click",function(){mdWrap(ta,d[1],d[2])});bar.appendChild(b)});' +
  'var pb=document.createElement("button");pb.type="button";pb.textContent="預覽";' +
  'pb.addEventListener("mousedown",function(ev){ev.preventDefault()});' +
  'pb.addEventListener("click",function(){' +
  'var on=prev.style.display==="block";prev.style.display=on?"none":"block";' +
  'pb.textContent=on?"預覽":"關閉預覽";if(!on){prev.innerHTML=mdRender(ta.value)}});' +
  'bar.appendChild(pb);' +
  'ta.addEventListener("input",function(){if(prev.style.display==="block"){prev.innerHTML=mdRender(ta.value)}});' +
  'ta.parentNode.insertBefore(bar,ta.nextSibling);ta.parentNode.insertBefore(prev,bar.nextSibling)}';

// 設定對話框的 HTML：資料以 JSON 注入（跳脫 < 防 </script> 逃逸），欄位值由 JS 填入不走字串拼接
function settingsDialogHtml_(data) {
  let json = JSON.stringify(data).replace(/</g, "\\u003c");
  return '<!DOCTYPE html><html><head><base target="_top"><style>' +
    'body{font-family:Arial,"Microsoft JhengHei",sans-serif;font-size:13px;margin:12px;color:#333}' +
    'label{display:block;margin-top:10px;font-weight:bold}' +
    'input[type=text],input[type=datetime-local],textarea,select{width:100%;box-sizing:border-box;padding:5px;margin-top:3px;border:1px solid #bbb;border-radius:3px;font-size:13px}' +
    'textarea{height:44px;resize:vertical}' +
    '.readonly{background:#eee;color:#777}' +
    '.hint{font-weight:normal;color:#888;font-size:12px}' +
    '.row2{display:flex;gap:8px}.row2>div{flex:1}' +
    '#saveBtn{margin-top:16px;width:100%;padding:9px;background:#1a73e8;color:#fff;border:none;border-radius:4px;font-size:14px;cursor:pointer}' +
    '#saveBtn:disabled{background:#9bb8e8}' +
    '#msg{margin-top:8px;color:#c5221f;white-space:pre-wrap}' +
    MD_EDITOR_CSS_ +
    '</style></head><body>' +
    '<label>表單名稱<input type="text" id="name"></label>' +
    '<div class="row2">' +
    '<div><label>填表截止 <span class="hint">（時間照你電腦的時區）</span><input type="datetime-local" id="due"></label></div>' +
    '<div><label>檢視截止<input type="datetime-local" id="view"></label></div>' +
    '</div>' +
    '<div class="row2">' +
    '<div><label>預設修改<select id="modify"><option>是</option><option>否</option></select></label></div>' +
    '<div><label>顯示<select id="visible"><option>是</option><option>否</option></select></label></div>' +
    '<div><label>開放進入<select id="writeAllowed"><option>是</option><option>否</option></select></label></div>' +
    '<div><label>亂數出題<select id="randomQ"><option>是</option><option>否</option></select></label></div>' +
    '</div>' +
    '<label>簽名格 <span class="hint">（多格以 ; 分隔，留空＝不用簽名）</span><input type="text" id="signatures"></label>' +
    '<label>登入前說明 <span class="hint">（支援 markdown）</span><textarea id="loginTip"></textarea></label>' +
    '<label>登入後說明 <span class="hint">（支援 markdown）</span><textarea id="comment"></textarea></label>' +
    '<label>填寫完畢備註語 <span class="hint">（支援 markdown）</span><textarea id="submitTip"></textarea></label>' +
    '<label>登入失敗備註語 <span class="hint">（支援 markdown）</span><textarea id="loginfailTip"></textarea></label>' +
    '<label>管理員Email<input type="text" id="email"></label>' +
    '<label>對照表單ID <span class="hint">（唯讀，換表請走新增問卷）</span><input type="text" id="refer" class="readonly" readonly></label>' +
    '<button id="saveBtn">儲存</button><div id="msg"></div>' +
    '<script>' +
    'var DATA = ' + json + ';' +
    MD_EDITOR_JS_ +
    'function pad(n){return (n<10?"0":"")+n}' +
    'function msToLocal(ms){if(isNaN(ms)||ms===null){return ""}var d=new Date(ms);return d.getFullYear()+"-"+pad(d.getMonth()+1)+"-"+pad(d.getDate())+"T"+pad(d.getHours())+":"+pad(d.getMinutes())}' +
    'var fields=["name","signatures","loginTip","comment","submitTip","loginfailTip","email","refer"];' +
    'fields.forEach(function(f){document.getElementById(f).value=DATA[f]});' +
    'document.getElementById("due").value=msToLocal(DATA.dueMs);' +
    'document.getElementById("view").value=msToLocal(DATA.viewMs);' +
    // 帶入值比照 Code.js 真值判定：modify 空白＝是（≠否 才 false），其餘三欄空白＝否（＝是 才 true）
    'document.getElementById("modify").value=DATA.modify==="否"?"否":"是";' +
    '["visible","writeAllowed","randomQ"].forEach(function(f){document.getElementById(f).value=DATA[f]==="是"?"是":"否"});' +
    '["loginTip","comment","submitTip","loginfailTip"].forEach(mdEditor);' +
    'document.getElementById("saveBtn").onclick=function(){' +
    '  var msg=document.getElementById("msg");msg.textContent="";' +
    '  var due=document.getElementById("due").value;var view=document.getElementById("view").value;' +
    '  if(due===""||view===""){msg.textContent="兩個截止時間都要選";return}' +
    '  var dueMs=new Date(due).getTime();var viewMs=new Date(view).getTime();' +
    '  if(viewMs<dueMs){if(!confirm("檢視截止早於填表截止，問卷會在還能填的時候就從列表消失，確定要這樣存嗎？")){return}}' +
    '  var payload={rowIndex:DATA.rowIndex,refer:DATA.refer,dueMs:dueMs,viewMs:viewMs};' +
    '  ["name","signatures","loginTip","comment","submitTip","loginfailTip","email"].forEach(function(f){payload[f]=document.getElementById(f).value});' +
    '  ["modify","visible","writeAllowed","randomQ"].forEach(function(f){payload[f]=document.getElementById(f).value});' +
    '  var btn=document.getElementById("saveBtn");btn.disabled=true;btn.textContent="儲存中…";' +
    '  google.script.run.withSuccessHandler(function(result){' +
    '    if(result.ok){google.script.host.close()}else{msg.textContent=result.message;btn.disabled=false;btn.textContent="儲存"}' +
    '  }).withFailureHandler(function(err){msg.textContent="儲存失敗："+err.message;btn.disabled=false;btn.textContent="儲存"}).saveSheetSettings(payload);' +
    '};' +
    '</script></body></html>';
}

// ===== 功能 5：欄位輔助精靈 =====

// 生成單一欄位的 8 格 meta（「欄位 EXIF」）：題型用人話選、參數勾一勾，精靈翻譯成
// type×format＋content mini-grammar。輸出 8 行直排文字（貼上 Sheets 自動填直行）；
// 開精靈前有點選問卷列的話，可直接寫入該卷對照表單的下一個空欄。
// 產出前過檢查器同一套 checkColumn_ 驗證，保證檢查器全綠。
function openFieldWizard() {
  let listSS = SpreadsheetApp.getActiveSpreadsheet();
  let context = { referID: "", formName: "" };
  let sheet = listSS.getActiveSheet();
  if (sheet.getName() === LIST_SHEET_NAME) {
    let rowIndex = sheet.getActiveRange().getRow();
    if (rowIndex >= 2) {
      let row = sheet.getRange(rowIndex, 1, 1, 15).getValues()[0];
      if (row[0].toString().trim() !== "" && /^[-\w]+$/.test(row[1].toString().trim())) {
        context.referID = row[1].toString().trim();
        context.formName = row[0].toString().trim();
      }
    }
  }
  let html = HtmlService.createHtmlOutput(wizardDialogHtml_(context)).setWidth(620).setHeight(800);
  ui.showModalDialog(html, context.formName !== "" ? "欄位輔助精靈：" + context.formName : "欄位輔助精靈（未點選問卷列，僅提供複製）");
}

// 精靈驗證回呼：組成 synthetic column 丟檢查器；有問卷上下文就載入既有 ID 做引用與重複檢查
function wizardValidate(payload, referID) {
  let report = { errors: [], warnings: [] };
  let column = {
    pos: 0,
    colName: "（精靈）",
    id: payload.id.toString().trim(),
    name: payload.name.toString().trim(),
    type: payload.type.toString().trim(),
    format: payload.format.toString().trim(),
    group: payload.group.toString().trim(),
    content: payload.content.toString().trim(),
    must: payload.must.toString().trim(),
    nullable: payload.nullable.toString().trim()
  };
  let allIds = null;
  let usesRefs = (column.type !== "C" && column.format === "P") || (column.type === "C" && column.format === "S");
  if (referID !== null && referID !== undefined && referID.toString().trim() !== "") {
    try {
      let referArr = SpreadsheetApp.openById(referID.toString().trim()).getSheets()[0].getDataRange().getValues();
      allIds = [];
      for (let i = 0; i < referArr[0].length; i++) {
        let id = referArr[0][i].toString().trim();
        if (id !== "") { allIds.push(id); }
      }
      if (allIds.indexOf(column.id) > -1) {
        report.warnings.push("欄位 ID「" + column.id + "」已存在於這份問卷，請改 ID（或確認你就是要蓋掉那一欄）");
      }
      allIds.push(column.id);
    } catch {
      allIds = null;
      if (usesRefs) { report.warnings.push("打不開對照表單，引用欄位存在性檢查已略過"); }
    }
  } else if (usesRefs) {
    report.warnings.push("沒有問卷上下文（開精靈前沒點選問卷列），引用欄位存在性檢查已略過");
  }
  checkColumn_(column, allIds, report);
  return report;
}

// 把精靈生成的 8 值寫入對照表單第 1~8 列的下一個空欄
function appendWizardColumn(referID, values) {
  let referSS = SpreadsheetApp.openById(referID);
  let sheet = referSS.getSheets()[0];
  let lastCol = sheet.getLastColumn();
  let col = lastCol + 1;
  if (lastCol > 0) {
    let headerRow = sheet.getRange(1, 1, 1, lastCol).getValues()[0];
    for (let i = 0; i < headerRow.length; i++) {
      if (headerRow[i].toString().trim() === "") { col = i + 1; break; }
    }
  } else {
    col = 1;
  }
  let cells = [];
  for (let i = 0; i < 8; i++) {
    cells.push([values[i] !== undefined && values[i] !== null ? values[i].toString() : ""]);
  }
  sheet.getRange(1, col, 8, 1).setValues(cells);
  logger(referSS.getName(), "欄位精靈寫入 " + columnLetter_(col - 1) + " 欄（" + cells[0][0] + "・" + cells[1][0] + "）", SpreadsheetApp.getActiveSpreadsheet());
  return "已寫入對照表單的 " + columnLetter_(col - 1) + " 欄（" + cells[0][0] + "）";
}

// 精靈對話框 HTML：題型與參數定義都在 client 端，資料注入只有 context（跳脫 <）
function wizardDialogHtml_(context) {
  let json = JSON.stringify(context).replace(/</g, "\\u003c");
  return '<!DOCTYPE html><html><head><base target="_top"><style>' +
    'body{font-family:Arial,"Microsoft JhengHei",sans-serif;font-size:13px;margin:12px;color:#333}' +
    'label{display:block;margin-top:9px;font-weight:bold}' +
    'input[type=text],textarea,select{width:100%;box-sizing:border-box;padding:5px;margin-top:3px;border:1px solid #bbb;border-radius:3px;font-size:13px}' +
    'textarea{height:56px;resize:vertical}' +
    '.hint{font-weight:normal;color:#888;font-size:12px}' +
    '.row2{display:flex;gap:8px}.row2>div{flex:1}' +
    '.flags{display:flex;gap:14px;margin-top:8px;flex-wrap:wrap}.flags label{font-weight:normal;margin:0}' +
    'button{padding:8px 14px;border:none;border-radius:4px;font-size:13px;cursor:pointer;margin-top:10px}' +
    '#genBtn{background:#1a73e8;color:#fff;width:100%}' +
    '#copyBtn,#writeBtn{background:#188038;color:#fff;margin-right:8px}' +
    'button:disabled{opacity:.5}' +
    '#msg{margin-top:8px;white-space:pre-wrap}.err{color:#c5221f}.warn{color:#b05a00}.ok{color:#188038}' +
    '#outWrap{display:none;margin-top:10px;border-top:1px solid #ddd;padding-top:8px}' +
    '#out{height:150px;font-family:monospace}' +
    '#rawWrap{display:none}' +
    MD_EDITOR_CSS_ +
    '</style></head><body>' +
    '<label>題型<select id="preset"></select></label>' +
    '<div class="row2">' +
    '<div><label>欄位 ID <span class="hint">（如 T01，同卷不可重複）</span><input type="text" id="colId"></label></div>' +
    '<div><label>欄位名稱（題目）<input type="text" id="colName"></label></div>' +
    '</div>' +
    '<div id="params"></div>' +
    '<div id="flagsWrap">' +
    '<div class="flags">' +
    '<label><input type="checkbox" id="fMust"> 必填（M）</label>' +
    '<label><input type="checkbox" id="fNull"> 可留白（N）</label>' +
    '<label><input type="checkbox" id="fNone"> 可宣告無資料（D）<span class="hint">需 Phase 15 後端上線後生效</span></label>' +
    '</div>' +
    '<div class="row2">' +
    '<div><label>群組名 <span class="hint">（同群組不得全空，留空＝不編組）</span><input type="text" id="fGroup"></label></div>' +
    '<div class="flags" style="align-items:end"><label><input type="checkbox" id="fUniq"> 群組內值不可重複（:U）</label></div>' +
    '</div>' +
    '</div>' +
    '<button id="genBtn">產生欄位設定（先過格式檢查）</button>' +
    '<div id="msg"></div>' +
    '<div id="outWrap">' +
    '<label>欄位 EXIF（8 行直排）<span class="hint">：點對照表單第 1 列的空欄，Ctrl+V 自動填滿 8 格</span></label>' +
    '<textarea id="out" readonly></textarea>' +
    '<div id="rawWrap"><label class="warn">content 含多行，上面第 6 行是佔位符——請把下面內容單獨貼到該欄第 6 列</label><textarea id="raw" readonly></textarea></div>' +
    '<button id="copyBtn">複製 8 行</button><button id="writeBtn" style="display:none">直接寫入下一個空欄</button>' +
    '</div>' +
    '<script>' +
    'var DATA=' + json + ';' +
    MD_EDITOR_JS_ +
    'var PRESETS=[' +
    '{k:"text",label:"文字（任意）",t:"F",f:"T",p:[]},' +
    '{k:"textContain",label:"文字（必須包含某字）",t:"F",f:"T",p:["containWord"]},' +
    '{k:"textDate",label:"日期（YYYYMMDD）",t:"F",f:"T",p:[]},' +
    '{k:"textRegex",label:"文字（自訂正則）",t:"F",f:"T",p:["hint","regex"]},' +
    '{k:"longtext",label:"長文字",t:"F",f:"X",p:["xMax","xMin","xRows"]},' +
    '{k:"number",label:"數字（固定長度）",t:"F",f:"N",p:["nLen"]},' +
    '{k:"numberZero",label:"數字（0 開頭不限長）",t:"F",f:"N",p:[]},' +
    '{k:"twid",label:"身分證字號",t:"F",f:"I",p:[]},' +
    '{k:"mobile",label:"台灣手機",t:"F",f:"M",p:[]},' +
    '{k:"email",label:"Email",t:"F",f:"E",p:[]},' +
    '{k:"zip",label:"郵遞區號（可自動查詢）",t:"F",f:"P",p:["zipDigits","zipRefs"]},' +
    '{k:"slider",label:"滑桿（整數）",t:"F",f:"L",p:["lStep","lMin","lMax"]},' +
    '{k:"select",label:"下拉選單（固定選項）",t:"F",f:"S",p:["options"]},' +
    '{k:"selectRoster",label:"下拉選單（選項取自名冊）",t:"F",f:"S",p:[]},' +
    '{k:"multi",label:"多選",t:"F",f:"U",p:["uCount","options"]},' +
    '{k:"file",label:"檔案上傳",t:"F",f:"F",p:["fDesc","fExt","fSize","fSample"]},' +
    '{k:"noteMd",label:"說明區塊（markdown）",t:"C",f:"M",p:["markdown"]},' +
    '{k:"calc",label:"計算欄（加總其他欄位）",t:"C",f:"S",p:["calcPairs"]},' +
    '{k:"fileView",label:"檔案檢視（個人化檔案）",t:"C",f:"F",p:["folderId"]},' +
    '{k:"showText",label:"展示名冊文字",t:"C",f:"T",p:[]},' +
    '{k:"pkeyId",label:"主鍵：身分證",t:"P",f:"I",p:[]},' +
    '{k:"pkeyNum",label:"主鍵：數字帳號（定長）",t:"P",f:"N",p:["nLen"]},' +
    '{k:"authNum",label:"認證欄（數字定長）",t:"A",f:"N",p:["nLen"]},' +
    '{k:"authText",label:"認證欄（自訂正則）",t:"A",f:"T",p:["hint","regex"]},' +
    '{k:"output",label:"輸出欄（登入後顯示名冊值）",t:"O",f:"",p:[]},' +
    '{k:"groupCol",label:"分組欄（班級）",t:"G",f:"G",p:[]},' +
    '{k:"groupNo",label:"分組欄（座號比對）",t:"G",f:"N",p:[]}' +
    '];' +
    'var PARAMS={' +
    'containWord:{label:"必須包含的字（含正則特殊符號請改用自訂正則）",kind:"text"},' +
    'hint:{label:"格式提示語（顯示給填寫者）",kind:"text"},' +
    'regex:{label:"正則表達式（不含提示與 :: 分隔）",kind:"text"},' +
    'xMax:{label:"最長字數",kind:"text"},xMin:{label:"最少字數",kind:"text"},xRows:{label:"顯示列數（預設 4）",kind:"text"},' +
    'nLen:{label:"數字長度（幾碼）",kind:"text"},' +
    'zipDigits:{label:"郵遞區號碼數（3 或 6）",kind:"text"},' +
    'zipRefs:{label:"地址欄位 ID（逗號分隔，如 F01,F02,F03）",kind:"text"},' +
    'lStep:{label:"步進",kind:"text"},lMin:{label:"最小值",kind:"text"},lMax:{label:"最大值",kind:"text"},' +
    'options:{label:"選項（每行一個）",kind:"textarea"},' +
    'uCount:{label:"必選數量（留空＝不限）",kind:"text"},' +
    'fDesc:{label:"類型說明（如 PDF或JPG圖檔）",kind:"text"},' +
    'fExt:{label:"允許副檔名（| 分隔，如 pdf|jpg|jpeg）",kind:"text"},' +
    'fSize:{label:"大小上限（MB）",kind:"text"},' +
    'fSample:{label:"範例檔 fileID（可留空）",kind:"text"},' +
    'markdown:{label:"說明內容（markdown）",kind:"textarea"},' +
    'calcPairs:{label:"加總設定（每行「欄位ID:倍數」）",kind:"textarea"},' +
    'folderId:{label:"資料夾 ID（留空＝系統預設儲存區）",kind:"text"}' +
    '};' +
    'var sel=document.getElementById("preset");' +
    'PRESETS.forEach(function(p,i){var o=document.createElement("option");o.value=i;o.textContent=p.label;sel.appendChild(o)});' +
    'function cur(){return PRESETS[parseInt(sel.value)]}' +
    'function renderParams(){' +
    '  var box=document.getElementById("params");box.innerHTML="";' +
    '  cur().p.forEach(function(key){' +
    '    var def=PARAMS[key];var lab=document.createElement("label");lab.textContent=def.label;' +
    '    var inp=document.createElement(def.kind==="textarea"?"textarea":"input");' +
    '    if(def.kind!=="textarea"){inp.type="text"}' +
    '    inp.id="p_"+key;lab.appendChild(inp);box.appendChild(lab);' +
    '    if(key==="markdown"){mdEditor("p_"+key)}' +
    '  });' +
    '  document.getElementById("flagsWrap").style.display=cur().t==="F"?"":"none";' +
    '  document.getElementById("colId").placeholder=(cur().f||"X")+"01";' +
    '  document.getElementById("outWrap").style.display="none";document.getElementById("msg").textContent="";' +
    '}' +
    'sel.onchange=renderParams;renderParams();' +
    'function pv(key){var el=document.getElementById("p_"+key);return el?el.value:""}' +
    'function optLines(text){var parts=text.split(/\\r?\\n/);var out=[];parts.forEach(function(s){s=s.trim();if(s!==""){out.push(s)}});return out.join(";")}' +
    'function buildContent(){' +
    '  var k=cur().k;' +
    '  if(k==="textContain"){var w=pv("containWord").trim();return "必須包含「"+w+"」::"+w}' +
    '  if(k==="textDate"){return "格式：「20230101」::^(19|20)\\\\d{2}(0[1-9]|1[0-2])(0[1-9]|[12]\\\\d|3[01])$"}' +
    '  if(k==="textRegex"||k==="authText"){return pv("hint").trim()+"::"+pv("regex").trim()}' +
    '  if(k==="longtext"){var r=pv("xRows").trim()||"4";return pv("xMax").trim()+";"+pv("xMin").trim()+";"+r+";"+r}' +
    '  if(k==="number"||k==="pkeyNum"||k==="authNum"){return pv("nLen").trim()}' +
    '  if(k==="numberZero"){return "0"}' +
    '  if(k==="zip"){return pv("zipDigits").trim()+";"+pv("zipRefs").replace(/\\s/g,"")}' +
    '  if(k==="slider"){return pv("lStep").trim()+";"+pv("lMin").trim()+";"+pv("lMax").trim()}' +
    '  if(k==="select"){return optLines(pv("options"))}' +
    '  if(k==="multi"){return pv("uCount").trim()+"::"+optLines(pv("options"))}' +
    '  if(k==="file"){return pv("fDesc").trim()+";"+pv("fExt").trim()+";"+pv("fSize").trim()+";"+pv("fSample").trim()}' +
    '  if(k==="noteMd"){return pv("markdown")}' +
    '  if(k==="calc"){return optLines(pv("calcPairs")).replace(/\\s/g,"")}' +
    '  if(k==="fileView"){return pv("folderId").trim()}' +
    '  return ""' +
    '}' +
    'var lastValues=null;' +
    'document.getElementById("genBtn").onclick=function(){' +
    '  var msg=document.getElementById("msg");msg.textContent="";msg.className="";' +
    '  document.getElementById("outWrap").style.display="none";' +
    '  var id=document.getElementById("colId").value.trim();var name=document.getElementById("colName").value.trim();' +
    '  if(id===""||name===""){msg.textContent="欄位 ID 和名稱都要填";msg.className="err";return}' +
    '  var p=cur();var isF=p.t==="F";' +
    '  var group="";var must="";var nul="";' +
    '  if(isF){' +
    '    var g=document.getElementById("fGroup").value.trim();' +
    '    group=g===""?"":(g+(document.getElementById("fUniq").checked?":U":""));' +
    '    must=document.getElementById("fMust").checked?"M":"";' +
    '    nul=(document.getElementById("fNull").checked?"N":"")+(document.getElementById("fNone").checked?"D":"");' +
    '  }' +
    '  var payload={id:id,name:name,type:p.t,format:p.f,group:group,content:buildContent(),must:must,nullable:nul};' +
    '  var btn=this;btn.disabled=true;btn.textContent="檢查中…";' +
    '  google.script.run.withSuccessHandler(function(report){' +
    '    btn.disabled=false;btn.textContent="產生欄位設定（先過格式檢查）";' +
    '    if(report.errors.length>0){msg.textContent="【錯誤】\\n"+report.errors.join("\\n")+(report.warnings.length?"\\n【警告】\\n"+report.warnings.join("\\n"):"");msg.className="err";return}' +
    '    if(report.warnings.length>0){msg.textContent="【警告】\\n"+report.warnings.join("\\n");msg.className="warn"}' +
    '    else{msg.textContent="檢查通過！";msg.className="ok"}' +
    '    lastValues=[payload.id,payload.name,payload.type,payload.format,payload.group,payload.content,payload.must,payload.nullable];' +
    '    var multi=payload.content.indexOf("\\n")>-1;' +
    '    var shown=lastValues.slice();' +
    '    if(multi){shown[5]="（多行內容，見下方框）"}' +
    '    document.getElementById("out").value=shown.join("\\n");' +
    '    document.getElementById("rawWrap").style.display=multi?"":"none";' +
    '    if(multi){document.getElementById("raw").value=payload.content}' +
    '    document.getElementById("writeBtn").style.display=DATA.referID!==""?"":"none";' +
    '    document.getElementById("outWrap").style.display="";' +
    '  }).withFailureHandler(function(err){' +
    '    btn.disabled=false;btn.textContent="產生欄位設定（先過格式檢查）";' +
    '    msg.textContent="檢查失敗："+err.message;msg.className="err";' +
    '  }).wizardValidate(payload,DATA.referID);' +
    '};' +
    'document.getElementById("copyBtn").onclick=function(){' +
    '  var out=document.getElementById("out");out.select();document.execCommand("copy");' +
    '  this.textContent="已複製！";var b=this;setTimeout(function(){b.textContent="複製 8 行"},1500);' +
    '};' +
    'document.getElementById("writeBtn").onclick=function(){' +
    '  if(lastValues===null){return}' +
    '  var btn=this;btn.disabled=true;btn.textContent="寫入中…";var msg=document.getElementById("msg");' +
    '  google.script.run.withSuccessHandler(function(result){' +
    '    btn.disabled=false;btn.textContent="直接寫入下一個空欄";msg.textContent=result;msg.className="ok";' +
    '  }).withFailureHandler(function(err){' +
    '    btn.disabled=false;btn.textContent="直接寫入下一個空欄";msg.textContent="寫入失敗："+err.message;msg.className="err";' +
    '  }).appendWizardColumn(DATA.referID,lastValues);' +
    '};' +
    '</script></body></html>';
}

// ===== 功能 6：修改問卷內容 =====

// 開啟點選列的對照表單連結＋紀錄狀態警語＋「改完跑檢查」按鈕。
// 只能改文案類（說明/選項/正則/content）；增刪挪欄在有紀錄後會錯位，警語明講。
function openReferForEdit() {
  let listSS = SpreadsheetApp.getActiveSpreadsheet();
  let selected = selectedListRow_(listSS);
  if (selected === null) { return; }
  let referID = selected.row[1].toString().trim();
  if (!/^[-\w]+$/.test(referID)) { ui.alert("這一列的對照表單ID是空的或格式不對"); return; }
  let recordCount;
  try {
    let recordArr = SpreadsheetApp.openById(selected.row[2].toString().trim()).getSheets()[0].getDataRange().getValues();
    recordCount = 0;
    for (let i = 2; i < recordArr.length; i++) {
      if (recordArr[i].join("").trim() !== "") { recordCount++; }
    }
  } catch { recordCount = -1; }
  let html = HtmlService.createHtmlOutput(editReferDialogHtml_({
    rowIndex: selected.rowIndex,
    name: selected.row[0].toString(),
    referID: referID,
    recordCount: recordCount
  })).setWidth(500).setHeight(440);
  ui.showModalDialog(html, "修改問卷內容：" + selected.row[0].toString());
}

function editReferDialogHtml_(data) {
  let json = JSON.stringify(data).replace(/</g, "\\u003c");
  return '<!DOCTYPE html><html><head><base target="_top"><style>' +
    'body{font-family:Arial,"Microsoft JhengHei",sans-serif;font-size:13px;margin:14px;color:#333}' +
    'a{color:#1a73e8;font-size:14px}' +
    '#warn{margin-top:10px;padding:8px;border-radius:4px;white-space:pre-wrap}' +
    '.danger{background:#fce8e6;color:#c5221f}.safe{background:#e6f4ea;color:#188038}.unknown{background:#fef7e0;color:#b05a00}' +
    'button{margin-top:12px;padding:8px 14px;background:#1a73e8;color:#fff;border:none;border-radius:4px;cursor:pointer}' +
    'button:disabled{opacity:.5}' +
    '#result{margin-top:10px;white-space:pre-wrap;font-family:monospace;font-size:12px;max-height:200px;overflow-y:auto}' +
    '</style></head><body>' +
    '<div>打開結構表編輯欄位與名冊：</div>' +
    '<a id="link" target="_blank"></a>' +
    '<div id="warn"></div>' +
    '<button id="checkBtn">我改完了，跑格式檢查</button>' +
    '<div id="result"></div>' +
    '<script>' +
    'var DATA=' + json + ';' +
    'var a=document.getElementById("link");' +
    'a.href="https://docs.google.com/spreadsheets/d/"+encodeURIComponent(DATA.referID)+"/edit";' +
    'a.textContent="開啟「"+DATA.name+"」的結構表";' +
    'var warn=document.getElementById("warn");' +
    'if(DATA.recordCount>0){warn.textContent="已有 "+DATA.recordCount+" 筆填答紀錄！\\n只能改文案類（說明文字、選項、正則、content 參數）。\\n增刪或搬動欄位會讓既有紀錄整批錯位——要改結構請開新問卷。";warn.className="danger"}' +
    'else if(DATA.recordCount===0){warn.textContent="還沒有任何填答紀錄，欄位可以自由增刪（改完記得跑檢查）。";warn.className="safe"}' +
    'else{warn.textContent="填入表打不開，無法判斷是否已有紀錄，請當作有紀錄小心處理。";warn.className="unknown"}' +
    'document.getElementById("checkBtn").onclick=function(){' +
    '  var btn=this;btn.disabled=true;btn.textContent="檢查中…";' +
    '  google.script.run.withSuccessHandler(function(text){' +
    '    btn.disabled=false;btn.textContent="我改完了，跑格式檢查";' +
    '    document.getElementById("result").textContent=text;' +
    '  }).withFailureHandler(function(err){' +
    '    btn.disabled=false;btn.textContent="我改完了，跑格式檢查";' +
    '    document.getElementById("result").textContent="檢查失敗："+err.message;' +
    '  }).runCheckForRowIndex(DATA.rowIndex);' +
    '};' +
    '</script></body></html>';
}

// ===== 報表輸出 =====

function formatReport_(report) {
  let lines = [];
  if (report.errors.length > 0) {
    lines.push("【錯誤 " + report.errors.length + " 條】");
    lines = lines.concat(numberLines_(report.errors));
  }
  if (report.warnings.length > 0) {
    if (lines.length > 0) { lines.push(""); }
    lines.push("【警告 " + report.warnings.length + " 條】");
    lines = lines.concat(numberLines_(report.warnings));
  }
  if (lines.length > 45) {
    let hidden = lines.length - 45;
    lines = lines.slice(0, 45);
    lines.push("……訊息太多，其餘 " + hidden + " 行略（修完上面的再檢查一次）");
  }
  return lines.join("\n");
}

function numberLines_(messages) {
  let lines = [];
  for (let i = 0; i < messages.length; i++) {
    lines.push((i + 1) + ". " + messages[i]);
  }
  return lines;
}

// 0-based 欄位索引轉 A1 欄名（0→A、25→Z、26→AA）
function columnLetter_(index) {
  let letter = "";
  let n = index;
  while (n >= 0) {
    letter = String.fromCharCode(65 + (n % 26)) + letter;
    n = Math.floor(n / 26) - 1;
  }
  return letter;
}

// 個資遮罩：訊息裡的主鍵值只露頭尾
function maskValue_(value) {
  if (value.length <= 2) { return value; }
  return value.substring(0, 1) + "***" + value.substring(value.length - 1);
}

// ===== 一次性遷移：刪除舊「固定ID」欄（2026-07-31） =====

// 舊版問卷列表是 A~P 共 16 欄，N 欄為「固定ID」（給 URL 參數直開問卷用的短代號）。
// 該設計已無用武之地——深連結帶的一直是 B 欄 refer，且系統包在 Google Sites 裡帶不了
// URL 參數——故整欄刪除，原 O（開放進入）、P（亂數出題）前移成 N、O，全表變 15 欄。
//
// 這是全系統唯一一處 deleteColumn，刻意的一次性例外：禁刪的鐵律是為了「列」（位移會
// 錯位到別人的資料、難復原），這裡動的是欄、對象是每個管理者一份的設定表、由人手動
// 離峰執行、且執行前後都能肉眼核對。不要拿它當「以後可以刪列/刪欄」的先例。
//
// 用法：在問卷列表試算表的 Apps Script 編輯器手動執行 dropFixedIdColumn()，看執行紀錄。
// 冪等：已遷移過會直接回報並跳過。表頭對不上一律停手（fail-safe，不猜）。
//
// ⚠️ 部署順序：這支與新版 src/Code.js **必須同時到位**。只做一邊會讓欄位索引錯開，
// 後端把「開放進入」讀成別欄的值 → 全部問卷變成無法登入填寫。建議流程：
// 先關閉入口（或挑離峰）→ 跑這支 → 立刻 clasp push + 部署新版 web app → 實測登入。
function dropFixedIdColumn() {
  let listSS = SpreadsheetApp.getActiveSpreadsheet();
  let sheet = listSS.getSheetByName(LIST_SHEET_NAME);
  if (sheet === null) {
    console.log("找不到「" + LIST_SHEET_NAME + "」分頁，沒有動作");
    return;
  }
  let lock = LockService.getScriptLock();
  if (!lock.tryLock(30000)) {
    console.log("有其他程序在跑，本次沒有動作");
    return;
  }
  try {
    let lastColumn = sheet.getLastColumn();
    let header = sheet.getRange(1, 1, 1, Math.max(lastColumn, 1)).getValues()[0];
    let nameAt = function (index) {
      return header[index] === undefined ? "" : header[index].toString().trim();
    };
    // 已遷移：N 欄就是「開放進入」
    if (nameAt(13) === "開放進入" && nameAt(14) === "亂數出題") {
      console.log("這份問卷列表已經是新版 15 欄格式（N 開放進入、O 亂數出題），沒有動作");
      return;
    }
    // 未遷移的樣子：N 固定ID、O 開放進入、P 亂數出題。三者有一個對不上就停手
    if (nameAt(13) !== "固定ID" || nameAt(14) !== "開放進入" || nameAt(15) !== "亂數出題") {
      console.log("表頭與預期不符，為避免刪錯欄已停手。目前 N/O/P 欄標題是「" +
        nameAt(13) + "」／「" + nameAt(14) + "」／「" + nameAt(15) +
        "」，預期「固定ID」／「開放進入」／「亂數出題」。請人工確認後再處理");
      return;
    }
    sheet.deleteColumn(14); // N 欄（1-based 第 14 欄）
    SpreadsheetApp.flush();
    // 刪完立刻回頭核對，沒對上就大聲喊（此時資料已動，只能靠人工還原）
    let after = sheet.getRange(1, 1, 1, Math.max(sheet.getLastColumn(), 1)).getValues()[0];
    let afterN = after[13] === undefined ? "" : after[13].toString().trim();
    let afterO = after[14] === undefined ? "" : after[14].toString().trim();
    if (afterN !== "開放進入" || afterO !== "亂數出題") {
      console.error("刪欄後表頭核對失敗！現在 N/O 欄是「" + afterN + "」／「" + afterO +
        "」，請立刻用試算表的版本紀錄（檔案 → 版本紀錄）還原並回報");
      return;
    }
    logger("（全表）", "一次性遷移：刪除 N 欄「固定ID」，開放進入/亂數出題前移為 N/O", listSS);
    console.log("完成：已刪除「固定ID」欄，問卷列表現在是 A~O 共 15 欄。" +
      "請立刻部署新版 web app（src/Code.js），並實測一份問卷能正常登入");
  } finally {
    lock.releaseLock();
  }
}
