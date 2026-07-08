const _ = LodashGS.load();
const appProperties = PropertiesService.getScriptProperties();

function doGet(e) {
  try {
    let template = HtmlService.createTemplateFromFile('index');
    let content = template.evaluate().getContent();
    // 簽名邀請連結 ?token=xxx：regex 白名單（64 字元 hex）+ JSON.stringify 雙保險防注入，
    // 不合法的 token 一律當作沒帶、不注入任何東西
    let inviteToken = e !== undefined && e.parameter !== undefined ? e.parameter.token : undefined;
    if(inviteTokenValid_(inviteToken)) {
      content = content.replace('<head>', '<head><script>window.__SM_INVITE_TOKEN__=' + JSON.stringify(inviteToken) + ';</script>');
    }
    let htmlOutput = HtmlService.createHtmlOutput(content)
      .setTitle(appProperties.getProperty('systemTitle'));
    htmlOutput.addMetaTag('viewport', 'width=device-width, initial-scale=1');
    return htmlOutput;
  } catch (err) {
    console.error('doGet failed: ' + err.stack);
    throw err;
  }
}

// 主要 RPC 進入點統一包一層錯誤記錄（記錄到 Stackdriver 後重拋，前端 withFailureHandler 行為不變）
function logged_(name, fn) {
  try {
    return fn();
  } catch (err) {
    console.error(name + ' failed: ' + (err.stack || err));
    throw err;
  }
}

// ===== JWT 登入權杖 =====
// 登入（readRecord）驗證通過後簽發 HS256 JWT，之後的特權 RPC 只帶 token，
// 不再重傳認證欄位值（學號/身分證等個資）。無狀態：不存 session，驗簽章 + exp 即可。
// claims：{ pkey: 主鍵值, refer: referSSID, iat, exp }（iat/exp 依 JWT 慣例為秒）
const JWT_TTL_MS = 60 * 60 * 1000; // 1 小時；前端倒數條以 iat/exp 計算剩餘比例

function base64UrlEncode_(data) {
  // GAS 的 WebSafe 編碼仍帶 = padding，JWT 慣例去掉
  return Utilities.base64EncodeWebSafe(data).replace(/=+$/, "");
}

function base64UrlDecodeToString_(str) {
  let padded = str + "=".repeat((4 - (str.length % 4)) % 4);
  return Utilities.newBlob(Utilities.base64DecodeWebSafe(padded)).getDataAsString();
}

function getJwtSecret_() {
  let secret = appProperties.getProperty('jwtSecret');
  if(secret === null || secret.toString().trim() === "") {
    // 首次使用自動生成 256-bit 隨機密鑰，零管理者設定
    secret = Utilities.getUuid().replace(/-/g, "") + Utilities.getUuid().replace(/-/g, "");
    appProperties.setProperty('jwtSecret', secret);
  }
  return secret;
}

function signJwt_(payload, secret) {
  let header = base64UrlEncode_(JSON.stringify({ alg: "HS256", typ: "JWT" }));
  let body = base64UrlEncode_(JSON.stringify(payload));
  let signature = base64UrlEncode_(Utilities.computeHmacSha256Signature(header + "." + body, secret));
  return header + "." + body + "." + signature;
}

// 驗簽章 + exp；通過回傳 claims 物件，任何不合法情況一律回 false（不 throw）
function verifyJwt_(token, secret, nowMs) {
  try {
    if(typeof token !== "string") { return false; }
    let parts = token.split(".");
    if(parts.length !== 3) { return false; }
    let expected = base64UrlEncode_(Utilities.computeHmacSha256Signature(parts[0] + "." + parts[1], secret));
    if(expected !== parts[2]) { return false; }
    let claims = JSON.parse(base64UrlDecodeToString_(parts[1]));
    if(typeof claims.exp !== "number" || nowMs >= claims.exp * 1000) { return false; }
    return claims;
  } catch {
    return false;
  }
}

function issueToken_(referSSID, pkeyValue, nowMs) {
  return signJwt_({
    pkey: pkeyValue.toString(),
    refer: referSSID,
    iat: Math.floor(nowMs / 1000),
    exp: Math.floor((nowMs + JWT_TTL_MS) / 1000)
  }, getJwtSecret_());
}

// 受邀者 session JWT（遠端簽名邀請）：邀請 token 只當入場券用一次，之後 RPC 帶 session token。
// 多帶 signName/invite claims 讓後端不用信任前端傳來的格名；exp 受邀請效期與問卷 dueDate 封頂
function issueInviteSession_(invite, nowMs, dueDateMs) {
  let exp = Math.min(nowMs + JWT_TTL_MS, invite.expireAt, dueDateMs);
  return signJwt_({
    pkey: invite.primaryValue,
    refer: invite.referSSID,
    signName: invite.signName,
    invite: invite.token,
    iat: Math.floor(nowMs / 1000),
    exp: Math.floor(exp / 1000)
  }, getJwtSecret_());
}

// 特權 RPC 的統一驗證入口：驗 token 且綁定本問卷；通過回 claims、失敗回 false。
// 受邀者 session（帶 invite claim）一律拒絕——受邀者只能打受邀者專用 RPC，
// 不能拿 session token 冒充填寫者存暫存/送出問卷/發邀請
function authByToken_(referSSID, token) {
  let claims = verifyJwt_(token, getJwtSecret_(), (new Date()).getTime());
  if(claims === false) { return false; }
  if(claims.refer !== referSSID) { return false; }
  if(claims.invite !== undefined) { return false; }
  return claims;
}

// 由 claims 合成既有函數（getUserRow 等）吃的 auth 陣列（只需主鍵欄）
function authArrayFromClaims_(referSSID, claims) {
  let headers = getHeaders(referSSID);
  let pKey = _.filter(headers, (header) => {
    return /P/.test(header.type);
  });
  if(pKey.length === 0) { return null; }
  return [{ id: pKey[0].id, value: claims.pkey }];
}

// 點倒數條手動續約：token 必須仍有效（過期不能救），且重驗表單仍開放。
// 填寫者與受邀者共用；受邀者 session（帶 invite claim）續約前重讀邀請列，
// 被撤回/重發/已簽/過期即不能續，新 exp 同樣被邀請效期與 dueDate 封頂
function renewToken(referSSID, recordSSID, token) {
  return logged_('renewToken', () => {
    let claims = verifyJwt_(token, getJwtSecret_(), (new Date()).getTime());
    if(claims === false || claims.refer !== referSSID) { return { tokenExpired: true }; }
    let listSS = SpreadsheetApp.openById(appProperties.getProperty('listSheetID'));
    let listArr = listSS.getSheets()[0].getRange("A:O").getValues();
    let currentSheet = _.filter(listArr, (sheet) => {
      return sheet[1].toString().trim() === referSSID && sheet[2].toString().trim() === recordSSID;
    });
    if(currentSheet.length === 0) { return { renewed: false, message: "找不到這份表單，無法續約" }; }
    let now = (new Date()).getTime();
    let dueDate = parseInt(currentSheet[0][3].toString());
    if(now > dueDate) { return { renewed: false, message: "表單已過期，無法續約" }; }
    if(currentSheet[0][14].toString().trim() === "否") { return { renewed: false, message: "表單已關閉，無法續約" }; }
    if(claims.invite !== undefined) {
      if(!inviteTokenValid_(claims.invite)) { return { tokenExpired: true }; }
      let sheet = inviteSheet_();
      let rowIndex = inviteRowIndexByToken_(sheet, claims.invite);
      if(rowIndex === -1) { return { renewed: false, message: "邀請已被撤回或重發，無法延長" }; }
      let invite = parseInviteRow_(sheet.getRange(rowIndex, 1, 1, 11).getValues()[0]);
      if(inviteStatusFor_(invite, now) !== 'pending') { return { renewed: false, message: "邀請已失效，無法延長" }; }
      return { renewed: true, token: issueInviteSession_(invite, now, dueDate) };
    }
    return { renewed: true, token: issueToken_(referSSID, claims.pkey, now) };
  });
}

function getQList() {
  return logged_('getQList', () => getQList_());
}

