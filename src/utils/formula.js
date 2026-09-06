// 計算欄（C-S）的運算式引擎（Phase 30）。全部是純函數。
//
// 安全模型：jsep **只負責 parse**（把字串變成 AST，不執行任何東西），能不能跑、跑什麼
// 完全由下面這張白名單決定——只認六種節點，其餘一律丟錯（預設拒絕，jsep 日後支援新語法
// 也自動擋下）。特別是 MemberExpression（`a.b`）被擋掉＝屬性存取的入口關閉，scope 又以
// Object.create(null) 建（無原型，連 constructor 都摸不到），兩者互為雙保險。
// **明確不做 eval / new Function**——理由見 plan/plan.md Phase 30 與 plan/issue.md。
import _ from 'lodash';
import jsep from 'jsep';

// 顯示模板裡代表「結果插在這裡」的佔位符
const RESULT_SLOT = '{}';

// 📝 是後端寫進試算表的防轉型前綴（見 plan/issue.md），運算前一律剝掉。
// 轉不出有限數的一律當 0（例如選項字面值「是」）——要數個數請用 countif/filled
export function toNum(value) {
  const num = parseFloat(String(value === null || value === undefined ? '' : value).replace(/📝/g, ''));
  return Number.isFinite(num) ? num : 0;
}

function toText(value) {
  return String(value === null || value === undefined ? '' : value).replace(/📝/g, '');
}

// 白名單函數表：加新函數＝這裡加一行 ＋ 一個測試，不動 parser
export const CALC_FUNCTIONS = {
  // 等於目標值的欄位個數（「選了幾科」的標準寫法）
  countif: (target, ...values) => values.filter((v) => toText(v) === toText(target)).length,
  // 有填東西的欄位個數（選項值不統一時用）
  filled: (...values) => values.filter((v) => toText(v).trim() !== '').length,
  sum: (...values) => values.reduce((acc, v) => acc + toNum(v), 0),
  min: (...values) => (values.length === 0 ? 0 : Math.min(...values.map(toNum))),
  max: (...values) => (values.length === 0 ? 0 : Math.max(...values.map(toNum))),
  abs: (value) => Math.abs(toNum(value)),
  floor: (value) => Math.floor(toNum(value)),
  ceil: (value) => Math.ceil(toNum(value)),
  round: (value, digits) => {
    const scale = 10 ** Math.max(0, Math.trunc(toNum(digits)));
    return Math.round(toNum(value) * scale) / scale;
  },
  // 價目表：match(值, 比對1, 結果1, 比對2, 結果2, …[, 預設])
  // 比對用字串（選單值就是字串），參數為偶數個＝沒給預設，找不到回空字串
  match: (value, ...rest) => {
    for (let i = 0; i + 1 < rest.length; i += 2) {
      if (toText(rest[i]) === toText(value)) {
        return rest[i + 1];
      }
    }
    return rest.length % 2 === 1 ? rest[rest.length - 1] : '';
  },
};

// 白名單運算子。比較用字串比對（選單值是字串），算術用數值；
// `+` 兩邊都不是字串時才做數值加法，避免意外的字串串接
const BINARY_OPS = {
  '+': (a, b) => (typeof a === 'string' || typeof b === 'string' ? toNum(a) + toNum(b) : a + b),
  '-': (a, b) => toNum(a) - toNum(b),
  '*': (a, b) => toNum(a) * toNum(b),
  '/': (a, b) => toNum(a) / toNum(b),
  '%': (a, b) => toNum(a) % toNum(b),
  '==': (a, b) => toText(a) === toText(b),
  '===': (a, b) => toText(a) === toText(b),
  '!=': (a, b) => toText(a) !== toText(b),
  '!==': (a, b) => toText(a) !== toText(b),
  '<': (a, b) => toNum(a) < toNum(b),
  '<=': (a, b) => toNum(a) <= toNum(b),
  '>': (a, b) => toNum(a) > toNum(b),
  '>=': (a, b) => toNum(a) >= toNum(b),
};

