const _ = LodashGS.load();
const appProperties = PropertiesService.getScriptProperties();

function doGet(e) {
  try {
    // 一定要用 createHtmlOutputFromFile（不走 template 引擎）：bundle 內含 <? 序列
    // （marked 的 regex），createTemplateFromFile().evaluate() 會把它當 scriptlet
    // 編譯直接 SyntaxError；注入一律走下面的字串 replace，不用 scriptlet
    let content = HtmlService.createHtmlOutputFromFile('index').getContent();
    // 簽名邀請連結 ?token=xxx：regex 白名單（64 字元 hex）+ JSON.stringify 雙保險防注入，
    // 不合法的 token 一律當作沒帶、不注入任何東西
    let inviteToken = e !== undefined && e.parameter !== undefined ? e.parameter.token : undefined;
    if(inviteTokenValid_(inviteToken)) {
      content = content.replace('<head>', '<head><script>window.__SM_INVITE_TOKEN__=' + JSON.stringify(inviteToken) + ';</script>');
    }
    // 問卷深連結 ?sheet=<referSSID>：同樣 regex 白名單 + JSON.stringify 雙保險，
    // doGet 只驗格式不查清單，存在性由前端載完列表後比對
    let sheetParam = e !== undefined && e.parameter !== undefined ? e.parameter.sheet : undefined;
    if(sheetParamValid_(sheetParam)) {
      content = content.replace('<head>', '<head><script>window.__SM_SHEET_REFER__=' + JSON.stringify(sheetParam) + ';</script>');
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
      let invite = latestInviteForToken_(sheet, claims.invite);
      if(invite === null) { return { renewed: false, message: "邀請已被撤回或重發，無法延長" }; }
      if(inviteStatusFor_(invite, now) !== 'pending') { return { renewed: false, message: "邀請已失效，無法延長" }; }
      return { renewed: true, token: issueInviteSession_(invite, now, dueDate) };
    }
    return { renewed: true, token: issueToken_(referSSID, claims.pkey, now) };
  });
}

function getQList() {
  return logged_('getQList', () => getQList_());
}

// 問卷列表頁的重要公告（Markdown）：ScriptProperties 的 announcement 有設才回內容，
// 沒設回空字串，前端據此決定要不要顯示公告 el-alert（內容過 marked+DOMPurify 渲染）。
function getAnnouncement() {
  let msg = appProperties.getProperty('announcement');
  return msg === null ? "" : msg.toString().trim();
}

// 問卷結構表（refer，B 欄的試算表 ID）的 Drive 建立時間（ms）：前端生命週期時間軸
// 的起點。注意 N 欄的 sheetID 只是問卷識別字串（前端暫存 key），不是 Drive ID。
// 建立時間永不變，CacheService 快取到期（上限 6 小時）重讀一次即可；
// 單表失敗回 0（前端時間軸退化隱藏），不能讓一張表壞掉拖垮整個 getQList
function sheetCreatedAt_(referSSID) {
  if(referSSID === "") { return 0; }
  let cacheKey = "createdAt_" + referSSID;
  try {
    let cache = CacheService.getScriptCache();
    let cached = cache.get(cacheKey);
    if(cached !== null) { return parseInt(cached); }
    let ms = DriveApp.getFileById(referSSID).getDateCreated().getTime();
    cache.put(cacheKey, String(ms), 21600);
    return ms;
  } catch (err) {
    console.error('sheetCreatedAt_ failed for ' + referSSID + ': ' + (err.stack || err));
    return 0;
  }
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
    // 只對過濾後仍可見的表查 Drive 建立時間，減少 Drive 呼叫
    visible[i].createdAt = sheetCreatedAt_(visible[i].refer);
  }
  return visible;
}

// ===== 線上暫存 =====
// 暫存試算表：ScriptProperties 的 draftSheetID 指定，一份問卷一個分頁（分頁名 = referSSID）。
// 純 append 快照日誌（Phase 17）：每次暫存 appendRow 一筆快照，永不 setValues/clearContent/deleteRow；
// 「當前草稿」＝該主鍵最新一列（append 保序，後列勝出＝舊版 superseded 自動失效，無刪除/消耗概念）。
// 分頁結構：第 1 列人類可讀表頭 DRAFT_HEADER（凍結、對 reader 惰性）；資料列 A 欄主鍵、
// B 欄更新時間(ms)、C 欄之後為 payload（gz:base64 單格化，超長才切塊，單一儲存格上限 50000 字元）。
const DRAFT_CHUNK_SIZE = 45000;
const DRAFT_HEADER = ['primaryKey 主鍵', 'updatedAt 存檔(ms)', 'payload 草稿(gz:base64，超長切塊)'];

// 把 payload 字串切成單一儲存格放得下的塊（空字串回傳空陣列）
function chunkPayload_(payloadStr) {
  let chunks = [];
  for(let i=0; i<payloadStr.length; i+=DRAFT_CHUNK_SIZE) {
    chunks.push(payloadStr.substring(i, i + DRAFT_CHUNK_SIZE));
  }
  return chunks;
}

// payload gzip+base64 單格化：'gz:' 是自描述版本記號（非舊資料相容）。JSON 壓縮通常 3~6 倍、
// base64 回胖 4/3，淨縮 2~4 倍——一般草稿穩進單格；50000 字/格是 Sheets 硬限制，仍超長由 chunkPayload_ 切塊。
function encodeDraftPayload_(str) {
  return 'gz:' + Utilities.base64Encode(Utilities.gzip(Utilities.newBlob(str)).getBytes());
}