function getQList_() {
  let listSS = SpreadsheetApp.openById(appProperties.getProperty('listSheetID'));
  let listSheet = listSS.getSheets()[0];
  let listRange = listSheet.getRange("A:P");
  let listArr = listRange.getValues();
  let lists = [];
  if(listArr.length > 1) {
    for(let i=1; i<listArr.length; i++) {
      let row = listArr[i];
      if(row.length > 0) {
        if(row[0].toString() !== "") {
          if(row[11].toString() === "是") {
            lists.push({
              record: row[2].toString().trim(),
              name: row[0].toString().trim(),
              refer: row[1].toString().trim(),
              dueDate: parseInt(row[3].toString().trim()),
              viewDate: parseInt(row[4].toString().trim()),
              enableModify: row[5].toString().trim() === "否" ? false : true,
              signatures: row[6].toString() === "" ? [] : row[6].toString().trim().split(";"),
              comment: row[7].toString().trim(),
              loginTip: row[8].toString().trim(),
              submitTip: row[9].toString().trim(),
              loginfailTip: row[10].toString().trim(),
              email: row[12].toString().trim(),
              sheetID: row[13].toString().trim(),
              writeAllowed: row[14].toString().trim() === "是" ? true : false,
              randomQ: row[15].toString().trim() === "是" ? true : false
            });
          }
        }
      }
    }
  }
  let outofDate = _.filter(lists, (item) => {
    return item.dueDate < (new Date()).getTime();
  });
  for(let i=0; i<outofDate.length; i++) {
    outofDate[i].signatures = [];
    outofDate[i].enableModify = false;
  }
  let visible = _.filter(lists, (item) => {
    return item.viewDate > (new Date()).getTime();
  });
  // 線上暫存功能開關：有設定 draftSheetID 才啟用
  let draftEnabled = draftEnabled_();
  for(let i=0; i<visible.length; i++) {
    visible[i].draftEnabled = draftEnabled;
  }
  return visible;
}

// ===== 線上暫存 =====
// 暫存試算表：ScriptProperties 的 draftSheetID 指定，一份問卷一個分頁（分頁名 = referSSID）
// 分頁結構：A 欄主鍵、B 欄更新時間(ms)、C 欄之後為 JSON 切塊（單一儲存格上限 50000 字元）
const DRAFT_CHUNK_SIZE = 45000;

// 把 payload 字串切成單一儲存格放得下的塊（空字串回傳空陣列）
function chunkPayload_(payloadStr) {
  let chunks = [];
  for(let i=0; i<payloadStr.length; i+=DRAFT_CHUNK_SIZE) {
    chunks.push(payloadStr.substring(i, i + DRAFT_CHUNK_SIZE));
  }
  return chunks;
}

function draftEnabled_() {
  let draftID = appProperties.getProperty('draftSheetID');
  return draftID !== null && draftID.toString().trim() !== "";
}

function draftKey_(referSSID, auth) {
  let headers = getHeaders(referSSID);
  let pKey = _.filter(headers, (header) => {
    return /P/.test(header.type);
  });
  if(pKey.length === 0) { return null; }
  if(/G/.test(pKey[0].format)) {
    let account = Session.getActiveUser().getEmail();
    return account === "" ? null : account;
  }
  let uKey = _.filter(auth, (aObj) => {
    return aObj.id === pKey[0].id;
  });
  if(uKey.length > 0) {
    let value = uKey[0].value.toString().trim();
    return value === "" ? null : value;
  }
  return null;
}

function draftSheet_(referSSID) {
  let draftSS = SpreadsheetApp.openById(appProperties.getProperty('draftSheetID'));
  let sheet = draftSS.getSheetByName(referSSID);
  if(sheet === null) {
    sheet = draftSS.insertSheet(referSSID);
  }
  return sheet;
}

function draftRowIndex_(sheet, key) {
  let lastRow = sheet.getLastRow();
  if(lastRow === 0) { return -1; }
  let keys = sheet.getRange(1, 1, lastRow, 1).getValues();
  for(let i=0; i<keys.length; i++) {
    if(keys[i][0].toString() === key) { return i + 1; }
  }
  return -1;
}

function saveDraft(referSSID, token, payload) {
  return logged_('saveDraft', () => {
    if(!draftEnabled_()) { return { success: false, message: "線上暫存未啟用" }; }
    // token 是安全邊界：web app 為匿名存取，沒有有效 token 就不能存任何人的暫存
    let claims = authByToken_(referSSID, token);
    if(claims === false) { return { success: false, tokenExpired: true, message: "登入已逾時，請重新驗證身分" }; }
    let key = claims.pkey;
    let chunks = chunkPayload_(payload.toString());
    let updatedAt = (new Date()).getTime();
    let lock = LockService.getScriptLock();
    lock.waitLock(10000);
    try {
      let sheet = draftSheet_(referSSID);
      let rowIndex = draftRowIndex_(sheet, key);
      if(rowIndex === -1) { rowIndex = sheet.getLastRow() + 1; }
      // 先清整列，避免新資料切塊數比舊資料少時殘留舊塊
      if(sheet.getLastColumn() > 0) {
        sheet.getRange(rowIndex, 1, 1, sheet.getLastColumn()).clearContent();
      }
      sheet.getRange(rowIndex, 1, 1, 2 + chunks.length).setValues([[key, updatedAt].concat(chunks)]);
      return { success: true, updatedAt: updatedAt };
    } finally {
      lock.releaseLock();
    }
  });
}

function loadDraft(referSSID, token) {
  return logged_('loadDraft', () => {
    if(!draftEnabled_()) { return null; }
    // token 是安全邊界：web app 為匿名存取，沒有有效 token 就不能撈任何人的暫存
    let claims = authByToken_(referSSID, token);
    if(claims === false) { return { tokenExpired: true }; }
    return draftPayloadByKey_(referSSID, claims.pkey);
  });
}

// 以主鍵值撈暫存 payload（loadDraft 與受邀者 inviteeLogin 共用；呼叫端負責身分驗證）
function draftPayloadByKey_(referSSID, key) {
  let sheet = draftSheet_(referSSID);
  let rowIndex = draftRowIndex_(sheet, key);
  if(rowIndex === -1) { return null; }
  let row = sheet.getRange(rowIndex, 1, 1, sheet.getLastColumn()).getValues()[0];
  let payloadStr = "";
  for(let i=2; i<row.length; i++) {
    payloadStr += row[i].toString();
  }
  if(payloadStr === "") { return null; }
  return { updatedAt: parseInt(row[1].toString()), payload: payloadStr };
}

function deleteDraft(referSSID, token) {
  return logged_('deleteDraft', () => {
    if(!draftEnabled_()) { return false; }
    let claims = authByToken_(referSSID, token);
    if(claims === false) { return false; }
    let key = claims.pkey;
    let lock = LockService.getScriptLock();
    lock.waitLock(10000);
    try {
      let sheet = draftSheet_(referSSID);
      let rowIndex = draftRowIndex_(sheet, key);
      if(rowIndex !== -1) {
        sheet.deleteRow(rowIndex);
      }
      return true;
    } finally {
      lock.releaseLock();
    }
  });
}

// ===== 遠端多方簽名邀請 =====
// 填寫者對任一簽名格發 email 邀請，受邀者以 token 進入 read-only 問卷、只簽自己那格。
// token 與各格狀態存 draftSheetID 暫存試算表的 _invites 分頁（功能與線上暫存綁定）。
// 一格一列（active row）模型：upsert key =（referSSID, 主鍵值, 簽名格名稱）；
// 重發/換 email = 同列覆寫新 token（舊 token 自動失效）；撤回 = 刪列；未邀請 = 無列。
// 分頁欄位（A-K）：token, referSSID, recordSSID, primaryValue, signName, email,
// expireAt(ms), status(pending/signed), fileID, createdAt(ms), updatedAt(ms)
const INVITE_SHEET_NAME = '_invites';
const INVITE_TTL_DAYS = 7;
const INVITE_MAX_SIGNATURE_BYTES = 2 * 1024 * 1024;

// 64 字元 hex 白名單：doGet 注入與所有 token 查詢的第一道閘門
function inviteTokenValid_(token) {
  return typeof token === "string" && /^[a-f0-9]{64}$/.test(token);
}

function newInviteToken_() {
  return (Utilities.getUuid() + Utilities.getUuid()).replace(/-/g, "").toLowerCase();
}

// 邀請效期：min(發出後 ttlDays 天, 問卷 dueDate)
function inviteExpireAt_(nowMs, dueDateMs, ttlDays) {
  return Math.min(nowMs + ttlDays * 24 * 60 * 60 * 1000, dueDateMs);
}

// 邀請物件 ⇄ 分頁列（11 欄）互轉
function inviteRowOf_(invite) {
  return [
    invite.token,
    invite.referSSID,
    invite.recordSSID,
    invite.primaryValue,
    invite.signName,
    invite.email,
    invite.expireAt,
    invite.status,
    invite.fileID,
    invite.createdAt,
    invite.updatedAt
  ];
}

function parseInviteRow_(row) {
  return {
    token: row[0].toString(),
    referSSID: row[1].toString(),
    recordSSID: row[2].toString(),
    primaryValue: row[3].toString(),
    signName: row[4].toString(),
    email: row[5].toString(),
    expireAt: parseInt(row[6].toString()),
    status: row[7].toString(),
    fileID: row[8].toString(),
    createdAt: parseInt(row[9].toString()),
    updatedAt: parseInt(row[10].toString())
  };
}

// 讀取時衍生狀態（expired 不落地）：無列=none；signed 永遠算 signed（簽完不因時間失效）
function inviteStatusFor_(invite, nowMs) {
  if(invite === null || invite === undefined) { return 'none'; }
  if(invite.status === 'signed') { return 'signed'; }
  if(nowMs >= invite.expireAt) { return 'expired'; }
  return 'pending';
}