// evaluator：只認這六種節點，其餘（MemberExpression / ArrayExpression / 箭頭函數 /
// ThisExpression / Compound…）一律丟錯
function evaluateNode(node, scope) {
  switch (node.type) {
    case 'Literal':
      return node.value;
    case 'Identifier':
      if (!(node.name in scope)) {
        throw new Error('不認得的欄位或名稱「' + node.name + '」');
      }
      return scope[node.name];
    case 'UnaryExpression':
      if (node.operator === '-') {
        return -toNum(evaluateNode(node.argument, scope));
      }
      if (node.operator === '+') {
        return toNum(evaluateNode(node.argument, scope));
      }
      if (node.operator === '!') {
        return !evaluateNode(node.argument, scope);
      }
      throw new Error('不支援的運算子「' + node.operator + '」');
    case 'BinaryExpression':
    case 'LogicalExpression': {
      // && 與 || 要短路（右邊可能引用只有在特定分支才成立的東西）
      if (node.operator === '&&') {
        return evaluateNode(node.left, scope) && evaluateNode(node.right, scope);
      }
      if (node.operator === '||') {
        return evaluateNode(node.left, scope) || evaluateNode(node.right, scope);
      }
      const op = BINARY_OPS[node.operator];
      if (op === undefined) {
        throw new Error('不支援的運算子「' + node.operator + '」');
      }
      return op(evaluateNode(node.left, scope), evaluateNode(node.right, scope));
    }
    case 'ConditionalExpression':
      // 三元：只求值被選中的那一支
      return evaluateNode(node.test, scope)
        ? evaluateNode(node.consequent, scope)
        : evaluateNode(node.alternate, scope);
    case 'CallExpression': {
      if (node.callee.type !== 'Identifier') {
        throw new Error('函數名稱必須是單純的名字');
      }
      const fn = CALC_FUNCTIONS[node.callee.name];
      if (fn === undefined) {
        throw new Error('不認得的函數「' + node.callee.name + '」');
      }
      return fn(...node.arguments.map((arg) => evaluateNode(arg, scope)));
    }
    default:
      throw new Error('不支援的語法（' + node.type + '）');
  }
}

// 把運算式段切成一行一行：**引號內的分號不切**（選項值可能是 "是;否"）
export function splitStatements(source) {
  const lines = [];
  let buffer = '';
  let quote = null;
  for (const ch of String(source === null || source === undefined ? '' : source)) {
    if (quote !== null) {
      if (ch === quote) {
        quote = null;
      }
      buffer += ch;
      continue;
    }
    if (ch === '"' || ch === "'") {
      quote = ch;
      buffer += ch;
      continue;
    }
    if (ch === ';') {
      lines.push(buffer);
      buffer = '';
      continue;
    }
    buffer += ch;
  }
  lines.push(buffer);
  return lines.map((line) => line.trim()).filter((line) => line !== '');
}

// 指派行 `名稱 = 式子`（單一個等號，不是 == / >= / != …）
const ASSIGN_RE = /^([^\s=<>!+\-*/%(),]+)\s*=(?!=)\s*([\s\S]+)$/;

// content 分派：含 `::` ＝新格式（模板::運算式::小數位數），否則走 legacy
export function parseCalcContent(content) {
  const raw = String(content === null || content === undefined ? '' : content);
  if (raw.indexOf('::') === -1) {
    return { legacy: true, content: raw };
  }
  const segments = raw.split('::');
  const decimals = parseInt(segments[2], 10);
  return {
    legacy: false,
    template: segments[0],
    expr: segments[1] === undefined ? '' : segments[1],
    decimals: Number.isFinite(decimals) && decimals > 0 ? decimals : 0,
  };
}