// 反解：'gz:' 前綴 → base64Decode → ungzip；無前綴原樣回傳（不做舊格式相容，僅防呆）
// newBlob 第二參數 'application/x-gzip' 不可省：經 base64 往返重建的 blob content type 會遺失，
// 真機 Utilities.ungzip 對 null content type 會丟「Blob object must have non-null content type」
function decodeDraftPayload_(str) {
  if(str.slice(0, 3) === 'gz:') {
    return Utilities.ungzip(
      Utilities.newBlob(Utilities.base64Decode(str.slice(3)), 'application/x-gzip')
    ).getDataAsString();
  }
  return str;
}

// 解析一筆草稿列 → {key, updatedAt, payload=C 起串接（含變長 chunk）}；純函數，不碰 GAS 全域
function parseDraftRow_(row) {
  let payload = "";
  for(let i=2; i<row.length; i++) {
    payload += row[i].toString();
  }
  return { key: row[0].toString(), updatedAt: parseInt(row[1].toString(), 10), payload: payload };
}

// 同主鍵取最新一列（後列勝出＝舊版 superseded），無則 null；
// 表頭列首欄為字面字串、永不等於真實主鍵值，天然不匹配、不需特判
function latestDraftRowForKey_(rows, key) {
  let found = null;
  for(let i=0; i<rows.length; i++) {
    if(rows[i][0].toString() === key) { found = rows[i]; }
  }
  return found;
}

// 草稿分頁壓縮（Phase 18 離線重建用）：每主鍵留最新一列（後列勝出，superseded 舊版只進備份），
// 跳過表頭列與無主鍵的空列；變長 chunk 列以 '' 補齊成矩形（parseDraftRow_ 容忍尾端空格）。
// 純函數不碰 GAS 全域，可 vitest
function compactDraftRows_(rows) {
  let byKey = {};
  let order = [];
  for(let i=0; i<rows.length; i++) {
    if(i === 0 && rows[0][0].toString() === DRAFT_HEADER[0]) { continue; } // 跳過表頭列
    let key = rows[i][0].toString();
    if(key === "") { continue; }
    if(!(key in byKey)) { order.push(key); }
    byKey[key] = rows[i];
  }
  let width = 0;
  order.forEach((key) => { width = Math.max(width, byKey[key].length); });
  return order.map((key) => {
    let row = byKey[key].slice();
    while(row.length < width) { row.push(""); }
    return row;
  });
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
    // 新分頁：直接帶人類可讀表頭 + 凍結首列（比照 inviteSheet_），對 reader 惰性
    sheet = draftSS.insertSheet(referSSID);
    sheet.appendRow(DRAFT_HEADER);
    sheet.setFrozenRows(1);
  }
  return sheet;
}

