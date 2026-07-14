// 每題「答案來源」的切換與帶入（Phase 23）。全部是純函數。
//
// 一題最多有四個答案來源，對應 FieldValueSwitch 的 el-segmented 四個選項：
//   saved  預設值     ← column.savedContent（名冊母表該人該欄）
//   last   你上次的   ← column.lastInput（紀錄表該主鍵最後一列＝上次送出）
//   draft  暫存       ← column.draftOrigin（登入時從 localStorage／線上草稿疊回的值）
//   user   你現在填的 ← column.userInput（使用者自己動手填的值；沒填過就 disabled 不能選）
//
// 切換來源＝把該來源的值**自動帶進 column.value**（不必再按「帶入」鈕）。
// 使用者一動手（打字/選單/滑桿/上傳/多選/查郵遞區號/「無資料」按鈕）就 markUserInput()：
// 把當下的值記進 userInput、來源切回 'user'——所以「切去看預設值再切回來」不會弄丟自己填的東西。
import _ from 'lodash';
import { formatDetector } from './columnRules';
import { REUSE_LAST_FILE } from './sentinels';

// 📝 是後端寫進試算表的防轉型前綴（見 plan/issue.md）。lastInput 在 readRecord 已被剝除，
// savedContent 來自名冊母表可能殘留，一律防呆
export function stripMark(raw) {
  return raw === null || raw === undefined ? '' : String(raw).replace(/^📝/, '');
}

function normalize(raw) {
  return raw === null || raw === undefined ? '' : String(raw);
}

export function isFileField(column) {
  return formatDetector('F', 'F', column);
}

// U 欄（多選）：只留 content 選項清單裡真的有的項目（防帶入已被移除的舊選項）。
// columnPrep 的疊回也走這支，兩邊同一套過濾規則
export function filterMultiValue(column, raw) {
  let selectionConfig = String(column.content).split('::');
  if (selectionConfig.length < 2) return '';
  let selections = _.uniq(selectionConfig[1].split(';'));
  let selected = _.uniq(stripMark(raw).split(';'));
  return _.join(_.intersection(selected, selections), ';');
}

// 某個來源的原始值（未經 format 轉換）
export function rawOfSource(column, kind) {
  if (kind === 'saved') return column.savedContent;
  if (kind === 'last') return column.lastInput;
  if (kind === 'draft') return column.draftOrigin ? column.draftOrigin.val : undefined;
  if (kind === 'user') return column.userInput;
  return undefined;
}

// 帶入時 raw 要塞進 column.value 的形式（檔案欄不走這裡，見 applySource）
export function coerceSourceValue(column, raw) {
  if (formatDetector('U', 'F', column)) {
    return filterMultiValue(column, raw);
  }
  if (formatDetector('L', 'F', column)) {
    return parseInt(stripMark(raw), 10);
  }
  // T/I/M/N/E/P/X/S 直塞。S（下拉）即使帶入的值不在選項裡也照塞，
  // 交給 validateColumn 標紅讓使用者看見，不默默吞掉
  return stripMark(raw);
}

// 檔案欄：某個來源對應到哪個檔案連結。
//   lastInput  ＝上次送出的檔案（readRecord 給，前端永不覆寫）
//   uploadUrl  ＝這次 saveFile 上傳的檔案（applyFileUpload／暫存還原時寫）
// 「沿用上次」的哨兵指向的就是上次送出的那個檔案，故回 lastInput
export function fileUrlOfSource(column, kind) {
  if (!isFileField(column)) return '';
  if (kind === 'last') return normalize(column.lastInput);
  if (kind === 'saved') return normalize(column.savedContent);
  let val = kind === 'draft' ? (column.draftOrigin ? column.draftOrigin.val : '') : column.value;
  if (val === REUSE_LAST_FILE) return normalize(column.lastInput);
  return normalize(column.uploadUrl);
}