// 狀態機矩陣：send=發/重發/換email（signed 格不可再邀）、revoke=撤回（signed 需 force，
// 由 RPC 層另行裁決）、sign=受邀者送出簽名（過期即不可簽）
function inviteTransition_(currentStatus, action) {
  let allowed = {
    send:   { none: true,  pending: true, expired: true,  signed: false },
    revoke: { none: false, pending: true, expired: true,  signed: false },
    sign:   { none: false, pending: true, expired: false, signed: false }
  };
  if(!(action in allowed)) { return false; }
  return allowed[action][currentStatus] === true;
}

// writeRecord 的簽名來源裁決（race 防線核心，純函數供單測）：
// 每個必要簽名格 → invite 列 signed 用列上 fileID（優先於本地）、pending/expired 整筆擋下、
// 無列 → 用前端傳來的本地簽名 blob、都沒有 → missing
function resolveSignatureSources_(requiredNames, localSignatures, inviteRows, nowMs) {
  let results = [];
  for(let i=0; i<requiredNames.length; i++) {
    let name = requiredNames[i];
    let invite = _.find(inviteRows, (row) => {
      return row.signName === name;
    });
    let status = inviteStatusFor_(invite, nowMs);
    if(status === 'signed') {
      results.push({ name: name, source: 'invite', fileID: invite.fileID });
    } else if(status === 'pending' || status === 'expired') {
      results.push({ name: name, source: 'pending' });
    } else {
      let local = _.find(localSignatures, (sign) => {
        return sign.name === name;
      });
      if(local !== undefined && local.blob !== undefined && local.blob !== "") {
        results.push({ name: name, source: 'local', blob: local.blob });
      } else {
        results.push({ name: name, source: 'missing' });
      }
    }
  }
  return results;
}

function inviteSheet_() {
  let draftSS = SpreadsheetApp.openById(appProperties.getProperty('draftSheetID'));
  let sheet = draftSS.getSheetByName(INVITE_SHEET_NAME);
  if(sheet === null) {
    sheet = draftSS.insertSheet(INVITE_SHEET_NAME);
  }
  return sheet;
}

function inviteRowIndexByToken_(sheet, token) {
  let lastRow = sheet.getLastRow();
  if(lastRow === 0) { return -1; }
  let tokens = sheet.getRange(1, 1, lastRow, 1).getValues();
  for(let i=0; i<tokens.length; i++) {
    if(tokens[i][0].toString() === token) { return i + 1; }
  }
  return -1;
}

// 以 upsert key（referSSID, 主鍵值, 簽名格名稱）找列
function inviteRowIndexByCell_(sheet, referSSID, primaryValue, signName) {
  let lastRow = sheet.getLastRow();
  if(lastRow === 0) { return -1; }
  let rows = sheet.getRange(1, 1, lastRow, 5).getValues();
  for(let i=0; i<rows.length; i++) {
    if(rows[i][1].toString() === referSSID && rows[i][3].toString() === primaryValue && rows[i][4].toString() === signName) {
      return i + 1;
    }
  }
  return -1;
}

// 某填寫者在某問卷的全部邀請列（已 parse 成物件）
function invitesForUser_(referSSID, primaryValue) {
  let sheet = inviteSheet_();
  let lastRow = sheet.getLastRow();
  if(lastRow === 0) { return []; }
  let rows = sheet.getRange(1, 1, lastRow, 11).getValues();
  let invites = [];
  for(let i=0; i<rows.length; i++) {
    if(rows[i][1].toString() === referSSID && rows[i][3].toString() === primaryValue) {
      invites.push(parseInviteRow_(rows[i]));
    }
  }
  return invites;
}

// 清單分頁裡（referSSID, recordSSID）對應的那一列（A:O）；找不到回 null
function listRowFor_(referSSID, recordSSID) {
  let listSS = SpreadsheetApp.openById(appProperties.getProperty('listSheetID'));
  let listArr = listSS.getSheets()[0].getRange("A:O").getValues();
  let rows = _.filter(listArr, (sheet) => {
    return sheet[1].toString().trim() === referSSID && sheet[2].toString().trim() === recordSSID;
  });
  return rows.length > 0 ? rows[0] : null;
}

// 受邀者的 read-only 問卷內容：已送出的紀錄（savedContent）疊上填寫者最新線上暫存（草稿優先）。
// primaryValue 一律來自伺服器端查出的邀請列，不信前端
function buildReadonlyHeaders_(referSSID, primaryValue) {
  let headers = getHeaders(referSSID);
  let pKey = _.filter(headers, (header) => {
    return /P/.test(header.type);
  });
  let userRows = pKey.length > 0 ? getUserRow(referSSID, [{ id: pKey[0].id, value: primaryValue }]) : [];
  for(let i=0; i<headers.length; i++) {
    let column = headers[i];
    if(userRows.length > 0 && /F|C|G/.test(column.type)) {
      column.savedContent = userRows[0][column.pos].toString();
      column.value = column.savedContent;
    }
    column.pos = undefined;
  }
  let draft = draftPayloadByKey_(referSSID, primaryValue);
  if(draft !== null) {
    try {
      let payload = JSON.parse(draft.payload);
      let queue = payload.data !== undefined && payload.data.queue !== undefined ? payload.data.queue : [];
      for(let i=0; i<queue.length; i++) {
        let column = _.find(headers, (header) => {
          return header.id === queue[i].id;
        });
        if(column !== undefined) {
          column.value = queue[i].val;
          // read-only 顯示（enableModify=false 的 FormField）走 savedContent/lastInput，
          // 草稿值要疊進 lastInput 受邀者才看得到
          column.lastInput = queue[i].isFile === true ? queue[i].url : queue[i].val;
        }
      }
    } catch (err) {
      // 草稿壞掉不影響 read-only 檢視，退回已送出的 savedContent
      console.error('buildReadonlyHeaders_ draft parse failed: ' + err);
    }
  }
  return headers;
}

// 發邀請＝重發＝換 Email 同一支：對（本人, 簽名格）列 upsert 新 token（舊 token 自動失效）
function sendInvite(referSSID, recordSSID, token, signName, email) {
  return logged_('sendInvite', () => {
    if(!draftEnabled_()) { return { success: false, message: "線上暫存未啟用，無法使用簽名邀請" }; }
    let claims = authByToken_(referSSID, token);
    if(claims === false) { return { success: false, tokenExpired: true, message: "登入已逾時，請重新驗證身分" }; }
    let listRow = listRowFor_(referSSID, recordSSID);
    if(listRow === null) { return { success: false, message: "找不到這份表單" }; }
    let now = (new Date()).getTime();
    let dueDate = parseInt(listRow[3].toString());
    if(now > dueDate) { return { success: false, message: "表單已過期，無法發出邀請" }; }
    if(listRow[14].toString().trim() === "否") { return { success: false, message: "表單已關閉，無法發出邀請" }; }
    let signNames = listRow[6].toString().trim() === "" ? [] : listRow[6].toString().trim().split(";");
    if(!_.includes(signNames, signName)) { return { success: false, message: "這份表單沒有「" + signName + "」這個簽名格" }; }
    if(!/^\w+((-\w+)|(\.\w+))*@[A-Za-z0-9]+((\.|-)[A-Za-z0-9]+)*\.[A-Za-z]+$/.test(email)) {
      return { success: false, message: "Email 格式錯誤" };
    }
    if(MailApp.getRemainingDailyQuota() <= 0) {
      return { success: false, message: "今日系統 Email 配額已用完，請明天再發邀請" };
    }
    let inviteToken = newInviteToken_();
    let expireAt = inviteExpireAt_(now, dueDate, INVITE_TTL_DAYS);
    let lock = LockService.getScriptLock();
    lock.waitLock(10000);
    try {
      let sheet = inviteSheet_();
      let rowIndex = inviteRowIndexByCell_(sheet, referSSID, claims.pkey, signName);
      let createdAt = now;
      if(rowIndex !== -1) {
        let existing = parseInviteRow_(sheet.getRange(rowIndex, 1, 1, 11).getValues()[0]);
        if(!inviteTransition_(inviteStatusFor_(existing, now), 'send')) {
          return { success: false, status: 'signed', message: "這一格已經完成簽名，不能再發邀請；若要重簽請先撤回" };
        }
        createdAt = existing.createdAt;
      }
      let invite = {
        token: inviteToken,
        referSSID: referSSID,
        recordSSID: recordSSID,
        primaryValue: claims.pkey,
        signName: signName,
        email: email,
        expireAt: expireAt,
        status: 'pending',
        fileID: '',
        createdAt: createdAt,
        updatedAt: now
      };
      if(rowIndex === -1) {
        sheet.appendRow(inviteRowOf_(invite));
      } else {
        sheet.getRange(rowIndex, 1, 1, 11).setValues([inviteRowOf_(invite)]);
      }
    } finally {
      lock.releaseLock();
    }
    // 寄邀請信（在鎖外，寄信慢）；信含連結 + 純文字驗證碼 + 到期時間
    let formTitle = listRow[0].toString().trim();
    let replyEmail = listRow[12].toString().trim();
    let systemTitle = appProperties.getProperty('systemTitle');
    let link = ScriptApp.getService().getUrl() + '?token=' + inviteToken;
    MailApp.sendEmail(email, replyEmail, systemTitle + "簽名邀請：" + formTitle,
      "您好：\n" + maskString(claims.pkey) + " 邀請您在表單「" + formTitle + "」中簽署「" + signName + "」欄位。\n\n" +
      "請點擊以下連結進入簽名頁面：\n" + link + "\n\n" +
      "或開啟表單網站後選擇「我有簽名的驗證碼」，貼上這組驗證碼：\n" + inviteToken + "\n\n" +
      "本邀請有效期限至：" + (new Date(expireAt)).toLocaleString() + "\n" +
      "您只能檢視問卷內容並簽署自己的欄位；如對填答內容有異議，請直接聯絡填寫者。\n" +
      "任何問題，請回信至：" + replyEmail);
    let emailSS = SpreadsheetApp.openById(appProperties.getProperty('emailLog'));
    emailSS.getSheets()[0].appendRow([now, formTitle + "（簽名邀請：" + signName + "）", claims.pkey, email]);
    return { success: true, invite: { signName: signName, email: email, expireAt: expireAt, status: 'pending' } };
  });
}