function saveDraft(referSSID, token, payload) {
  return logged_('saveDraft', () => {
    if(!draftEnabled_()) { return { success: false, message: "線上暫存未啟用" }; }
    // token 是安全邊界：web app 為匿名存取，沒有有效 token 就不能存任何人的暫存
    let claims = authByToken_(referSSID, token);
    if(claims === false) { return { success: false, tokenExpired: true, message: "登入已逾時，請重新驗證身分" }; }
    let key = claims.pkey;
    let chunks = chunkPayload_(encodeDraftPayload_(payload.toString()));
    let updatedAt = (new Date()).getTime();
    let lock = LockService.getScriptLock();
    lock.waitLock(10000);
    try {
      let sheet = draftSheet_(referSSID);
      // 純 append 快照日誌：永不 setValues/clearContent/deleteRow；舊版因非最新列自動失效（superseded）
      sheet.appendRow([key, updatedAt].concat(chunks));
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
// 讀全表 → 取該主鍵最新一列（後列勝出）→ C 起串接 → decode，介面不變
function draftPayloadByKey_(referSSID, key) {
  let sheet = draftSheet_(referSSID);
  let lastRow = sheet.getLastRow();
  let lastCol = sheet.getLastColumn();
  if(lastRow < 1 || lastCol < 1) { return null; }
  let rows = sheet.getRange(1, 1, lastRow, lastCol).getValues();
  let row = latestDraftRowForKey_(rows, key);
  if(row === null) { return null; }
  let parsed = parseDraftRow_(row);
  if(parsed.payload === "") { return null; }
  return { updatedAt: parsed.updatedAt, payload: decodeDraftPayload_(parsed.payload) };
}

// ===== 遠端多方簽名邀請 =====
// 填寫者對任一簽名格發 email 邀請，受邀者以 token 進入 read-only 問卷、只簽自己那格。
// token 與各格狀態存 draftSheetID 暫存試算表的 _invites 分頁（功能與線上暫存綁定）。
// 純 append 快照模型（Phase 16）：每個動作 append 一筆完整 14 欄快照，永不 setValues/deleteRow。
// 「當前狀態」＝每格（key=referSSID+主鍵值+簽名格名稱）最新一列；重發/換 email = append 新 token 快照
// （舊 token 因非最新列自動失效＝superseded）；撤回/消耗 = append revoked/consumed 終態快照；未邀請 = 無列。
// 失效（expired/superseded/終態）一律讀取端判定（latestInvites_/inviteStatusFor_）。
// 分頁欄位（A-N）：token, referSSID, recordSSID, primaryValue, signName, email,
// expireAt(ms), status(pending/signed/revoked/consumed), fileID, createdAt(ms), updatedAt(ms),
// otpHash, otpExpireAt(ms), otpAttempts —— L-N 三欄是 email OTP 二段驗證的暫時狀態，
// 舊的 11 欄列（A-K）讀到空值一律視為「無有效 OTP」，不做資料搬遷
// 第 1 列放人類可讀表頭（見 INVITE_HEADER）並凍結，方便人工檢視；此列對所有 reader 惰性——
// col A/B/D 是字面字串（'token …'/'referSSID …'/'primaryValue …'），永不等於真實邀請碼/
// referSSID/主鍵值，一律被既有 key 過濾掉，故加表頭不必改任何掃描邏輯。
const INVITE_SHEET_NAME = '_invites';
// _invites 表頭（14 欄，欄序對齊 inviteRowOf_）；首欄字串同時當「已有表頭」marker
const INVITE_HEADER = [
  'token 邀請碼', 'referSSID 問卷表ID', 'recordSSID 紀錄表ID', 'primaryValue 填寫者主鍵',
  'signName 簽名格', 'email 受邀信箱', 'expireAt 到期(ms)', 'status 狀態', 'fileID 簽名檔ID',
  'createdAt 建立(ms)', 'updatedAt 更新(ms)', 'otpHash 驗證碼雜湊', 'otpExpireAt 驗證碼到期(ms)',
  'otpAttempts 錯誤次數'
];
const INVITE_SHEET_COLS = 14;
// 邀請信有效期預設 7 天（分鐘為單位，10080）；管理者可用 ScriptProperties 的
// inviteTtlMinutes（分鐘）覆寫，未設或非正整數即退回此預設
const INVITE_TTL_DEFAULT_MINUTES = 7 * 24 * 60;
const INVITE_MAX_SIGNATURE_BYTES = 2 * 1024 * 1024;
// email OTP：受邀者貼邀請碼後，系統即時寄 6 位數一次性驗證碼到邀請列登記信箱，
// 證明「現在持有該信箱」——裸邀請碼外流（瀏覽器歷史/截圖/轉寄）撿到的人收不到 OTP 就進不來
const INVITE_OTP_TTL_MS = 10 * 60 * 1000;
const INVITE_OTP_COOLDOWN_MS = 60 * 1000;
const INVITE_OTP_MAX_ATTEMPTS = 5;

// 64 字元 hex 白名單：doGet 注入與所有 token 查詢的第一道閘門
function inviteTokenValid_(token) {
  return typeof token === "string" && /^[a-f0-9]{64}$/.test(token);
}

// Drive 檔案 ID 格式白名單：?sheet= 深連結的 doGet 注入閘門（實際約 44 字元，範圍放寬）
function sheetParamValid_(id) {
  return typeof id === "string" && /^[A-Za-z0-9_-]{20,100}$/.test(id);
}

function newInviteToken_() {
  return (Utilities.getUuid() + Utilities.getUuid()).replace(/-/g, "").toLowerCase();
}

// 6 位數字 OTP 白名單：inviteeLogin 第二參數的第一道閘門
function inviteOtpValid_(otp) {
  return typeof otp === "string" && /^\d{6}$/.test(otp);
}

// 取 uuid 前 12 位 hex 轉十進位再取 6 位（16^12 對 10^6 的模數偏差可忽略），不足補零
function newInviteOtp_() {
  let n = parseInt(Utilities.getUuid().replace(/-/g, "").slice(0, 12), 16) % 1000000;
  return String(n).padStart(6, "0");
}

// 列上只存 hash 不存明碼：SHA-256(otp + 邀請碼)，邀請碼當 salt——
// 拿到 _invites 分頁讀取權的人也無法直接讀出可用的 OTP
function inviteOtpHash_(otp, inviteToken) {
  return Utilities.base64Encode(
    Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, otp + inviteToken)
  );
}

// 邀請信有效期（毫秒）：讀 ScriptProperties 的 inviteTtlMinutes（分鐘，管理者自訂），
// 未設或非正整數退回預設（INVITE_TTL_DEFAULT_MINUTES）。全系統時間一律 ms（見 CLAUDE.md）
function inviteTtlMs_() {
  let minutes = parseInt((appProperties.getProperty('inviteTtlMinutes') || '').toString().trim(), 10);
  if(isNaN(minutes) || minutes <= 0) { minutes = INVITE_TTL_DEFAULT_MINUTES; }
  return minutes * 60 * 1000;
}

// 邀請效期：min(發出後 ttlMs, 問卷 dueDate)——不讓邀請活過問卷截止
function inviteExpireAt_(nowMs, dueDateMs, ttlMs) {
  return Math.min(nowMs + ttlMs, dueDateMs);
}

// 邀請物件 ⇄ 分頁列（14 欄）互轉；OTP 三欄缺漏時以「無有效 OTP」補齊（舊 11 欄列向下相容）
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
    invite.updatedAt,
    invite.otpHash === undefined ? "" : invite.otpHash,
    invite.otpExpireAt === undefined ? 0 : invite.otpExpireAt,
    invite.otpAttempts === undefined ? 0 : invite.otpAttempts
  ];
}

function parseInviteRow_(row) {
  let otpExpireAt = row[12] === undefined || row[12].toString() === "" ? 0 : parseInt(row[12].toString());
  let otpAttempts = row[13] === undefined || row[13].toString() === "" ? 0 : parseInt(row[13].toString());
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
    updatedAt: parseInt(row[10].toString()),
    otpHash: row[11] === undefined ? "" : row[11].toString(),
    otpExpireAt: otpExpireAt,
    otpAttempts: otpAttempts
  };
}

// 讀取時衍生狀態：無列=none；revoked/consumed 是 append 快照的落地終態（純 append 模型，
// 撤回/消耗不刪列改 append 終態列，見 Phase 16）；signed 永遠算 signed（簽完不因時間失效）；
// 其餘看 expireAt 推導 expired（不落地）
function inviteStatusFor_(invite, nowMs) {
  if(invite === null || invite === undefined) { return 'none'; }
  if(invite.status === 'revoked' || invite.status === 'consumed') { return invite.status; }
  if(invite.status === 'signed') { return 'signed'; }
  if(nowMs >= invite.expireAt) { return 'expired'; }
  return 'pending';
}