// 使用者自己填的值可不可用（「你現在填的」這個選項要不要 active）——沒動過手就不能選
export function hasUserInput(column) {
  if (column.userInput === undefined || column.userInput === null) return false;
  if (typeof column.userInput === 'number') return !isNaN(column.userInput);
  return String(column.userInput) !== '';
}

// 這個來源有沒有東西可帶（沒有就不長出那個選項）
export function hasSource(column, kind) {
  if (kind === 'user') return hasUserInput(column);
  if (kind === 'draft') return column.draftOrigin !== undefined && column.draftOrigin !== null;
  let raw = rawOfSource(column, kind);
  if (raw === undefined || raw === null || String(raw) === '') return false;
  // 檔案欄的「預設值」來自名冊，存的是檔名片段不是 fileID，後端無從安全解析 → 不給選
  if (kind === 'saved' && isFileField(column)) return false;
  // L 欄轉不出數字的來源不給選（帶入只會得到 NaN）
  if (formatDetector('L', 'F', column)) {
    return !isNaN(parseInt(stripMark(raw), 10));
  }
  return true;
}

export const SOURCE_LABELS = {
  saved: '預設值',
  last: '你上次的',
  draft: '暫存',
  user: '你現在填的',
};

const DRAFT_SOURCE_TEXT = {
  local: '本機暫存',
  online: '雲端暫存',
  import: '匯入的暫存檔',
};

export function draftSourceText(column) {
  if (!column.draftOrigin) return '';
  return DRAFT_SOURCE_TEXT[column.draftOrigin.source] || '暫存';
}

// el-segmented 的選項清單：只列真的有值的來源；「你現在填的」永遠列出，但沒填過就 disabled
// （讓使用者看得到「這格會放我自己填的」，而不是選項忽然冒出來）
export function buildSourceOptions(column) {
  let options = [];
  ['saved', 'last', 'draft'].forEach((kind) => {
    if (hasSource(column, kind)) {
      options.push({ label: SOURCE_LABELS[kind], value: kind, disabled: false });
    }
  });
  options.push({
    label: SOURCE_LABELS.user,
    value: 'user',
    disabled: !hasUserInput(column),
  });
  return options;
}

// 目前是哪個來源在生效。column.source 是唯一事實來源（切換與 markUserInput 都會寫它）；
// 沒有的話（剛登入、還沒動過）回推：值等於系統值就是 'saved'，否則當成使用者的值
export function currentSource(column) {
  if (column.source) return column.source;
  if (normalize(column.value) === normalize(stripMark(column.savedContent))) return 'saved';
  return 'user';
}

// 切換來源＝自動帶入該來源的值。檔案欄帶入的是哨兵（伺服器端查 fileID），
// 前端不持有、也不可能傳出舊 fileID
export function applySource(column, kind) {
  if (kind === 'user') {
    column.value = column.userInput;
  } else if (isFileField(column)) {
    // draft 疊回的值本身就可能已經是哨兵或 fileID（暫存記的是使用者當時的決定）；
    // last 一律換成哨兵
    column.value = kind === 'draft' ? column.draftOrigin.val : REUSE_LAST_FILE;
    column.status = '';
  } else {
    column.value = coerceSourceValue(column, rawOfSource(column, kind));
  }
  column.source = kind;
  return column.value;
}

// 使用者動手了：把當下的值記成「你現在填的」，來源切到 user。
// 切去看別的來源再切回來不會弄丟它
export function markUserInput(column) {
  column.userInput = column.value;
  column.source = 'user';
}

// 差異提示：目前值與上次送出值不同（檔案欄特化為「這次有新上傳」——沿用舊檔的哨兵不算改動）
export function differsFromLast(column) {
  if (column.lastInput === undefined) return false;
  if (isFileField(column)) {
    return column.value !== '' && column.value !== REUSE_LAST_FILE;
  }
  return normalize(column.value) !== normalize(stripMark(column.lastInput));
}