// 撤回授權：預設 force=false 永不信前端認知——伺服器見 signed 不刪、回最新狀態
// 讓前端刷新卡片並二段確認；force=true 才連剛簽好的一起撤（簽名檔進垃圾桶）
function revokeInvite(referSSID, recordSSID, token, signName, force) {
  return logged_('revokeInvite', () => {
    if(!draftEnabled_()) { return { success: false, message: "線上暫存未啟用" }; }
    let claims = authByToken_(referSSID, token);
    if(claims === false) { return { success: false, tokenExpired: true, message: "登入已逾時，請重新驗證身分" }; }
    let now = (new Date()).getTime();
    let lock = LockService.getScriptLock();
    lock.waitLock(10000);
    try {
      let sheet = inviteSheet_();
      let rowIndex = inviteRowIndexByCell_(sheet, referSSID, claims.pkey, signName);
      if(rowIndex === -1) { return { success: true, status: 'none' }; }
      let invite = parseInviteRow_(sheet.getRange(rowIndex, 1, 1, 11).getValues()[0]);
      let status = inviteStatusFor_(invite, now);
      if(status === 'signed' && force !== true) {
        return {
          success: false,
          status: 'signed',
          invite: {
            signName: invite.signName,
            email: invite.email,
            expireAt: invite.expireAt,
            status: 'signed',
            image: signatureDataUrl_(invite.fileID)
          },
          message: "這一格剛完成簽名！確定要撤銷已簽好的簽名、改在這個裝置重簽嗎？"
        };
      }
      if(status === 'signed' && invite.fileID !== "") {
        DriveApp.getFileById(invite.fileID).setTrashed(true);
      }
      sheet.deleteRow(rowIndex);
      return { success: true, status: 'none' };
    } finally {
      lock.releaseLock();
    }
  });
}

// 填寫者查各簽名格邀請狀態；signed 的格附內嵌簽名圖
function listInvites(referSSID, recordSSID, token) {
  return logged_('listInvites', () => {
    if(!draftEnabled_()) { return { invites: [] }; }
    let claims = authByToken_(referSSID, token);
    if(claims === false) { return { tokenExpired: true }; }
    let now = (new Date()).getTime();
    let rows = invitesForUser_(referSSID, claims.pkey);
    let invites = [];
    for(let i=0; i<rows.length; i++) {
      let status = inviteStatusFor_(rows[i], now);
      let item = {
        signName: rows[i].signName,
        email: rows[i].email,
        expireAt: rows[i].expireAt,
        status: status
      };
      if(status === 'signed' && rows[i].fileID !== "") {
        item.image = signatureDataUrl_(rows[i].fileID);
      }
      invites.push(item);
    }
    return { invites: invites };
  });
}

// 受邀者以邀請 token 進入：token 即憑證（不走 authRecord），驗證通過即簽發 session JWT，
// 之後受邀者的 RPC 只帶 session token。任何不合法情況一律回 false（不透露原因）
function inviteeLogin(token) {
  return logged_('inviteeLogin', () => {
    if(!draftEnabled_()) { return false; }
    if(!inviteTokenValid_(token)) { return false; }
    let sheet = inviteSheet_();
    let rowIndex = inviteRowIndexByToken_(sheet, token);
    if(rowIndex === -1) { return false; }
    let invite = parseInviteRow_(sheet.getRange(rowIndex, 1, 1, 11).getValues()[0]);
    let listRow = listRowFor_(invite.referSSID, invite.recordSSID);
    if(listRow === null) { return false; }
    let now = (new Date()).getTime();
    let dueDate = parseInt(listRow[3].toString());
    if(now > dueDate) { return false; }
    if(listRow[14].toString().trim() === "否") { return false; }
    let status = inviteStatusFor_(invite, now);
    if(status === 'expired') { return false; }
    let result = {
      sheetName: listRow[0].toString().trim(),
      comment: listRow[7].toString().trim(),
      refer: invite.referSSID,
      record: invite.recordSSID,
      dueDate: dueDate,
      signName: invite.signName,
      expireAt: invite.expireAt,
      maskedPkey: maskString(invite.primaryValue),
      alreadySigned: status === 'signed',
      headers: buildReadonlyHeaders_(invite.referSSID, invite.primaryValue),
      sessionToken: issueInviteSession_(invite, now, dueDate)
    };
    if(status === 'signed' && invite.fileID !== "") {
      result.myImage = signatureDataUrl_(invite.fileID);
    }
    return result;
  });
}

// 受邀者送出簽名：收 session JWT（不收裸邀請 token），Lock 內以 claims 裡的邀請 token
// 重查列——填寫者剛撤回/重發時列會不在或 token 不符，這裡是 race 的最後防線
function submitInviteSignature(sessionToken, blobDataURL) {
  return logged_('submitInviteSignature', () => {
    if(!draftEnabled_()) { return { success: false, message: "線上暫存未啟用" }; }
    let now = (new Date()).getTime();
    let claims = verifyJwt_(sessionToken, getJwtSecret_(), now);
    if(claims === false || typeof claims.invite !== "string") {
      return { success: false, tokenExpired: true, message: "登入已逾時，請重新用邀請連結（或驗證碼）進入" };
    }
    if(typeof blobDataURL !== "string" || !/^data:image\/png;base64,/.test(blobDataURL)) {
      return { success: false, message: "簽名格式錯誤，請清除後重簽" };
    }
    let bytes;
    try {
      bytes = Utilities.base64Decode(blobDataURL.split(",")[1]);
    } catch {
      return { success: false, message: "簽名格式錯誤，請清除後重簽" };
    }
    if(bytes.length > INVITE_MAX_SIGNATURE_BYTES) {
      return { success: false, message: "簽名圖片過大，請清除後重簽" };
    }
    let lock = LockService.getScriptLock();
    lock.waitLock(10000);
    try {
      let sheet = inviteSheet_();
      let rowIndex = inviteRowIndexByToken_(sheet, claims.invite);
      if(rowIndex === -1) {
        return { success: false, revoked: true, message: "這份邀請已被填寫者撤回或重發，你的簽名沒有送出；請聯絡填寫者重新邀請" };
      }
      let invite = parseInviteRow_(sheet.getRange(rowIndex, 1, 1, 11).getValues()[0]);
      let listRow = listRowFor_(invite.referSSID, invite.recordSSID);
      if(listRow === null) { return { success: false, message: "找不到這份表單" }; }
      let dueDate = parseInt(listRow[3].toString());
      if(now > dueDate || listRow[14].toString().trim() === "否") {
        return { success: false, message: "表單已關閉或過期，無法送出簽名" };
      }
      let status = inviteStatusFor_(invite, now);
      if(!inviteTransition_(status, 'sign')) {
        return {
          success: false,
          message: status === 'signed' ? "這一格已經完成簽名了" : "邀請已過期，請聯絡填寫者重新邀請"
        };
      }
      let folder = DriveApp.getFolderById(appProperties.getProperty('universalStorageID'));
      let blob = Utilities.newBlob(bytes, 'image/png', invite.signName);
      let writtenFile = folder.createFile(blob);
      writtenFile.setName("[" + writtenFile.getId() + "]" + listRow[0].toString().trim() + invite.primaryValue + "的" + invite.signName + "簽名");
      invite.status = 'signed';
      invite.fileID = writtenFile.getId();
      invite.updatedAt = now;
      sheet.getRange(rowIndex, 1, 1, 11).setValues([inviteRowOf_(invite)]);
      return { success: true };
    } finally {
      lock.releaseLock();
    }
  });
}