// 狀態機矩陣：send=發/重發/換email（signed 需 force：作廢舊簽名重發，由 RPC 層二段確認）、
// revoke=撤回（signed 需 force，由 RPC 層另行裁決）、sign=受邀者送出簽名（過期即不可簽）。
// revoked/consumed 為終態：可重新發邀請（send=true），但不能再撤回/簽名
function inviteTransition_(currentStatus, action) {
  let allowed = {
    send:   { none: true,  pending: true, expired: true,  signed: false, revoked: true,  consumed: true },
    revoke: { none: false, pending: true, expired: true,  signed: false, revoked: false, consumed: false },
    sign:   { none: false, pending: true, expired: false, signed: false, revoked: false, consumed: false }
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
    // 新表：直接帶人類可讀表頭 + 凍結首列（無既有資料，零風險）。
    // 既有的舊表（資料從第 1 列開始、無表頭）不在此自動補，改由手動 initInviteHeader() 一次性處理
    sheet = draftSS.insertSheet(INVITE_SHEET_NAME);
    sheet.appendRow(INVITE_HEADER);
    sheet.setFrozenRows(1);
  }
  return sheet;
}

// 第 1 列是否已是表頭（marker = 首欄字面字串，真實邀請碼為 64-hex 永不相等）
function inviteHeaderPresent_(sheet) {
  if(sheet.getLastRow() < 1) { return false; }
  return sheet.getRange(1, 1, 1, 1).getValues()[0][0].toString() === INVITE_HEADER[0];
}

// 一次性維護：替既有 _invites 補上人類可讀表頭（新表由 inviteSheet_ 建立時已自帶）。
// 從 Apps Script 編輯器手動執行一次即可，**請在系統無人使用時跑**——既有資料從第 1 列開始，
// 補表頭需 insertRowBefore(1) 把資料整列下移（不刪、不覆寫任何資料），若同時有人寫入，位移會
// 導致寫錯列，故用 ScriptLock 保護並要求離峰手動執行。冪等：已有表頭則不動。
function initInviteHeader() {
  let lock = LockService.getScriptLock();
  lock.waitLock(30000);
  try {
    let sheet = inviteSheet_();
    if(inviteHeaderPresent_(sheet)) { return '已有表頭，未變更'; }
    if(sheet.getLastRow() === 0) {
      sheet.appendRow(INVITE_HEADER);
    } else {
      sheet.insertRowBefore(1);
      sheet.getRange(1, 1, 1, INVITE_HEADER.length).setValues([INVITE_HEADER]);
    }
    sheet.setFrozenRows(1);
    return '已補上表頭';
  } finally {
    lock.releaseLock();
  }
}

// ===== 純 append 快照模型（Phase 16）=====
// _invites 是 append-only 日誌：發/重發/寄OTP/OTP錯誤累加/簽名/撤回/消耗，每個動作都 append 一筆
// 完整 14 欄快照，**永不 setValues、永不 deleteRow**。「當前狀態」＝每格（referSSID|主鍵值|簽名格）
// 最新一列（append 保序，後列覆蓋同格前列）；失效（expired/superseded/終態）一律讀取端判定。

// 每格識別鍵：JSON 陣列編碼，分隔無歧義（避免欄位值內含分隔字元誤合併）；僅記憶體分組用，不落地
function inviteCellKey_(referSSID, primaryValue, signName) {
  return JSON.stringify([referSSID, primaryValue, signName]);
}

// 掃全表回「每格最新快照」的 parse 後物件清單。跳過第 1 列表頭（若有）；後出現的列覆蓋同格先前的列
function latestInvites_(sheet) {
  let lastRow = sheet.getLastRow();
  if(lastRow === 0) { return []; }
  let rows = sheet.getRange(1, 1, lastRow, INVITE_SHEET_COLS).getValues();
  let byCell = {};
  for(let i=0; i<rows.length; i++) {
    if(i === 0 && rows[0][0].toString() === INVITE_HEADER[0]) { continue; } // 跳過表頭列
    let invite = parseInviteRow_(rows[i]);
    byCell[inviteCellKey_(invite.referSSID, invite.primaryValue, invite.signName)] = invite;
  }
  return Object.keys(byCell).map((k) => byCell[k]);
}

// 某格最新快照（無則 null）
function latestInviteForCell_(sheet, referSSID, primaryValue, signName) {
  let key = inviteCellKey_(referSSID, primaryValue, signName);
  let all = latestInvites_(sheet);
  for(let i=0; i<all.length; i++) {
    if(inviteCellKey_(all[i].referSSID, all[i].primaryValue, all[i].signName) === key) {
      return all[i];
    }
  }
  return null;
}

// 以邀請碼找「該格最新快照」；若此 token 只出現在被同格更新列取代的舊快照（重發後的舊碼）→
// 它不會是任何一格的最新列 → 回 null（superseded 失效，correctness 關鍵）
function latestInviteForToken_(sheet, token) {
  let all = latestInvites_(sheet);
  for(let i=0; i<all.length; i++) {
    if(all[i].token === token) { return all[i]; }
  }
  return null;
}

// 某填寫者在某問卷的「每格最新快照」（純 append 模型：取每格最新列，非全部歷史列）
function invitesForUser_(referSSID, primaryValue) {
  let sheet = inviteSheet_();
  return latestInvites_(sheet).filter((inv) => {
    return inv.referSSID === referSSID && inv.primaryValue === primaryValue;
  });
}

// ===== 暫存試算表定期重建（Phase 18）=====
// Phase 16/17 純 append 化後的「量大離線壓縮」具體化：建新暫存試算表（草稿分頁留每主鍵最新列、
// _invites 留每格最新快照、認不得的分頁原樣複製），舊表改名搬進備份資料夾（不可變備份、
// 稽核軌跡零丟失、不線上刪列），最後翻 ScriptProperties 的 draftSheetID 原子換手——
// draftSheet_/inviteSheet_ 每次呼叫都即時 getProperty 再 openById，換手後所有 RPC 自動吃新表。
// 必須放本檔（web app 專案）、不可放 tools/：LockService/ScriptProperties 都是 per-project，
// tools/ 是問卷列表 container-bound 專案，拿的鎖擋不住本專案的寫入、也讀不到 draftSheetID。
// 觸發：管理者在 Apps Script 編輯器手動掛時間觸發器指向 rebuildDraftSpreadsheet
// （程式不自建 trigger），亦可手動執行；**建議離峰**——重建全程持 ScriptLock，期間寫入
// 等鎖 10 秒逾時會拋錯（前端顯示可重試錯誤）。失敗殘局皆無害、可重跑：翻 property 前掛＝
// 新表成孤兒檔、舊表照常；翻後搬移前掛＝系統已在新表、舊表原地待人工搬。

