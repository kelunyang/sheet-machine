// 送出前差異對照（Phase 23）：把「這次要送出的答案」與基準（上次送出／系統值）各組成一段純文字，
// 交給 DiffText 元件逐行 diff；檔案欄不進文字（比不了內容），另走前後連結對照。全部是純函數。
import { formatDetector } from './columnRules';
import { isFileField, stripMark } from './fieldSources';
import { REUSE_LAST_FILE } from './sentinels';

const EMPTY_TEXT = '（未填）';

function normalize(raw) {
  return raw === null || raw === undefined ? '' : String(raw);
}

// 進文字 diff 的欄位：使用者實際作答的欄（F-type），排除檔案欄（走檔案對照）、
// C 計算欄與 G 分組欄（非使用者輸入）
export function diffableColumns(columns) {
  return columns.filter((column) => {
    if (!/F/.test(column.type)) return false;
    if (/C|G/.test(column.type)) return false;
    return !isFileField(column);
  });
}

export function fileColumns(columns) {
  return columns.filter((column) => isFileField(column));
}

// 基準值：mode='last' 取上次送出（沒送出過的人自動退回系統值）、mode='saved' 取系統值
export function baselineValue(column, mode) {
  if (mode === 'saved') return stripMark(column.savedContent);
  return column.lastInput !== undefined
    ? stripMark(column.lastInput)
    : stripMark(column.savedContent);
}

// 一欄的值攤成 diff 的行（U 每個選項一行、X 多行原樣展開，空值留佔位讓「原本有值→清空」看得見）
function valueLines(column, raw) {
  let text = stripMark(raw);
  if (text === '') return [EMPTY_TEXT];
  if (formatDetector('U', 'F', column)) {
    return text.split(';').map((option) => '- ' + option);
  }
  return text.split('\n');
}

// 組成一側的純文字：【題名】＋值行＋空行
export function buildDiffText(columns, mode, side) {
  let blocks = [];
  diffableColumns(columns).forEach((column) => {
    let raw = side === 'baseline' ? baselineValue(column, mode) : column.value;
    blocks.push(['【' + column.name + '】'].concat(valueLines(column, raw)).join('\n'));
  });
  return blocks.join('\n\n') + '\n';
}

// 檔案欄的前後對照。
// before＝基準的檔案（'last' 取上次送出的 lastInput；'saved' 取名冊的 savedContent），
//         沒有就是「原本沒有檔案」——**不可退回 lastInput 以外的東西**。
// after ＝這次要送出的狀態：new（這次上傳，連結在 uploadUrl）／reuse（沿用上次，指向 lastInput）／none。
// 舊版把 after 的連結也讀 lastInput，而 applyFileUpload 又拿新 URL 蓋掉 lastInput，
// 於是「沒傳過檔的欄位這次傳了」會顯示成前後同一個檔案（實機回報的 bug）——現已分離。
export function buildFileComparison(columns, mode) {
  return fileColumns(columns).map((column) => {
    let beforeUrl =
      mode === 'saved' ? normalize(column.savedContent) : normalize(column.lastInput);
    let after = { kind: 'none', url: '' };
    if (column.value === REUSE_LAST_FILE) {
      after = { kind: 'reuse', url: normalize(column.lastInput) };
    } else if (normalize(column.value) !== '') {
      after = { kind: 'new', url: normalize(column.uploadUrl) };
    }
    return { name: column.name, beforeUrl: beforeUrl, after: after };
  });
}

// 有沒有任何差異（零差異就不必打擾使用者，直接進簽名/送出）
export function hasAnyDiff(columns, mode) {
  let textDiff = diffableColumns(columns).some((column) => {
    return normalize(stripMark(column.value)) !== normalize(baselineValue(column, mode));
  });
  if (textDiff) return true;
  // 檔案欄：只有「這次有新上傳」算差異——沿用舊檔的哨兵是「維持原狀」的宣告，不算
  return fileColumns(columns).some((column) => {
    return normalize(column.value) !== '' && column.value !== REUSE_LAST_FILE;
  });
}