function getGoogleID() {
  return Session.getActiveUser().getEmail();
}

// 簽名圖轉 data URI 供前端 <img> 內嵌（Drive 的 getUrl 是檢視器頁面，無法直接內嵌）。
// 私有函數：fileID 一律由伺服器端查出（紀錄列或 _invites 列），絕不做成收 fileID 的 RPC，
// 否則會變成任意 Drive 檔案讀取漏洞
function signatureDataUrl_(fileID) {
  let blob = DriveApp.getFileById(fileID).getBlob();
  return 'data:' + blob.getContentType() + ';base64,' + Utilities.base64Encode(blob.getBytes());
}

function readRecord(referSSID, recordSSID, auth) {
  return logged_('readRecord', () => readRecord_(referSSID, recordSSID, auth));
}

function readRecord_(referSSID, recordSSID, auth) {
  if(authRecord(referSSID, auth)) {
    let listSS = SpreadsheetApp.openById(appProperties.getProperty('listSheetID'));
    let listSheet = listSS.getSheets()[0];
    let listRange = listSheet.getRange("A:O");
    let listArr = listRange.getValues();
    let currentSheet = _.filter(listArr, (sheet) => {
      if(sheet[1].toString().trim() === referSSID) {
        if(sheet[2].toString().trim() === recordSSID) {
          return true;
        }
      }
      return false;
    });
    let signatures = [];
    if(currentSheet.length > 0) {
      if(currentSheet[0][14].toString().trim() === "是") {
        let headers = getHeaders(referSSID);
        let pkeys = _.filter(headers, (header) => {
          return /P/.test(header.type);
        });
        if(pkeys.length > 0) {
          let uKeys = _.filter(auth, (aObj) => {
            return aObj.id === pkeys[0].id;
          });
          if(uKeys.length > 0) {
            // 主鍵值由伺服器端判定（Gmail 主鍵取 Session、密碼路徑取已通過 authRecord 驗證的值），
            // 蓋掉前端傳來的值——避免 Gmail 模式下竄改 auth 讀到別人的紀錄
            let serverPkey = draftKey_(referSSID, auth);
            if(serverPkey === null) { return false; }
            uKeys[0].value = serverPkey;
            let userRows = getUserRow(referSSID, auth);
            if(userRows.length > 0) {
              let recordSS = SpreadsheetApp.openById(recordSSID);
              let recordSheet = recordSS.getSheets()[0];
              let recordRange = recordSheet.getDataRange();
              let recordArr = recordRange.getValues();
              let userRecords = _.filter(recordArr, (arr) => {
                return arr[2].toString() === uKeys[0].value;
              });
              let userRecord = userRecords.length > 0 ? userRecords[userRecords.length - 1] : undefined;
              if(userRecord !== undefined) {
                if(userRecord[3].toString() !== "") {
                  let signs = userRecord[3].toString().trim().split(";");
                  for(let i=0; i<signs.length; i++) {
                    signatures.push(signatureDataUrl_(signs[i]));
                  }
                }
              }
              for(let i=0; i<headers.length; i++) {
                let column = headers[i];
                column.lastInput = undefined;
                if(/C/.test(column.type)) {
                  if(/F/.test(column.format)) {
                    let imgContent = userRows[0][column.pos].toString().trim()
                    if(imgContent !== "") {
                      let storageID = column.content === "" ? appProperties.getProperty('universalStorageID') : column.content;
                      let files = DriveApp.searchFiles('parents in "'+ storageID +'" and title contains "' + imgContent + '"');
                      while(files.hasNext()) {
                        let file = files.next();
                        column.savedContent = file.getUrl();
                      }
                    } else {
                      column.savedContent = "";
                    }
                  } else if(/T/.test(column.format)) {
                    column.savedContent = userRows[0][column.pos].toString();
                  }
                } else if(/F|G/.test(column.type)) {
                  column.savedContent = userRows[0][column.pos].toString();
                  column.value = column.savedContent;
                  if(/F/.test(column.type)) {
                    if(/F/.test(column.format)) {
                      let fileContent = userRows[0][column.pos].toString().trim();
                      if(fileContent !== "") {
                        let storageID = appProperties.getProperty('universalStorageID');
                        if(column.content !== "") {
                          let contentConfig = column.content.split(";");
                          if(contentConfig[3] !== "") { storageID = contentConfig[3]; }
                        }
                        let files = DriveApp.searchFiles('parents in "'+ storageID +'" and title contains "' + fileContent + '"');
                        while (files.hasNext()) {
                          let file = files.next();
                          column.savedContent = file.getUrl();
                        }
                      } else {
                        column.savedContent = "";
                      }
                      if(userRecord !== undefined) {
                        if(userRecord[column.pos + 5] != null) {
                          fileContent = userRecord[column.pos + 5].toString().trim();
                          if(fileContent !== "") {
                            let file = DriveApp.getFileById(fileContent);
                            column.lastInput = file.getUrl();
                          } else {
                            column.lastInput = undefined;
                          }
                        } else {
                          column.lastInput = undefined;
                        }
                      } else {
                        column.lastInput = undefined;
                      }
                      column.value = "";
                    } else {
                      if(userRecord !== undefined) {
                        if(userRecord[column.pos + 5] != null) {
                          column.lastInput = userRecord[column.pos + 5].toString().replace(/📝/, "");
                          column.value = column.lastInput;
                        } else {
                          column.lastInput = "";
                        }
                      }
                    }
                  }
                }
                column.pos = undefined;
              }
              return {
                status: {
                  length: userRecords.length,
                  modified: userRecord !== undefined ? userRecord[1] : "",
                  lastTick: userRecord !== undefined ? userRecord[0] : "",
                  pkey: maskString(pkeys[0].id)
                },
                emailQuota: MailApp.getRemainingDailyQuota(),
                signatures: signatures,
                headers: headers,
                // 登入成功即簽發 token，之後的特權 RPC 只帶它、不再重傳認證欄位值
                token: issueToken_(referSSID, serverPkey, (new Date()).getTime())
              };
            }
          }
        }
      }
    }
  }
  return false;
}

function getUserRow(referSSID, auth) {
  let referSS = SpreadsheetApp.openById(referSSID);
  let referSheet = referSS.getSheets()[0];
  let referRange = referSheet.getDataRange();
  let referArr = referRange.getValues();
  let headers = getHeaders(referSSID);
  let pKey = _.filter(headers, (header) => {
    return /P/.test(header.type);
  });
  if(pKey.length > 0) {
    let uKey = _.filter(auth, (aObj) => {
      return aObj.id === pKey[0].id;
    });
    if(uKey.length > 0) {
      return _.filter(referArr, (row) => {
        return row[pKey[0].pos].toString() === uKey[0].value;
      })
    }
  }
  return [];
}

function queryPC(address) {
  let postCodeAPI = UrlFetchApp.fetch(appProperties.getProperty('postCodeAPI') + encodeURIComponent(address.toString()));
  return postCodeAPI.getContentText();
}

function publicHeader(referSSID) {
  let headers = getHeaders(referSSID);
  for(let i=0;i<headers.length; i++) {
    let column = headers[i];
    column.pos = undefined;
  }
  return headers;
}

function buildSelections(column, referSSID) {
  if(!/C/.test(column.type)) {
    if(/S/.test(column.format)) {
      if(column.content === "") {
        let referSS = SpreadsheetApp.openById(referSSID);
        let referSheet = referSS.getSheets()[0];
        let referRange = referSheet.getDataRange();
        let referArr = referRange.getValues();
        let values = [];
        if(referArr.length > 8) {
          for(let i=8; i<referArr.length; i++) {
            values.push(referArr[i][column.pos].toString());
          }
        }
        return _.join(_.uniq(values), ";");
      }
    }
  }
  return column.content;
}

function getHeaders(referSSID) {
  let referSS = SpreadsheetApp.openById(referSSID);
  let referSheet = referSS.getSheets()[0];
  let referRange = referSheet.getDataRange();
  let referArr = referRange.getValues();
  let headers = [];
  if(referArr.length > 1) {
    if(referArr[0].length > 0) {
      for(let i=0; i<referArr[0].length; i++) {
        if(referArr[0][0].toString() !== "") {
          let obj = {
            id: referArr[0][i].toString().trim(),
            name: referArr[1][i].toString().trim(),
            type: referArr[2][i].toString().trim(),
            format: referArr[3][i].toString().trim(),
            group: referArr[4][i].toString().trim(),
            content: referArr[5][i].toString().trim(),
            must: referArr[6][i].toString().trim() === "M",
            nullable: referArr[7][i].toString().trim() === "N",
            pos: i,
            value: ""
          };
          if(formatDetector('S', 'F|P|A', obj)) {
            obj.content = buildSelections(obj, referSSID);
          }
          if(formatDetector('L', 'F', obj)) {
            let defaultConfig = [1, 10, 100];
            let userConfig = obj.content.split(";");
            if(userConfig.length === 3) {
              defaultConfig = userConfig;
            }
            obj.content = _.join(defaultConfig, ";");
          }
          headers.push(obj);
        }
      }
    }
  }
  return headers;
}