// _invites 壓縮（Phase 18 離線重建用）：每格（referSSID+主鍵值+簽名格）留最新一列**原樣快照**——
// 零語意判讀：終態（revoked/consumed）、過期、attempts 滿的列只要是該格最新列就照抄保留，
// 不趁機丟，完整歷史在備份檔。跳過表頭列。純函數不碰 GAS 全域，可 vitest
function compactInviteRows_(rows) {
  let byCell = {};
  let order = [];
  for(let i=0; i<rows.length; i++) {
    if(i === 0 && rows[0][0].toString() === INVITE_HEADER[0]) { continue; } // 跳過表頭列
    let key = inviteCellKey_(rows[i][1].toString(), rows[i][3].toString(), rows[i][4].toString());
    if(!(key in byCell)) { order.push(key); }
    byCell[key] = rows[i];
  }
  return order.map((key) => byCell[key]);
}

// 門檻：ScriptProperties 的 draftRebuildMinRows（正整數），全表資料列數低於門檻就跳過重建
// （避免低流量期每次觸發都堆一個幾乎沒縮的備份檔）；未設或非正整數＝0＝永遠重建
function draftRebuildMinRows_() {
  let n = parseInt((appProperties.getProperty('draftRebuildMinRows') || '').toString().trim(), 10);
  return (isNaN(n) || n <= 0) ? 0 : n;
}

// 手動維運進入點：GAS 編輯器執行函數不顯示 return 值，故在此把結果 console.log 進執行紀錄，
// 讓管理者手動跑時看得到走了哪條路徑（門檻跳過、未設 folder、重建完成…）。實體邏輯在 _ 版
function rebuildDraftSpreadsheet() {
  let result = rebuildDraftSpreadsheet_();
  console.log(result);
  return result;
}

