// 欄位規則：格式判斷、提示文字、驗證。全部是純函數（validateColumn 就地改寫 column.status/value）。
// column 結構來自 Code.js getHeaders()：{ id, name, type, format, content, value, savedContent,
//   must, nullable, group, uniGroup, status, ... }
import _ from 'lodash';
import { REUSE_LAST_FILE } from './sentinels';

// 判斷欄位是否同時符合 format 與 type 的正則（例如 formatDetector('T', 'F', col) = 文字輸入欄位）
export function formatDetector(formatReg, typeReg, column) {
  if (new RegExp(typeReg).test(column.type)) {
    if (new RegExp(formatReg).test(column.format)) {
      return true;
    }
  }
  return false;
}

// Phase 15：D 欄位（noneable）是否已宣告「無資料」——按鈕狀態、驗證短路都從這裡導出，
// 不另存旗標（value 就是唯一事實來源，草稿/暫存/匯入自動正確）
export function noneDeclared(column) {
  return column.noneable === true && column.value === '無資料';
}

// 群組檢查用的有效值：「無資料」哨兵視同空值——群組「不得全空」要的是至少一筆真資料，
// 宣告無資料不得打穿它（Phase 15 規格明定）
function groupValue(column) {
  return noneDeclared(column) ? '' : column.value;
}

// 從 authDB 找出主鍵欄位（type 含 P），找不到回傳 undefined
export function findPrimaryKey(authDB) {
  return _.filter(authDB, (item) => {
    return /P/.test(item.type);
  })[0];
}

// 找出「Google 帳號登入」的主鍵欄位（type 含 P 且 format 含 G），找不到回傳 undefined。
// 這個判斷決定登入 UI 走密碼欄位還是 Google 驗證按鈕
export function findGmailPrimary(columns) {
  return _.filter(columns, (column) => {
    if (/P/.test(column.type)) {
      return /G/.test(column.format);
    }
    return false;
  })[0];
}

// 檔案／一般欄位目前的填答狀態標籤（顯示在欄位上方的 el-tag）
export function statusDetector(column) {
  let status = 'info';
  let result = '非必填欄位';
  if (formatDetector('', 'F', column)) {
    if (column.must) {
      if (column.value === '') {
        status = 'danger';
        result = '必答題卻未答';
      }
    }
    if (column.status !== '') {
      status = 'danger';
      result = '填入內容有誤，請查看題目下方說明';
    } else if (column.value === REUSE_LAST_FILE) {
      // Phase 23：檔案欄宣告「沿用上次上傳的檔案」（送出時由伺服器端換成真 fileID）
      status = 'success';
      result = '沿用上次的檔案';
    } else {
      if (column.value !== '') {
        if (column.value !== column.savedContent) {
          status = 'success';
          result = '已回答';
        } else {
          status = 'warning';
          result = '輸入值等於預設值或是儲存值（送出時會進行格式檢查）';
        }
      }
    }
    return {
      status: status,
      result: result,
    };
  }
}

// C-S 欄位（計算欄）：依 content 設定加總其他欄位的值
export function sumUp(column, columnDB) {
  if (/C/.test(column.type)) {
    if (/S/.test(column.format)) {
      if (column.content !== '') {
        let columns = column.content.split(';');
        let sumValue = 0;
        for (let i = 0; i < columns.length; i++) {
          if (columns[i] !== '') {
            let columnConfig = columns[i].split(':');
            let target = _.filter(columnDB, (col) => {
              return col.id === columnConfig[0];
            });
            if (target.length > 0) {
              // 使用正則表達式提取 value 中最後一個數字區塊
              let valueStr = target[0].value.toString();
              let allMatches = valueStr.match(/\d+/g);
              let value = allMatches ? parseInt(allMatches[allMatches.length - 1]) : 0;
              let multiplier = parseInt(columnConfig[1]);
              sumValue += value * multiplier;
            }
          }
        }
        return columns.length + '個欄位總和為：' + sumValue;
      }
    }
  }
  return '';
}

// 群組欄位的說明文字
export function groupTip(column, columnDB) {
  let tip = '';
  let helpWord = [];
  if (formatDetector('', 'F', column)) {
    if (column.group !== '') {
      let sameGroup = _.filter(columnDB, (col) => {
        return col.group === column.group;
      });
      helpWord.push('此欄位和' + sameGroup.length + '個欄位編組為「' + column.group + '」');
      helpWord.push('各欄位不得均為空');
      if (column.uniGroup) {
        helpWord.push('各欄位內容不可重複');
      }
      tip = _.join(helpWord, '，');
    }
  }
  return tip;
}