function authRecord(referSSID, auth) {
  let headers = getHeaders(referSSID);
  for(let i=0; i<auth.length; i++) {
    auth[i].accept = false;
  }
  let gmailFinder = _.filter(headers, (column) => {
    if(/P/.test(column.type)) {
      return /G/.test(column.format);
    }
    return false;
  });
  let userRow;
  if(gmailFinder.length > 0) {
    let account = Session.getActiveUser().getEmail();
    if(account !== "") {
      gmailFinder[0].value = account;
      userRow = getUserRow(referSSID, [gmailFinder[0]]);
      if(userRow.length > 0) {
        return true;
      }
    }
  } else {
    userRow = getUserRow(referSSID, auth);
    if(userRow.length > 0) {
      let pKey = _.filter(headers, (header) => {
        return /P/.test(header.type);
      });
      if(pKey.length > 0) {
        let uKey = _.filter(auth, (aObj) => {
          return aObj.id === pKey[0].id;
        });
        if(uKey.length > 0) {
          uKey[0].accept = true;
          for(let i=0; i<auth.length; i++) {
            let aColumn = _.filter(headers, (header) => {
              return header.id === auth[i].id;
            });
            if(aColumn.length > 0) {
              if(/A/.test(aColumn[0].type)) {
                if(userRow[0][aColumn[0].pos].toString() === auth[i].value) {
                  auth[i].accept = true;
                } else {
                  break;
                }
              } else if(/G/.test(aColumn[0].type)) {
                auth[i].accept = true;
              }
            } else {
              break;
            }
          }
          return _.every(auth, { 'accept': true });
        }
      }
    }
  }
  return false;
}

function writeRecord(referSSID, recordSSID, token, record, accept, signatures, email) {
  return logged_('writeRecord', () => writeRecord_(referSSID, recordSSID, token, record, accept, signatures, email));
}