function rebuildDraftSpreadsheet_() {
  let lock = LockService.getScriptLock();
  lock.waitLock(30000);
  try {
    // 前置檢查：任一不過直接 return，不動任何東西（fail-safe：沒有備份目的地就不重建）
    if(!draftEnabled_()) { return '線上暫存未啟用，未重建'; }
    let folderID = (appProperties.getProperty('draftBackupFolderID') || '').toString().trim();
    if(folderID === '') { return '未設定 draftBackupFolderID（備份資料夾），未重建'; }
    let backupFolder;
    try {
      backupFolder = DriveApp.getFolderById(folderID);
      backupFolder.getName(); // 確認真的開得起來（無效 ID 可能到第一次操作才拋錯）
    } catch(err) {
      return 'draftBackupFolderID 開啟失敗（' + err + '），未重建';
    }
    let oldSS = SpreadsheetApp.openById(appProperties.getProperty('draftSheetID'));
    let sheets = oldSS.getSheets();
    // 門檻檢查（getLastRow 便宜，不必讀全表）：資料列數＝各分頁列數扣表頭列
    let minRows = draftRebuildMinRows_();
    if(minRows > 0) {
      let totalDataRows = 0;
      sheets.forEach((sheet) => {
        let lastRow = sheet.getLastRow();
        if(lastRow === 0) { return; }
        let first = sheet.getRange(1, 1, 1, 1).getValues()[0][0].toString();
        totalDataRows += lastRow - ((first === DRAFT_HEADER[0] || first === INVITE_HEADER[0]) ? 1 : 0);
      });
      if(totalDataRows < minRows) {
        return '未達門檻（資料 ' + totalDataRows + ' 列 < draftRebuildMinRows ' + minRows + '），未重建';
      }
    }
    // 建新表：未上線檔案，bulk setValues 合法——「一律 append」保護的是線上表（Phase 16 已明文
    // 允許離線重建整張表）。預設空白分頁先改暫名避免與來源分頁同名相撞，最後刪掉
    // （空佔位分頁、非資料列，不違反禁刪列）
    let now = (new Date()).getTime();
    let newSS = SpreadsheetApp.create(oldSS.getName());
    let placeholder = newSS.getSheets()[0];
    placeholder.setName('__rebuild_' + now);
    let expected = [];
    let summary = [];
    sheets.forEach((sheet) => {
      let name = sheet.getName();
      let lastRow = sheet.getLastRow();
      let lastCol = sheet.getLastColumn();
      let values = (lastRow > 0 && lastCol > 0) ? sheet.getRange(1, 1, lastRow, lastCol).getValues() : [];
      let frozen = false;
      let outRows;
      if(name === INVITE_SHEET_NAME) {
        outRows = [INVITE_HEADER].concat(compactInviteRows_(values));
        frozen = true;
      } else if(values.length > 0 && values[0][0].toString() === DRAFT_HEADER[0]) {
        outRows = [DRAFT_HEADER].concat(compactDraftRows_(values));
        frozen = true;
      } else {
        outRows = values; // 認不得的分頁原樣整份複製（fail-safe，不解讀未知格式）
      }
      let newSheet = newSS.insertSheet(name);
      if(outRows.length > 0) {
        // 表頭與變長資料列補 '' 對齊成矩形（setValues 需要等寬）
        let width = 0;
        outRows.forEach((row) => { width = Math.max(width, row.length); });
        let rect = outRows.map((row) => {
          let padded = row.slice();
          while(padded.length < width) { padded.push(""); }
          return padded;
        });
        newSheet.getRange(1, 1, rect.length, width).setValues(rect);
      }
      if(frozen) { newSheet.setFrozenRows(1); }
      expected.push({ name: name, rows: outRows.length });
      summary.push(name + ' ' + values.length + '→' + outRows.length + ' 列');
    });
    newSS.deleteSheet(placeholder);
    SpreadsheetApp.flush();
    // sanity check：重新開啟新表逐分頁比對列數，不合就不翻 property（新表留存供人工檢查）
    let verifySS = SpreadsheetApp.openById(newSS.getId());
    for(let i=0; i<expected.length; i++) {
      let verifySheet = verifySS.getSheetByName(expected[i].name);
      if(verifySheet === null || verifySheet.getLastRow() !== expected[i].rows) {
        return 'sanity check 失敗（分頁 ' + expected[i].name + '）：draftSheetID 未變更，新表 ' +
          newSS.getId() + ' 留存供人工檢查';
      }
    }
    // 原子換手生效點：翻 property 後所有 RPC 自動吃新表（寫入點皆鎖內 open，等本鎖釋放後進新表）
    let oldID = oldSS.getId();
    appProperties.setProperty('draftSheetID', newSS.getId());
    // 新表搬到舊表原父資料夾（Drive 整潔）；舊表改名帶時間戳搬進備份資料夾
    // （moveTo 不改 file ID，換手前已 open 的無鎖 reader 照讀）
    let oldFile = DriveApp.getFileById(oldID);
    let newFile = DriveApp.getFileById(newSS.getId());
    let parents = oldFile.getParents();
    if(parents.hasNext()) { newFile.moveTo(parents.next()); }
    oldFile.setName(oldFile.getName() + '｜備份 ' +
      Utilities.formatDate(new Date(now), Session.getScriptTimeZone(), 'yyyy-MM-dd HH:mm') +
      '（' + now + '）');
    oldFile.moveTo(backupFolder);
    return '重建完成：' + sheets.length + ' 個分頁（' + summary.join('、') + '）；新表 ' +
      newSS.getId() + '；舊表已改名搬入備份資料夾';
  } finally {
    lock.releaseLock();
  }
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

// 發邀請＝重發＝換 Email 同一支：對（本人, 簽名格）append 新 token 快照（舊 token 因非該格最新列自動失效）。
// signed 的格預設拒絕（回最新狀態讓前端二段確認），force=true 才作廢舊簽名檔重發——
// 簽名必須出自受邀者本人，「簽得不滿意」的救濟是請對方重簽，不是填寫者本機代簽
function sendInvite(referSSID, recordSSID, token, signName, email, force) {
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
    let expireAt = inviteExpireAt_(now, dueDate, inviteTtlMs_());
    let lock = LockService.getScriptLock();
    lock.waitLock(10000);
    try {
      let sheet = inviteSheet_();
      let existing = latestInviteForCell_(sheet, referSSID, claims.pkey, signName);
      let createdAt = now;
      if(existing !== null) {
        let existingStatus = inviteStatusFor_(existing, now);
        if(existingStatus === 'signed') {
          if(force !== true) {
            return {
              success: false,
              status: 'signed',
              invite: {
                signName: existing.signName,
                email: existing.email,
                expireAt: existing.expireAt,
                status: 'signed',
                image: signatureDataUrl_(existing.fileID)
              },
              message: "這一格已經完成簽名！重發邀請會作廢對方目前的簽名。"
            };
          }
          if(existing.fileID !== "") {
            DriveApp.getFileById(existing.fileID).setTrashed(true);
          }
        } else if(!inviteTransition_(existingStatus, 'send')) {
          return { success: false, message: "這一格目前的狀態不能發邀請" };
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
        updatedAt: now,
        // OTP 三欄是「新邀請」這筆新事實的初始空值（新 token 還沒寄過 OTP，hash 也綁不上舊 token）；
        // 不是清空舊資料——舊快照原樣留在表上，只是因非最新列而失效（superseded）
        otpHash: '',
        otpExpireAt: 0,
        otpAttempts: 0
      };
      sheet.appendRow(inviteRowOf_(invite)); // 純 append：一律新增快照，永不覆寫舊列
    } finally {
      lock.releaseLock();
    }
    // 寄邀請信（在鎖外，寄信慢）；信只含純文字邀請碼 + 到期時間，
    // 刻意不放 script.google.com 連結——GAS 網址是釣魚重災區，outlook.com 等會無聲丟棄整封信；
    // 網站網址請受邀者向填寫者索取（?token= 直連入口仍保留，可由填寫者自行分享）
    let formTitle = listRow[0].toString().trim();
    let replyEmail = listRow[12].toString().trim();
    let systemTitle = appProperties.getProperty('systemTitle');
    MailApp.sendEmail(email, replyEmail, systemTitle + "簽名邀請：" + formTitle,
      "您好：\n" + maskString(claims.pkey) + " 邀請您在表單「" + formTitle + "」中簽署「" + signName + "」欄位。\n\n" +
      "為了郵件安全，本信不附網址。請向邀請您的填寫者索取表單網站網址，\n" +
      "開啟網站後選擇「我有簽名邀請碼」，貼上這組邀請碼：\n" + inviteToken + "\n\n" +
      "貼上邀請碼後，系統會再寄一組 6 位數的一次性驗證碼到這個信箱，\n" +
      "輸入驗證碼即可檢視問卷並簽名。\n\n" +
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
      let invite = latestInviteForCell_(sheet, referSSID, claims.pkey, signName);
      if(invite === null) { return { success: true, status: 'none' }; }
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
      if(status === 'revoked' || status === 'consumed') {
        return { success: true, status: 'none' }; // 已是終態，無需再 append
      }
      if(status === 'signed' && invite.fileID !== "") {
        DriveApp.getFileById(invite.fileID).setTrashed(true);
      }
      // 純 append：不刪列、也不清空任何欄位——append 一筆「原狀態忠實快照 + status=revoked」，
      // fileID/email/OTP 全保留供稽核（fileID 指向的簽名檔雖已 trash，但終態列沒有 reader 會去讀它）
      invite.status = 'revoked';
      invite.updatedAt = now;
      sheet.appendRow(inviteRowOf_(invite));
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
      // revoked/consumed 是終態快照，對填寫者等同「未邀請」，不列出（與舊 deleteRow 行為一致）
      if(status === 'revoked' || status === 'consumed') { continue; }
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

// requestInviteOtp 與 inviteeLogin 的共用前段：邀請碼格式白名單 → 查列 →
// 表單未過期未關閉 → 邀請未過期（signed 放行：受邀者可回來查看自己的簽名）。
// 任何不合法情況回 null（呼叫端一律回 false 不透露原因）
function resolveActiveInvite_(token) {
  if(!inviteTokenValid_(token)) { return null; }
  let sheet = inviteSheet_();
  let invite = latestInviteForToken_(sheet, token);
  if(invite === null) { return null; } // 找不到，或已被重發取代（superseded）
  let listRow = listRowFor_(invite.referSSID, invite.recordSSID);
  if(listRow === null) { return null; }
  let now = (new Date()).getTime();
  let dueDate = parseInt(listRow[3].toString());
  if(now > dueDate) { return null; }
  if(listRow[14].toString().trim() === "否") { return null; }
  let status = inviteStatusFor_(invite, now);
  if(status === 'expired' || status === 'revoked' || status === 'consumed') { return null; }
  return { invite: invite, listRow: listRow, dueDate: dueDate, now: now, status: status };
}

// 受邀者登入第一步：驗邀請碼並即時寄 6 位數一次性驗證碼（OTP）到邀請列登記的信箱。
// RPC 不收 email 參數（絕不信前端）；列上只存 hash。邀請碼不合法一律回 false 不透露原因
function requestInviteOtp(inviteToken) {
  return logged_('requestInviteOtp', () => {
    if(!draftEnabled_()) { return false; }
    let resolved = resolveActiveInvite_(inviteToken);
    if(resolved === null) { return false; }
    // 節流：上一組 OTP 寄出（= otpExpireAt - TTL）後 60 秒內不重寄，擋 reload 濫發
    let sentAt = resolved.invite.otpExpireAt - INVITE_OTP_TTL_MS;
    if(resolved.invite.otpExpireAt !== 0 && resolved.now < sentAt + INVITE_OTP_COOLDOWN_MS) {
      return {
        success: false,
        cooldownSeconds: Math.ceil((sentAt + INVITE_OTP_COOLDOWN_MS - resolved.now) / 1000),
        maskedEmail: maskEmail_(resolved.invite.email)
      };
    }
    if(MailApp.getRemainingDailyQuota() <= 0) {
      return { success: false, message: "今日系統 Email 額度已用盡，請稍後再試或聯絡填寫者" };
    }
    let otp = newInviteOtp_();
    let lock = LockService.getScriptLock();
    lock.waitLock(10000);
    try {
      let sheet = inviteSheet_();
      let invite = latestInviteForToken_(sheet, inviteToken);
      if(invite === null) { return false; } // 剛被填寫者撤回/重發（superseded）
      invite.otpHash = inviteOtpHash_(otp, inviteToken);
      invite.otpExpireAt = resolved.now + INVITE_OTP_TTL_MS;
      invite.otpAttempts = 0;
      invite.updatedAt = resolved.now;
      sheet.appendRow(inviteRowOf_(invite)); // 純 append：新增帶 OTP 的快照
    } finally {
      lock.releaseLock();
    }
    // 寄 OTP 信（鎖外，寄信慢）：純文字、刻意無任何網址（釣魚過濾會無聲丟信）
    let formTitle = resolved.listRow[0].toString().trim();
    let replyEmail = resolved.listRow[12].toString().trim();
    let systemTitle = appProperties.getProperty('systemTitle');
    MailApp.sendEmail(resolved.invite.email, replyEmail, systemTitle + "一次性驗證碼",
      "您好：您正在使用簽名邀請碼進入表單「" + formTitle + "」。\n\n" +
      "您的一次性驗證碼（10 分鐘內有效）：\n" + otp + "\n\n" +
      "請回到網站輸入這組 6 位數驗證碼，即可檢視問卷並簽名。\n" +
      "若非您本人操作，請忽略本信。\n" +
      "任何問題，請回信至：" + replyEmail);
    return { success: true, maskedEmail: maskEmail_(resolved.invite.email) };
  });
}

// 受邀者登入第二步：邀請碼 + email OTP 雙因子通過才回問卷內容並簽發 session JWT，
// 之後受邀者的 RPC 只帶 session token。OTP 通過前不回傳任何問卷內容（挑戰與回傳同一支 RPC）。
// 邀請碼不合法一律回 false 不透露原因；OTP 錯誤回 { otpFailed }——requestInviteOtp 成功
// 已揭露邀請碼有效，這裡區分不增加洩漏。比對/計次/作廢都在 ScriptLock 內，防並發暴力嘗試
function inviteeLogin(token, otp) {
  return logged_('inviteeLogin', () => {
    if(!draftEnabled_()) { return false; }
    let resolved = resolveActiveInvite_(token);
    if(resolved === null) { return false; }
    let otpError = { otpFailed: true, message: "驗證碼錯誤或已逾時，請重新輸入或按重寄" };
    if(!inviteOtpValid_(otp)) { return otpError; }
    let invite;
    let lock = LockService.getScriptLock();
    lock.waitLock(10000);
    try {
      let sheet = inviteSheet_();
      invite = latestInviteForToken_(sheet, token);
      if(invite === null) { return false; } // 剛被填寫者撤回/重發（superseded）
      if(invite.otpHash === "" || resolved.now >= invite.otpExpireAt ||
         invite.otpAttempts >= INVITE_OTP_MAX_ATTEMPTS) {
        return otpError;
      }
      if(inviteOtpHash_(otp, token) !== invite.otpHash) {
        // 純 append：只記「又錯一次」這個事實，其餘欄位原樣保留。
        // 連錯滿 INVITE_OTP_MAX_ATTEMPTS 的「作廢」不落地——上方 otpAttempts >= MAX 的
        // 讀取端判斷就是作廢本身（append 模型：失效一律由程式判讀，不寫空值）
        invite.otpAttempts = invite.otpAttempts + 1;
        invite.updatedAt = resolved.now;
        sheet.appendRow(inviteRowOf_(invite));
        return otpError;
      }
      // 比對成功：單次使用＝「這組 OTP 的效期在被使用那一刻終止」——append 一筆
      // otpExpireAt 記為使用當下的事實快照（hash/attempts 原樣保留供稽核），
      // 重放同一組 OTP 走上方既有的 now >= otpExpireAt 判斷自然被拒，不清空任何欄位
      invite.otpExpireAt = resolved.now;
      invite.updatedAt = resolved.now;
      sheet.appendRow(inviteRowOf_(invite));
    } finally {
      lock.releaseLock();
    }
    let status = inviteStatusFor_(invite, resolved.now);
    let result = {
      sheetName: resolved.listRow[0].toString().trim(),
      comment: resolved.listRow[7].toString().trim(),
      refer: invite.referSSID,
      record: invite.recordSSID,
      dueDate: resolved.dueDate,
      signName: invite.signName,
      expireAt: invite.expireAt,
      // 邀請發出時間：受邀者畫面生命週期時間軸的起點（重發沿用原值，起點不跳動）
      inviteCreatedAt: invite.createdAt,
      maskedPkey: maskString(invite.primaryValue),
      alreadySigned: status === 'signed',
      headers: buildReadonlyHeaders_(invite.referSSID, invite.primaryValue),
      sessionToken: issueInviteSession_(invite, resolved.now, resolved.dueDate)
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
      return { success: false, tokenExpired: true, message: "登入已逾時，請重新貼上邀請信中的驗證碼進入" };
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
      let invite = latestInviteForToken_(sheet, claims.invite);
      if(invite === null) {
        return { success: false, revoked: true, message: "這份邀請已被填寫者撤回或重發，你的簽名沒有送出；請聯絡填寫者重新邀請" };
      }
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
      sheet.appendRow(inviteRowOf_(invite)); // 純 append：signed 快照
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
                          // 「不提供資料」是 N 欄位留空的落地哨兵：回填時轉回空值，
                          // 前端不需要認識這個字串（lastInput 保留原字樣供顯示）。
                          // 「無資料」（D 欄位）刻意原樣回填——按鈕按下狀態由 value 導出
                          column.value = column.lastInput === "不提供資料" ? "" : column.lastInput;
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
            // 第 7/8 列改 regex test（原本精確比對）：既有單字母資料行為不變，
            // 第 8 列開放組合詞彙 N/D/ND——D＝可宣告「無資料」（Phase 15）
            must: /M/.test(referArr[6][i].toString().trim()),
            nullable: /N/.test(referArr[7][i].toString().trim()),
            noneable: /D/.test(referArr[7][i].toString().trim()),
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
                if(column.noneable && data.value === "無資料") {
                  // Phase 15：D 欄位的「無資料」宣告——哨兵字串原樣寫入紀錄，
                  // 下游可區分「宣告沒有」與「留白/漏填」；跳過格式檢查、通過必填
                  column.value = "無資料";
                } else if(column.nullable && data.value === "不提供資料") {
                  // N 欄位留空（上方伺服器換上的哨兵）：2026-07-11 起哨兵原樣落地，
                  // 紀錄不再是空白（readRecord 回填時會轉回空值，前端看不到這個字串）。
                  // 跳過條件同時限縮到 nullable 欄位——非 N 欄位送這個字串改走下面的
                  // 格式檢查（原本「任何欄位都能跳過檢查」的逃生門就此關閉，見 issue.md）
                  column.value = "不提供資料";
                } else {
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
                  let nowConsume = (new Date()).getTime();
                  // 純 append：token 用畢即焚——對本人這份問卷每個「非終態」的邀請格 append 一筆
                  // consumed 終態快照（不刪列、不清空任何欄位：原狀態忠實快照 + status=consumed，
                  // fileID/email/OTP 全保留供稽核；簽名檔已記進紀錄列不動）
                  let userInvites = latestInvites_(inviteSheet).filter((inv) => {
                    return inv.referSSID === referSSID && inv.primaryValue === primaryData;
                  });
                  for(let i=0; i<userInvites.length; i++) {
                    let inv = userInvites[i];
                    let st = inviteStatusFor_(inv, nowConsume);
                    if(st === 'revoked' || st === 'consumed') { continue; } // 已終態不重複 append
                    inv.status = 'consumed';
                    inv.updatedAt = nowConsume;
                    inviteSheet.appendRow(inviteRowOf_(inv));
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

// email 專用遮罩：只遮 @ 前的本地部分（保留頭尾各一字，中間換成 3 個 *），
// 網域原樣保留——例：johndoe@gmail.com → j***e@gmail.com。無 @ 或本地過短時退回頭字元 + ***
function maskEmail_(email) {
  let str = (email === undefined || email === null) ? "" : email.toString().trim();
  let at = str.indexOf("@");
  if(at <= 0) {
    return str.slice(0, 1) + "***";
  }
  let local = str.slice(0, at);
  let domain = str.slice(at); // 含 @
  if(local.length <= 2) {
    return local.slice(0, 1) + "***" + domain;
  }
  return local.slice(0, 1) + "***" + local.slice(-1) + domain;
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