// 欄位格式的說明文字（顯示在欄位下方）
export function formatHelper(column) {
  if (formatDetector('', 'F|A|P', column)) {
    let tip = '';
    if (formatDetector('N', 'F|A|P', column)) {
      tip = '數字';
      if (column.content === '0') {
        tip += '，必須以0開頭，長度不限';
      } else {
        tip += '，長度為' + column.content;
      }
    } else if (formatDetector('X', 'F', column)) {
      let forMsg = [];
      if (column.content[0] !== '') {
        forMsg.push('最長允許' + column.content[0] + '字');
      }
      if (column.content[1] !== '') {
        forMsg.push('至少要有' + column.content[1] + '字');
      }
      tip = _.join(forMsg, '，');
    } else if (formatDetector('P', 'F|A|P', column)) {
      let pConfig = column.content.split(';');
      tip = pConfig[0] + '碼郵遞區號';
    } else if (formatDetector('I', 'F|A|P', column)) {
      tip = '身份證字號（第一碼一定是英文）';
    } else if (formatDetector('M', 'F|A|P', column)) {
      tip = '台灣的手機號碼，一定是09開頭';
    } else if (formatDetector('L', 'F|A|P', column)) {
      tip =
        '請拖拉一個從' +
        column.content[1] +
        '到' +
        column.content[2] +
        '之間的整數，每次增減' +
        column.content[0];
    } else if (formatDetector('E', 'F|A|P', column)) {
      tip = 'Email格式，如test@test.com';
    } else if (formatDetector('T', 'F|A|P', column)) {
      if (column.content === '') {
        tip = '文字';
      } else {
        let regexConfig = column.content.split('::');
        tip = regexConfig[0];
      }
    } else if (formatDetector('S', 'F|A|P', column)) {
      tip = '請從選單中選一個正確的值';
    } else if (formatDetector('F', 'F|A|P', column)) {
      if (column.content === '') {
        tip = '你只能選擇一個檔案';
      } else {
        let contentConfig = column.content.split(';');
        let filetip = [];
        if (contentConfig[0] !== '') {
          filetip.push(contentConfig[0] + '類型檔案');
        }
        if (contentConfig[2] !== '') {
          filetip.push('大小需小於' + contentConfig[2] + 'MB');
        }
        filetip.push('你只能選擇一個檔案');
        tip = _.join(filetip, '，');
      }
    } else if (formatDetector('U', 'F|A|P', column)) {
      let selectionConfig = column.content.split('::');
      let selections = _.uniq(selectionConfig[1].split(';'));
      tip = '從' + selections.length + '個選項中';
      tip += selectionConfig[0] === '' ? '選擇你要的項目' : '挑出' + selectionConfig[0] + '個項目';
      tip += '（按上方按鍵去選）';
    } else if (formatDetector('G', 'F|A|P', column)) {
      tip = '本欄無法手動輸入，系統會自動讀取你登入的Google帳號';
    }
    let must = column.must ? '[必填]' : '';
    return must + '格式：' + tip + '[輸入後點其他區域會重新檢查本欄位格式]';
  }
  return '';
}