function writeRecord_(referSSID, recordSSID, token, record, accept, signatures, email) {
  let writeTick = new Date();
  let claims = authByToken_(referSSID, token);
  if(claims === false) {
    return {
      status: false,
      tokenExpired: true,
      errorLog: ["登入已逾時，請重新驗證身分後再送出（已填的內容都還在）"],
      data: [],
      tick: writeTick.getTime()
    };
  }
  let auth = authArrayFromClaims_(referSSID, claims);
  let listSS = SpreadsheetApp.openById(appProperties.getProperty('listSheetID'));
  let listSheet = listSS.getSheets()[0];
  let listRange = listSheet.getRange("A:O");
  let listArr = listRange.getValues();
  let pureData = [writeTick.getTime(), accept];
  let proceedWrite = true;
  let errorLog = [];
  let primaryData;
  let groupData = "";
  let hasGroup = false;
  let result = false;
  let recieved = [];
  let currentSheet = _.filter(listArr, (sheet) => {
    if(sheet[1].toString().trim() === referSSID) {
      if(sheet[2].toString().trim() === recordSSID) {
        return true;
      }
    }
    return false;
  });
  if(currentSheet.length > 0) {
    let now = (new Date()).getTime();
    if(now > parseInt(currentSheet[0][3].toString())) {
      /*if(now < parseInt(currentSheet[0][4].toString())) {
        for(let i=0; i<record.length; i++) {
          record[i].value = record[i].lastInput !== undefined ? record[i].lastInput : record[i].savedContent;
        }
      } else {*/
      proceedWrite = false;
      errorLog.push("表單已過時");
      //}
    }
    if(currentSheet[0][14].toString().trim() === "否") {
      proceedWrite = false;
      errorLog.push("表單關閉，不允許寫入");
    }
  }
  if(proceedWrite) {
    let headers = getHeaders(referSSID);
    let columnGroups = _.uniq(_.map(headers, 'group'));
    for(let i=0; i<record.length; i++) {
      let data = record[i];
      let column = _.filter(headers, (header) => {
        return header.id === data.id;
      });
      if(column.length > 0) {
        data.pos = column[0].pos
      }
    }
    record = _.orderBy(record, ['pos'], ['asc']);
    let userRows = getUserRow(referSSID, auth);
    if(userRows.length > 0) {
      let userRow = userRows[0];
      for(let i=0; i<record.length; i++) {
        if(proceedWrite) {
          let data = record[i];
          let columns = _.filter(headers, (header) => {
            return header.id === data.id;
          });
          if(columns.length > 0) {
            let column = columns[0];
            if(column.nullable) {
              let emptyFound = false;
              if(/F/.test(column.type)) {
                if(data.value === "") {
                  emptyFound = true;
                }
              }
              if(emptyFound) {
                if(userRow[column.pos].toString() !== "") {
                  proceedWrite = false;
                  errorLog.push(column.name + "原本有資料，你不可以清除！");
                } else {
                  data.value = "不提供資料";
                  proceedWrite = true;
                }
              }
            }
            if(column.must) {
              if(data.value === "") {
                proceedWrite = false;
                errorLog.push(column.name + "必需要有值！");
              } else {
                proceedWrite = true;
              }
            }
            if(formatDetector('', 'C|F', column)) {
              if(proceedWrite) {
                if(data.value !== "不提供資料") {
                  let errorReason = "";
                  if(formatDetector('F', 'F', column)) {
                    column.value = data.value;
                  } else if(formatDetector('L', 'F', column)) {
                    let defaultNum = [1, 10, 100];
                    let numConfig = column.content.split(";");
                    if(numConfig.length === 3) { 
                      defaultNum = _.map(numConfig, (str) => {
                        return parseInt(str);
                      })
                    };
                    if(_.inRange(data.value, defaultNum[1], defaultNum[2]+0.1)) {
                      let diff = data.value - defaultNum[1];
                      if(diff % defaultNum[0] === 0) {
                        column.value = "📝"+parseInt(data.value);
                      } else {
                        errorReason = "數字必須是介於" + defaultNum[1] + "和" + defaultNum[2] + "，每次增減" + defaultNum[0] + "的整數！"
                        proceedWrite = false;
                      }
                    } else {
                      errorReason = "數字必須是介於" + defaultNum[1] + "和" + defaultNum[2] + "，每次增減" + defaultNum[0] + "的整數！"
                      proceedWrite = false;
                    }
                  } else if(formatDetector('N|P', 'F|C', column)) {
                    let numLength = 0;
                    if(formatDetector('P', 'F|C', column)) {
                      let pConfig = column.content.split(";");
                      numLength = parseInt(pConfig[0]);
                    } else if(formatDetector('N', 'F|C', column)) {
                      if(column.content !== "") {
                        numLength = parseInt(column.content);
                      }
                    }
                    let zeroIndicator = numLength === 0 ? "0" : "";
                    numLength = numLength > 0 ? "{" + numLength + "}" : "*";
                    if(new RegExp("^" + zeroIndicator + "\\d" + numLength + "$").test(data.value)) {
                      column.value = "📝"+data.value;
                    } else {
                      proceedWrite = false;
                    }
                  } else if(formatDetector('I', 'F|C', column)) {
                    if(formatDetector('I', 'F', column)) {
                      if(/^[A-Z][0-9|A-Z]\d{8}$/.test(data.value)) {
                        column.value = data.value;
                      } else {
                        proceedWrite = false;
                      }
                    }
                  } else if(formatDetector('E', 'F|C', column)) {
                    if(/^\w+((-\w+)|(\.\w+))*@[A-Za-z0-9]+((\.|-)[A-Za-z0-9]+)*\.[A-Za-z]+$/.test(data.value)) {
                      column.value = data.value;
                    } else {
                      proceedWrite = false;
                    }
                  } else if(formatDetector('M', 'F', column)) {
                    if(/^09\d{8}$/.test(data.value)) {
                      column.value = "📝"+data.value;
                    } else {
                      proceedWrite = false;
                    }
                  } else if(formatDetector('X', 'F|C', column)) {
                    let xConfig = column.content.split(";");
                    let errorMsg = [];
                    if(xConfig[0] !== '') {
                      xConfig[1] = '';
                      let maxLen = parseInt(xConfig[0]);
                      if(data.value.length > maxLen) {
                        errorMsg.push("你輸入的文字長度超過限制！（" + data.value.length + "/" + maxLen +"）");
                      }
                    }
                    if(xConfig[1] !== '') {
                      let minLen = parseInt(xConfig[1]);
                      if(data.value.length < minLen) {
                        errorMsg.push("你輸入的文字太少了！（" + data.value.length + "/" + minLen + "）");
                      }
                    }
                    if(errorMsg.length > 0) {
                      proceedWrite = false;
                      errorReason = _.join(errorMsg, "，");
                    }
                    if(proceedWrite) {
                      column.value = data.value.replace(/台(北|中|南|灣)/,'臺$1');
                    }
                  } else if(formatDetector('T', 'F|C', column)) {
                    if(column.content === "") {
                      column.value = data.value.replace(/台(北|中|南|灣)/,'臺$1');
                    } else {
                      let regexConfig = column.content.split("::");
                      if(new RegExp(regexConfig[1]).test(data.value)) {
                        column.value = data.value.replace(/台(北|中|南|灣)/,'臺$1');
                      } else {
                        proceedWrite = false;
                      }
                    }
                  } else if(formatDetector('S', 'F', column)) {
                    let selections = column.content.split(";");
                    if(_.includes(selections, data.value)) {
                      column.value = data.value;
                    } else {
                      proceedWrite = false;
                    }
                  } else if(formatDetector('U', 'F|C', column)) {
                    let selectionConfig = column.content.split("::");
                    let selections = _.uniq(selectionConfig[1].split(';'));
                    let selected = _.uniq(data.value.split(';'));
                    let newSelected = [];
                    for(let k=0; k<selected.length; k++) {
                      let checkSelect = _.filter(selections, (selection) => {
                        return selection === selected[k];
                      });
                      if(checkSelect.length > 0) {
                        newSelected.push(checkSelect[0]);
                      }
                    }
                    newSelected = _.uniq(newSelected);
                    if(newSelected.length === selected.length) {
                      column.value = data.value;
                    } else {
                      proceedWrite = false;
                    }
                  }
                  if(!proceedWrite) {
                    errorLog.push(errorReason === "" ? column.name + "格式錯誤！" : column.name + errorReason);
                  }
                }
              }
            } else if(formatDetector('', 'G', column)) {
              if(/G/.test(column.format)) {
                groupData = data.value;
                hasGroup = true;
              }
            } else if(formatDetector('', 'O', column)) {
              // O 欄位（輸出用）：前端傳來也不寫入，但不算竄改
            } else {
              proceedWrite = false;
              errorLog.push("你竄改數據？" + column.name + "不允許寫入！");
            }
          } else {
            proceedWrite = false;
            errorLog.push("你竄改數據？根本沒有這個欄位啊！");
          }
        } else {
          break;
        }
      }
      if(proceedWrite) {
        for(let i=0; i<columnGroups.length; i++) {
          if(columnGroups[i] !== "") {
            let groupTest = _.filter(headers, (header) => {
              return header.group === columnGroups[i];
            });
            let gSetting = columnGroups[i].split(":");
            let groupName = gSetting[0];
            let uniqGroup = false;
            if(gSetting.length > 1) {
              if(gSetting[1] === "U") {
                uniqGroup = true;
              }
            }
            if(_.every(groupTest, { group: columnGroups[i], value: "" })) {
              proceedWrite = false;
              errorLog.push("群組欄位「" + groupName + "」不得均為空"); //分組功能未經測試，理想情境是分組可以用中文，然後分號區隔U是否開啟unique
              break;
            }
            if(uniqGroup) {
              let uniqed = _.uniqBy(groupTest, (item) => {
                return item.value.toString().trim();
              });
              if(groupTest.length !== uniqed.length) {
                proceedWrite = false;
                errorLog.push("群組欄位「" + groupName + "」中的欄位值不得重複");
                break;
              }
            }
          }
        }
      }
      if(proceedWrite) {
        // 身分已由開頭的 authByToken_ 驗過；auth 為 null 表示問卷沒有主鍵欄，不該發生
        if(auth !== null) {
          primaryData = claims.pkey;
          let signatureIDs = [];
          let csvOutput = "";
          if(currentSheet.length > 0) {
            let requiredNames = currentSheet[0][6].toString().trim() === "" ? [] : currentSheet[0][6].toString().trim().split(";");
            if(requiredNames.length > 0) {
              // 每格簽名來源由伺服器裁決：邀請列 signed → 用列上 fileID（前端沒有傳 fileID
              // 的通道，無從偽造）；pending/expired → 整筆擋下；無列 → 用本地簽名 blob
              let inviteRows = draftEnabled_() ? invitesForUser_(referSSID, primaryData) : [];
              let resolved = resolveSignatureSources_(requiredNames, signatures, inviteRows, (new Date()).getTime());
              // 先整批檢查再建檔，避免部分格擋下時留下孤兒簽名檔
              for(let i=0; i<resolved.length; i++) {
                if(resolved[i].source === 'pending') {
                  proceedWrite = false;
                  errorLog.push("「" + resolved[i].name + "」的簽名邀請還在等待受邀者完成，請等對方簽完（或撤回授權改在本機簽）再送出");
                } else if(resolved[i].source === 'missing') {
                  proceedWrite = false;
                  errorLog.push("「" + resolved[i].name + "」缺少簽名，無法送出");
                }
              }
              if(proceedWrite) {
                let folder = DriveApp.getFolderById(appProperties.getProperty('universalStorageID'));
                for(let i=0; i<resolved.length; i++) {
                  let item = resolved[i];
                  if(item.source === 'invite') {
                    csvOutput += "你的簽名("+(i+1)+"/"+resolved.length+")： "+ DriveApp.getFileById(item.fileID).getUrl() + "\n";
                    signatureIDs.push(item.fileID);
                  } else {
                    let type = (item.blob.split(";")[0]).replace('data:','');
                    let imageUpload = Utilities.base64Decode(item.blob.split(",")[1]);
                    let blob = Utilities.newBlob(imageUpload,type,item.name);
                    let writtenFile = folder.createFile(blob);
                    csvOutput += "你的簽名("+(i+1)+"/"+resolved.length+")： "+ writtenFile.getUrl() + "\n";
                    writtenFile.setName("[" + writtenFile.getId() + "]" + currentSheet[0][0].toString().trim() + primaryData + "的" + item.name + "簽名");
                    signatureIDs.push(writtenFile.getId());
                  }
                }
              }
            }
          }
          if(proceedWrite) {
            pureData.push(primaryData);
            pureData.push(_.join(signatureIDs, ";"));
            if(!hasGroup) { groupData = "" }
            pureData.push(groupData);
            for(let i=0; i<headers.length; i++) {
              pureData.push(headers[i].value.toString());
              if(/^\w+((-\w+)|(\.\w+))*@[A-Za-z0-9]+((\.|-)[A-Za-z0-9]+)*\.[A-Za-z]+$/.test(email)) {
                if(/F/.test(headers[i].type)) {
                  if(/F/.test(headers[i].format)) {
                    if(headers[i].value !== "") {
                      let file = DriveApp.getFileById(headers[i].value.toString());
                      csvOutput += headers[i].name + " ： " + file.getUrl() + "\n";
                    } else {
                      csvOutput += headers[i].name + " ： 無檔案\n";
                    }
                  } else {
                    csvOutput += headers[i].name + " ： " + headers[i].value.toString().replace("📝", "") + "\n";
                  }
                }
              }
            }
            let recordSS = SpreadsheetApp.openById(recordSSID);
            let recordSheet = recordSS.getSheets()[0];
            recordSheet.appendRow(pureData);
            result = true;
            // 正式送出成功：清掉本人在這份問卷的全部邀請列（token 用畢即焚；
            // 簽名檔已記進紀錄列不動）。清列失敗不影響已寫入的結果
            if(draftEnabled_()) {
              try {
                let lock = LockService.getScriptLock();
                lock.waitLock(10000);
                try {
                  let inviteSheet = inviteSheet_();
                  for(let i=inviteSheet.getLastRow(); i>=1; i--) {
                    let row = inviteSheet.getRange(i, 1, 1, 4).getValues()[0];
                    if(row[1].toString() === referSSID && row[3].toString() === primaryData) {
                      inviteSheet.deleteRow(i);
                    }
                  }
                } finally {
                  lock.releaseLock();
                }
              } catch (err) {
                console.error('writeRecord invite cleanup failed: ' + (err.stack || err));
              }
            }
            if(/^\w+((-\w+)|(\.\w+))*@[A-Za-z0-9]+((\.|-)[A-Za-z0-9]+)*\.[A-Za-z]+$/.test(email)) {
              if(MailApp.getRemainingDailyQuota() > 0) {
                let now = new Date();
                let replyEmail = currentSheet[0][12].toString().trim();
                let systemTitle = appProperties.getProperty('systemTitle');
                let emailSSID = appProperties.getProperty('emailLog');
                let formTitle = currentSheet[0][0].toString().trim();
                MailApp.sendEmail(email, replyEmail, systemTitle + "填寫結果回條","您好：感謝您填寫表單「" + formTitle + "」，你的填寫時間是" + writeTick.toLocaleString() + "\n以下是你的填寫結果\n" + csvOutput + "\n任何問題，請回信至：" + replyEmail);
                let emailSS = SpreadsheetApp.openById(emailSSID);
                let emailSheet = emailSS.getSheets()[0];
                emailSheet.appendRow([now.getTime(), formTitle, primaryData,email]);
              }
            }
          }
        }
      }
      for(let i=0; i<headers.length; i++) {
        headers[i].pos = undefined;
      }
      recieved = headers
    } else {
      errorLog.push("你原本可以填這張表嗎？");
    }
  }
  return {
    status: result,
    errorLog: errorLog,
    data: recieved,
    tick: writeTick.getTime()
  };
}