// 舊格式（`欄位ID:倍數;…`）：行為與文案原樣保留，既有問卷零變化。
// 取值規則刻意維持「抓 value 裡最後一個數字區塊」——不是好規則，但是既有資料的語意
export function legacySumUp(column, columnDB) {
  if (column.content === '') {
    return '';
  }
  const parts = column.content.split(';');
  let sumValue = 0;
  for (let i = 0; i < parts.length; i++) {
    if (parts[i] !== '') {
      const config = parts[i].split(':');
      const target = _.filter(columnDB, (col) => col.id === config[0]);
      if (target.length > 0) {
        const valueStr = target[0].value.toString();
        const allMatches = valueStr.match(/\d+/g);
        const value = allMatches ? parseInt(allMatches[allMatches.length - 1], 10) : 0;
        sumValue += value * parseInt(config[1], 10);
      }
    }
  }
  return parts.length + '個欄位總和為：' + sumValue;
}

// 被引用欄位的取值：寫式子的人不必知道值是學生填的還是名冊給的
function columnValueFor(column, columnDB, stack) {
  if (/C/.test(column.type)) {
    if (/S/.test(column.format)) {
      // 計算欄引用計算欄：取它的**結果值**（不是顯示字串），帶 stack 防循環
      return calcRawValue(column, columnDB, stack);
    }
    if (/T/.test(column.format)) {
      return toText(column.savedContent);
    }
    throw new Error('欄位「' + column.id + '」是說明區塊或檔案檢視，沒有可以計算的值');
  }
  const value = toText(column.value);
  return value === '' ? toText(column.savedContent) : value;
}

// 組 scope：欄位 ID → 值（惰性求值，沒被引用到的欄位不會被算）
function buildScope(columnDB, stack) {
  const scope = Object.create(null);
  for (const column of columnDB) {
    const id = column.id;
    if (id === undefined || id === null || id === '') {
      continue;
    }
    Object.defineProperty(scope, id, {
      enumerable: true,
      configurable: true,
      get: () => columnValueFor(column, columnDB, stack),
    });
  }
  return scope;
}

// 算出一個 C-S 欄的原始結果值（可能是數字、字串或布林）。丟錯＝設定有誤
function calcRawValue(column, columnDB, stack = []) {
  if (stack.indexOf(column.id) !== -1) {
    throw new Error('計算欄互相引用形成循環（' + stack.concat(column.id).join(' → ') + '）');
  }
  const nextStack = stack.concat(column.id);
  const parsed = parseCalcContent(column.content);
  if (parsed.legacy) {
    throw new Error('欄位「' + column.id + '」是舊格式計算欄，不能被其他計算欄引用');
  }
  const lines = splitStatements(parsed.expr);
  if (lines.length === 0) {
    throw new Error('運算式是空的');
  }
  const scope = buildScope(columnDB, nextStack);
  for (let i = 0; i < lines.length - 1; i++) {
    const matched = lines[i].match(ASSIGN_RE);
    if (matched === null) {
      throw new Error('第 ' + (i + 1) + ' 行不是「名稱 = 式子」的形式：' + lines[i]);
    }
    const name = matched[1].trim();
    if (Object.prototype.hasOwnProperty.call(scope, name)) {
      throw new Error('名稱「' + name + '」與欄位 ID 或先前的名稱重複');
    }
    // 中間值算完就定值（不是欄位那種惰性 getter），後面的行才看得到
    scope[name] = evaluateNode(jsep(matched[2]), scope);
  }
  return evaluateNode(jsep(lines[lines.length - 1]), scope);
}

// 顯示模板：`{}` 是結果的位置；沒有 `{}` 就接在尾端；整段空＝只顯示數字
function applyTemplate(template, text) {
  if (template === '') {
    return text;
  }
  if (template.indexOf(RESULT_SLOT) === -1) {
    return template + text;
  }
  return template.split(RESULT_SLOT).join(text);
}

/**
 * 計算欄（C-S）的顯示結果。**永遠不丟例外**——這支是在 render 裡被呼叫的，
 * 丟出去就整頁白畫面。設定有誤一律回 { ok: false, error }，由 FormField 顯示錯誤態。
 * @returns {{ ok: boolean, text: string, error: string }}
 */