// 驗證單一欄位（原 App.vue 的 valField）：就地更新 column.status；
// 群組檢查需要整份 columnDB（同群組欄位的 status 也會被就地更新）
export function validateColumn(column, columnDB = []) {
  let passMust = true;
  let skipnull = false;
  column.status = '';
  if (column.value === '') {
    if (column.nullable) {
      skipnull = true;
    }
  }
  // 「無資料」宣告：非空所以過必填，格式檢查比照空值跳過
  if (noneDeclared(column)) {
    skipnull = true;
  }
  let formatCheck = false;
  if (formatDetector('', 'F', column)) {
    if (column.must) {
      //先檢查是否為空
      if (column.value === '') {
        passMust = false;
        column.status = '這個欄位必需有值！';
      } else {
        column.status = '';
        formatCheck = true;
      }
    } else {
      if (column.value !== '') {
        formatCheck = true;
      }
    }
    if (column.status === '') {
      //再檢查群組設定
      if (column.group !== '') {
        let sameGroup = _.filter(columnDB, (col) => {
          return col.group === column.group;
        });
        if (_.every(sameGroup, (col) => groupValue(col) === '')) {
          for (let i = 0; i < sameGroup.length; i++) {
            sameGroup[i].status = '群組「' + column.group + '」欄位值不得全為空！';
          }
          formatCheck = false;
        } else {
          for (let i = 0; i < sameGroup.length; i++) {
            sameGroup[i].status = '';
          }
          formatCheck = true;
        }
        if (column.uniGroup) {
          let uniqed = _.uniqBy(sameGroup, (item) => {
            return groupValue(item).toString().trim();
          });
          if (sameGroup.length !== uniqed.length) {
            for (let i = 0; i < sameGroup.length; i++) {
              sameGroup[i].status = '群組「' + column.group + '」欄位值不得重複！';
            }
            formatCheck = false;
          } else {
            for (let i = 0; i < sameGroup.length; i++) {
              sameGroup[i].status = '';
            }
            formatCheck = true;
          }
        }
      }
    }
  }
  if (formatCheck) {
    //最後檢查格式
    if (passMust) {
      if (!skipnull) {
        if (formatDetector('N|P', 'F|A|P', column)) {
          let num = 0;
          if (formatDetector('P', 'F|A|P', column)) {
            let pConfig = column.content.split(';');
            num = parseInt(pConfig[0]);
          } else if (formatDetector('N', 'F|A|P', column)) {
            if (column.content !== '') {
              num = parseInt(column.content);
            }
          }
          let zeroIndicator = num === 0 ? '0' : '';
          let numLength = num > 0 ? '{' + num + '}' : '*';
          if (new RegExp('^' + zeroIndicator + '\\d' + numLength + '$').test(column.value)) {
            column.status = '';
          } else {
            column.status = zeroIndicator
              ? '這裡應該要輸入0開頭的數字'
              : '這裡應該輸入長度為' + num + '的數字';
          }
        } else if (formatDetector('X', 'F', column)) {
          let statusMsg = [];
          if (column.content[0] !== '') {
            let maxLen = parseInt(column.content[0]);
            if (column.value.length > maxLen) {
              statusMsg.push(
                '你輸入的文字長度超過限制！（' + column.value.length + '/' + maxLen + '）'
              );
            }
          }
          if (column.status === '') {
            if (column.content[1] !== '') {
              let minLen = parseInt(column.content[1]);
              if (column.value.length < minLen) {
                statusMsg.push('你輸入的文字太少了！（' + column.value.length + '/' + minLen + '）');
              }
            }
          }
          if (statusMsg.length === 0) {
            column.status = '';
          } else {
            column.status =
              _.join(statusMsg, '，') + '（手動輸入後去點其他的欄位，本訊息即會消失）';
          }
        } else if (formatDetector('L', 'F|A|P', column)) {
          if (_.inRange(column.value, column.content[1], column.content[2] + 0.1)) {
            let diff = column.value - column.content[1];
            if (diff % column.content[0] === 0) {
              column.status = '';
            } else {
              column.status =
                '數字必須是介於' +
                column.content[1] +
                '和' +
                column.content[2] +
                '，每次增減' +
                column.content[0] +
                '的整數！';
            }
          } else {
            column.status =
              '數字必須是介於' +
              column.content[1] +
              '和' +
              column.content[2] +
              '，每次增減' +
              column.content[0] +
              '的整數！';
          }
        } else if (formatDetector('I', 'F|A|P', column)) {
          if (/^[A-Z][0-9|A-Z]\d{8}$/.test(column.value)) {
            column.status = '';
          } else {
            column.status = '這裡應該要輸入身分證號，如A123456789';
          }
        } else if (formatDetector('E', 'F|A|P', column)) {
          if (/^\w+((-\w+)|(\.\w+))*@[A-Za-z0-9]+((\.|-)[A-Za-z0-9]+)*\.[A-Za-z]+$/.test(column.value)) {
            column.status = '';
          } else {
            column.status = '這裡應該輸入Email';
          }
        } else if (formatDetector('M', 'F|A|P', column)) {
          if (/^09\d{8}$/.test(column.value)) {
            column.status = '';
          } else {
            column.status = '這裡應該輸入電話號碼，如0912345678';
          }
        } else if (formatDetector('T', 'F|A|P', column)) {
          if (column.content !== '') {
            let regexConfig = column.content.split('::');
            if (new RegExp(regexConfig[1]).test(column.value)) {
              column.value = column.value.replace(/台(北|中|南|灣)/, '臺$1');
              column.status = '';
            } else {
              column.status = '格式提示為「' + regexConfig[0] + '」';
            }
          }
        } else if (formatDetector('S', 'F|A|P', column)) {
          let selections = column.content.split(';');
          if (_.includes(selections, column.value)) {
            column.status = '';
          } else {
            column.status = '你真的是用選單選出來的值嗎？';
          }
        }
      }
    }
  }
}