function saveFile(referSSID, recordSSID, token, columnID, fileObj) {
  return logged_('saveFile', () => saveFile_(referSSID, recordSSID, token, columnID, fileObj));
}

function saveFile_(referSSID, recordSSID, token, columnID, fileObj) {
  // 舊版沒驗身分就允許上傳 Drive，token 化時順手補上這層
  if(authByToken_(referSSID, token) === false) {
    return {
      status: false,
      tokenExpired: true,
      errorLog: ["登入已逾時，請重新驗證身分後再上傳檔案"],
      fileID: "",
      fileURL: ""
    };
  }
  let listSS = SpreadsheetApp.openById(appProperties.getProperty('listSheetID'));
  let listSheet = listSS.getSheets()[0];
  let listRange = listSheet.getRange("A:O");
  let listArr = listRange.getValues();
  let proceedWrite = true;
  let errorLog = [];
  let fileID = "";
  let fileURL = "";
  let currentSheet = _.filter(listArr, (sheet) => {
    if(sheet[1].toString().trim() === referSSID) {
      if(sheet[2].toString().trim() === recordSSID) {
        return true;
      }
    }
    return false;
  });
  if(currentSheet.length > 0) {
    let now = (new Date()).getTime();
    if(now > parseInt(currentSheet[0][3].toString())) {
      /*if(now < parseInt(currentSheet[0][4].toString())) {
        for(let i=0; i<record.length; i++) {
          record[i].value = record[i].lastInput !== undefined ? record[i].lastInput : record[i].savedContent;
        }
      } else {*/
      proceedWrite = false;
      errorLog.push("表單已過時");
      //}
    }
  }
  if(proceedWrite) {
    let headers = getHeaders(referSSID);
    let columns = _.filter(headers, (header) => {
      return header.id === columnID;
    });
    if(columns.length > 0) {
      let column = columns[0];
      if(/F/.test(column.type)) {
        if(/F/.test(column.format)) {
          let storageID = appProperties.getProperty('universalStorageID');
          let maxSize = 1;
          let mimeLimit = "";
          if(column.content !== "") {
            let contentConfig = column.content.split(";");
            if(contentConfig[2] !== "") { maxSize = parseInt(contentConfig[2]); }
            if(contentConfig[1] !== "") { mimeLimit = contentConfig[1]; }
            if(contentConfig[3] !== "") { storageID = contentConfig[3]; }
          }
          if((new RegExp(mimeLimit, "i")).test(fileObj.mimeType)) {
            let blob = Utilities.newBlob(fileObj.bytes, fileObj.mimeType, fileObj.filename);
            if(fileObj.bytes.length <= maxSize * 1000000) {
              let folder = DriveApp.getFolderById(storageID);
              let writtenFile = folder.createFile(blob); 
              writtenFile.setName("[" + writtenFile.getId() + "]" + currentSheet[0][0].toString().trim() + fileObj.filename);
              fileID = writtenFile.getId();
              fileURL = writtenFile.getUrl();
            } else {
              proceedWrite = false;
              errorLog.push("檔案大小超過" + maxSize + "MB限制");
            }
          } else {
            proceedWrite = false;
            errorLog.push("檔案格式限定為" + mimeLimit + "類型");
          }
        } else {
          proceedWrite = false;
          errorLog.push("你確定這個欄位可以寫入？");
        }
      } else {
        proceedWrite = false;
        errorLog.push("你確定這個欄位可以寫入？");
      }
    }
  } else {
    errorLog.push("你原本可以填這張表嗎？");
  }
  return {
    status: proceedWrite,
    errorLog: errorLog,
    fileID: fileID,
    fileURL: fileURL
  };
}

function duplicateSubmits(recordSSID, qPkey) {
  let recordSS = SpreadsheetApp.openById(recordSSID);
  let recordSheet = recordSS.getSheets()[0];
  let recordRange = recordSheet.getDataRange();
  let recordArr = recordRange.getValues();
  let userRecords = _.filter(recordArr, (arr) => {
    return arr[2].toString() === qPkey;
  });
  let returnArr = userRecords.length > 0 ? userRecords[userRecords.length - 1] : [];
  return {
    length: userRecords.length,
    modified: returnArr.length > 0 ? returnArr[1] : "",
    lastTick: returnArr.length > 0 ? returnArr[0] : "",
    pkey: maskString(qPkey)
  };
}

function latestSubmits(recordSSID) {
  let recordSS = SpreadsheetApp.openById(recordSSID);
  let recordSheet = recordSS.getSheets()[0];
  let totalRange = recordSheet.getDataRange();
  let totalArr = totalRange.getValues();
  let latestArr = _.last(totalArr);
  return {
    tick: latestArr.length > 0 ? latestArr[0].toString() : 0,
    modified: latestArr.length > 0 ? latestArr[1].toString() : false,
    pkey: latestArr.length > 0 ? maskString(latestArr[2].toString()) : ""
  };
}

function maskString(str) {
  return str.replace(/(.{1})./g, "$1*");
}

function compareSheets(referSSID, recordSSID) {
  let recordSS = SpreadsheetApp.openById(recordSSID);
  let recordSheet = recordSS.getSheets()[0];
  let recordRange = recordSheet.getDataRange();
  let recordArr = recordRange.getValues();
  let referSS = SpreadsheetApp.openById(referSSID);
  let referSheet = referSS.getSheets()[0];
  let referRange = referSheet.getDataRange();
  let referArr = referRange.getValues();
  let headers = getHeaders(referSSID);
  let groupColumns = _.filter(headers, (header) => {
    return /G/.test(header.type);
  });
  let pkeyColumns = _.filter(headers, (header) => {
    return /P/.test(header.type);
  })
  let result = [];
  if(pkeyColumns.length > 0) {
    if(groupColumns.length > 0) {
      let groupNos = _.filter(groupColumns, (header) => {
        return /N/.test(header.format);
      });
      referArr.splice(0,7);
      let groupsTemp = _.uniqBy(referArr, (row) => {
        return row[groupColumns[0].pos].toString().trim();
      });
      let groups = [];
      for(let i=0; i<groupsTemp.length;i++) {
        groups.push(groupsTemp[i][groupColumns[0].pos].toString().trim());
      }
      for(let i=0; i<groups.length; i++) {
        if(groups[i] !== "") {
          let referTemp = _.filter(referArr, (refer) => {
            return refer[groupColumns[0].pos].toString().trim() === groups[i];
          });
          let referCount = [];
          for(let k=0; k<referTemp.length; k++) {
            referCount.push(referTemp[k][pkeyColumns[0].pos].toString().trim());
          }
          let recordTemp = _.filter(recordArr, (record) => {
            return record[4].toString().trim() === groups[i].toString();
          });
          let recordCount = [];
          for(let k=0; k<recordTemp.length; k++) {
            recordCount.push(recordTemp[k][2].toString().trim());
          }
          recordCount = _.uniq(recordCount);
          referCount = _.uniq(referCount);
          let rate = ((recordCount.length / referCount.length) * 100).toFixed(0);
          let unfinished = _.differenceWith(referCount, recordCount, (existed, written) => {
            return existed === written;
          });
          let returnList = "";
          if(unfinished.length === referCount.length) {
            returnList = "全體均未填寫";
          }
          if(unfinished.length === 0) {
            returnList = "已完成";
          }
          if(returnList === "") {
            if(groupNos.length > 0) {
              let temp = [];
              for(let k=0; k<unfinished.length; k++) {
                let nos = _.filter(referTemp, (row) => {
                  return row[pkeyColumns[0].pos].toString() === unfinished[k];
                });
                if(nos.length > 0) {
                  temp.push(nos[0][groupNos[0].pos].toString());
                }
              }
              returnList = temp.join(",") + " (" + unfinished.length + "/" + referCount.length + ")";
            } else {
              if(unfinished.length <= 3) {
                let temp = [];
                for(let k=0; k<unfinished.length; k++) {
                  temp.push(maskString(unfinished[k].toString()));
                }
                returnList = temp.join(",");
              } else if(unfinished.length > 3) {
                returnList = unfinished.length + "/" + referCount.length + "（超過3人不顯示名單）";
              }
            }
          }
          result.push({
            classno: groups[i],
            rate: rate,
            unfinished: returnList
          });
        }
      }
    }
  }
  return result;
}

function getScriptURL() {
  return ScriptApp.getService().getUrl();
}

function formatDetector(format, type, column) {
  if((new RegExp(type)).test(column.type)) {
    if((new RegExp(format)).test(column.format)) {
      return true;
    }
  }
  return false;
}