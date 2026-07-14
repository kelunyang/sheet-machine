import { v4 as uuidv4 } from 'uuid';
import _ from 'lodash';
import { filterMultiValue } from './fieldSources';

// 登入後把後端回傳的 headers 整理成可顯示的欄位（App.vue 與 InviteeSignDialog 共用）：
// group 設定解析、localStorage 暫存 queue 疊回、U 選項過濾、L/X 的 content 陣列化、
// 檔案欄位還原已上傳資訊。純搬移自 App.vue 的 loginView 迴圈，不改邏輯；就地改動 columns。
// currentAnsQueue：本機暫存的答案 queue（受邀者 read-only 檢視傳空陣列即可）。
export function prepareColumnsForDisplay(columns, currentAnsQueue) {
  let queue = currentAnsQueue || [];
  for (let i = 0; i < columns.length; i++) {
    let fileDetect = false;
    // Phase 23：這一欄的值是不是從暫存 queue 疊回來的——是的話在所有格式轉換做完後
    // （L 欄的 parseInt 之後，確保等值比較成立）標 draftOrigin，草稿 chip 據此導出
    let restored = false;
    let column = columns[i];
    column.tid = uuidv4();
    if (/F/.test(column.type)) {
      if (column.group !== '') {
        let groupConfig = column.group.split(':');
        column.group = groupConfig[0];
        column.uniGroup = false;
        if (groupConfig.length > 1) {
          column.uniGroup = groupConfig[1] === 'U';
        }
      }
      if (!/F/.test(column.format)) {
        let columnIndex = _.findIndex(queue, (item) => {
          return item.id === column.id;
        });
        if (columnIndex > -1) {
          column.value = queue[columnIndex].val;
          restored = true;
        }
      }
      if (/F/.test(column.format)) {
        // 檔案欄位：從 localStorage 載入已上傳的檔案資訊
        let fileColumnIndex = _.findIndex(queue, (item) => {
          return item.id === column.id && item.isFile;
        });
        if (fileColumnIndex > -1) {
          column.value = queue[fileColumnIndex].val;
          // 這次上傳的連結還原到 uploadUrl；lastInput 是後端給的「上次送出的檔案」，不覆寫
          column.uploadUrl = queue[fileColumnIndex].url;
          column.status = '';
          restored = true;
        } else if (column.must) {
          column.status = '請至少選擇一個檔案';
          fileDetect = true;
        }
      } else if (/U/.test(column.format)) {
        column.value = filterMultiValue(column, column.value);
      } else if (/L/.test(column.format)) {
        let defaultConfig = [1, 10, 100];
        let userConfig = column.content.split(';');
        if (userConfig.length === 3) {
          defaultConfig = _.map(userConfig, (str) => {
            return parseInt(str);
          });
        }
        column.value = parseInt(column.value);
        column.content = defaultConfig;
      } else if (/X/.test(column.format)) {
        let defaultConfig = ['', '', 2, 4];
        let userConfig = column.content.split(';');
        for (let k = 0; k < userConfig.length; k++) {
          if (userConfig[k] !== '') {
            defaultConfig[k] = parseInt(userConfig[k]);
          }
        }
        column.content = defaultConfig;
      }
      if (restored) {
        // 值已完成所有格式轉換（L 的 parseInt、U 的選項過濾），此刻的 value 才是草稿的最終形式。
        // 同時把「答案來源」設成 draft——登入後 segmented 一進場就停在「暫存」，
        // 使用者看得出「這格是還原的」，也能切去看預設值/上次送出的
        column.draftOrigin = { val: column.value, source: 'local' };
        column.source = 'draft';
      }
    }
    if (!fileDetect) {
      column.status = '';
    }
  }
  return columns;
}
