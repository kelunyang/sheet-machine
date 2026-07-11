// Phase 15：getHeaders 對第 7 列（must）/第 8 列（nullable/noneable）的詞彙解析。
// 沿用 sheetParam.test.js 的 new Function stub 模式載入 Code.js，只餵假 referArr。
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import _ from 'lodash';

const source = readFileSync(new URL('../src/Code.js', import.meta.url), 'utf8');

// 8 列 meta × 6 欄（全 F-T，避開 S 欄的 buildSelections 分支）：
// 第 7 列 must、第 8 列 nullable 涵蓋 ''/N/D/ND/怪值/含空白
const referArr = [
  ['T1', 'T2', 'T3', 'T4', 'T5', 'T6'], // id
  ['一', '二', '三', '四', '五', '六'], // name
  ['F', 'F', 'F', 'F', 'F', 'F'], // type
  ['T', 'T', 'T', 'T', 'T', 'T'], // format
  ['', '', '', '', '', ''], // group
  ['', '', '', '', '', ''], // content
  ['M', '', 'M', '', '', ' M '], // must
  ['', 'N', 'D', 'ND', 'X', ' D '], // nullable/noneable
];

function loadGas() {
  const fakePropertiesService = {
    getScriptProperties: () => ({
      getProperty: () => null,
      setProperty: () => {},
    }),
  };
  const fakeSpreadsheetApp = {
    openById: () => ({
      getSheets: () => [
        {
          getDataRange: () => ({ getValues: () => referArr.map((row) => row.slice()) }),
        },
      ],
    }),
  };
  const factory = new Function(
    'LodashGS',
    'PropertiesService',
    'SpreadsheetApp',
    `${source}\n;return { getHeaders };`
  );
  return factory({ load: () => _ }, fakePropertiesService, fakeSpreadsheetApp);
}

const { getHeaders } = loadGas();

describe('getHeaders 第 7/8 列詞彙解析（Phase 15）', () => {
  const headers = getHeaders('fake-refer-id');

  it('六欄全數解析', () => {
    expect(headers.length).toBe(6);
  });

  it('must：M 為真、空為假、regex test 容忍前後空白', () => {
    expect(_.map(headers, 'must')).toEqual([true, false, true, false, false, true]);
  });

  it('nullable：含 N 才為真（D、怪值不誤判）', () => {
    expect(_.map(headers, 'nullable')).toEqual([false, true, false, true, false, false]);
  });

  it('noneable：含 D 才為真（N、怪值不誤判；ND 兩者皆真）', () => {
    expect(_.map(headers, 'noneable')).toEqual([false, false, true, true, false, true]);
  });
});