export function computeCalcColumn(column, columnDB) {
  if (!/C/.test(column.type) || !/S/.test(column.format)) {
    return { ok: true, text: '', error: '' };
  }
  const parsed = parseCalcContent(column.content);
  if (parsed.legacy) {
    return { ok: true, text: legacySumUp(column, columnDB), error: '' };
  }
  try {
    const value = calcRawValue(column, columnDB, []);
    let text;
    if (typeof value === 'number' || (typeof value !== 'string' && typeof value !== 'boolean')) {
      const num = Number(value);
      if (!Number.isFinite(num)) {
        // NaN / Infinity 絕不上畫面
        return { ok: false, text: '', error: '計算結果不是有效的數字（可能是除以零或欄位值不是數字）' };
      }
      text = num.toFixed(parsed.decimals);
    } else {
      text = String(value);
    }
    return { ok: true, text: applyTemplate(parsed.template, text), error: '' };
  } catch (err) {
    return { ok: false, text: '', error: err && err.message ? err.message : String(err) };
  }
}

// ── 上線前檢查器共用規則（tools/export.js 內有一份同規則的複製）──────────
// 刻意**不 parse**：export.js 是手貼進 container-bound 專案的單檔 GAS 程式碼，
// 塞第三方 parser 不划算。這是 best-effort 的靜態檢查——抓得到打錯的欄位 ID、
// 括號沒關、`=` 誤當比較這類實際會犯的錯，不保證文法完全正確；
// 真正的把關在執行期 evaluator 的預設拒絕 ＋ 前端錯誤態（作者預覽時就看得到）
export function validateCalcExpression(exprSource, allIds) {
  const errors = [];
  const lines = splitStatements(exprSource);
  if (lines.length === 0) {
    errors.push('運算式段是空的');
    return errors;
  }
  const names = [];
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const isLast = i === lines.length - 1;
    const matched = line.match(ASSIGN_RE);
    if (!isLast) {
      if (matched === null) {
        errors.push('第 ' + (i + 1) + ' 行不是「名稱 = 式子」的形式（最後一行才是結果式）：' + line);
        continue;
      }
      const name = matched[1].trim();
      if (allIds !== null && allIds.indexOf(name) !== -1) {
        errors.push('名稱「' + name + '」與欄位 ID 重複');
      }
      names.push(name);
    } else if (matched !== null) {
      errors.push('最後一行應該是結果式，不是指派（比較要寫 `==`）：' + line);
    }
    const body = matched === null ? line : matched[2];
    let depth = 0;
    for (const ch of body) {
      if (ch === '(') depth += 1;
      if (ch === ')') depth -= 1;
      if (depth < 0) break;
    }
    if (depth !== 0) {
      errors.push('第 ' + (i + 1) + ' 行的括號沒有配對：' + line);
    }
    if (/[^=<>!]=(?!=)/.test(body)) {
      errors.push('第 ' + (i + 1) + ' 行出現單一個 `=`（比較要寫 `==`）：' + line);
    }
    if (/=>/.test(body)) {
      errors.push('第 ' + (i + 1) + ' 行出現 `=>`：運算式不支援函數定義');
    }
    // 去掉字串常值後再看識別字，避免把選項文字當成欄位 ID
    const stripped = body.replace(/"[^"]*"|'[^']*'/g, ' ');
    if (/[.[]/.test(stripped)) {
      errors.push('第 ' + (i + 1) + ' 行出現 `.` 或 `[`：運算式不支援屬性存取或陣列');
    }
    const tokens = stripped.match(/[A-Za-z_\u00A0-\uFFFF][A-Za-z0-9_\u00A0-\uFFFF]*/g) || [];
    for (const token of tokens) {
      if (Object.prototype.hasOwnProperty.call(CALC_FUNCTIONS, token)) {
        continue;
      }
      if (names.indexOf(token) !== -1) {
        continue;
      }
      if (allIds === null) {
        continue;
      }
      if (allIds.indexOf(token) === -1) {
        errors.push('第 ' + (i + 1) + ' 行引用了不存在的欄位 ID 或名稱「' + token + '」');
      }
    }
  }
  return errors;
}
