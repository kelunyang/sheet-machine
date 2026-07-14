// 每題「答案來源」切換與自動帶入（Phase 23，utils/fieldSources.js）。
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import {
  stripMark,
  filterMultiValue,
  coerceSourceValue,
  hasSource,
  hasUserInput,
  buildSourceOptions,
  currentSource,
  applySource,
  markUserInput,
  draftSourceText,
  differsFromLast,
  fileUrlOfSource,
  isFileField,
} from '../src/utils/fieldSources';
import { REUSE_LAST_FILE } from '../src/utils/sentinels';

function col(overrides) {
  return {
    id: 'c1',
    name: '欄位',
    type: 'F',
    format: 'T',
    content: '',
    value: '',
    savedContent: '',
    status: '',
    ...overrides,
  };
}

describe('哨兵常數：前後端字面一致', () => {
  it('Code.js 的 REUSE_LAST_FILE_SENTINEL 與前端 sentinels.js 同字面', () => {
    const source = readFileSync(new URL('../src/Code.js', import.meta.url), 'utf8');
    const match = source.match(/const REUSE_LAST_FILE_SENTINEL = '([^']+)'/);
    expect(match).not.toBe(null);
    expect(match[1]).toBe(REUSE_LAST_FILE);
  });
});

describe('coerceSourceValue：切換來源時各 format 的帶入轉換', () => {
  it('文字欄直塞，並剝掉 📝 防轉型前綴（savedContent 可能殘留）', () => {
    expect(coerceSourceValue(col({ format: 'T' }), '📝0912345678')).toBe('0912345678');
    expect(stripMark('📝6')).toBe('6');
    expect(stripMark(undefined)).toBe('');
  });

  it('U 多選：只留仍在選項清單裡的項目', () => {
    const c = col({ format: 'U', content: '2::甲;乙;丙' });
    expect(coerceSourceValue(c, '乙;已下架;甲')).toBe('乙;甲');
    expect(filterMultiValue(c, '完全沒有的選項')).toBe('');
  });

  it('L 滑桿：轉整數；轉不出數字的來源不長出選項', () => {
    const c = col({ format: 'L', content: [1, 10, 100], savedContent: '60' });
    expect(coerceSourceValue(c, '📝60')).toBe(60);
    expect(hasSource(c, 'saved')).toBe(true);
    expect(hasSource(col({ format: 'L', savedContent: '不是數字' }), 'saved')).toBe(false);
  });

  it('S 下拉：不在選項裡的值照塞，交給 validateColumn 標紅（不默默吞掉）', () => {
    const c = col({ format: 'S', content: '甲;乙' });
    expect(coerceSourceValue(c, '丙')).toBe('丙');
  });
});

describe('buildSourceOptions：沒值的來源不長出選項', () => {
  it('四個來源都有 → 四個選項，且都可選', () => {
    const c = col({
      savedContent: '甲',
      lastInput: '乙',
      draftOrigin: { val: '丙', source: 'import' },
      userInput: '丁',
    });
    const options = buildSourceOptions(c);
    expect(options.map((o) => o.value)).toEqual(['saved', 'last', 'draft', 'user']);
    expect(options.every((o) => !o.disabled)).toBe(true);
    expect(draftSourceText(c)).toBe('匯入的暫存檔');
  });

  it('「你現在填的」永遠列出，但使用者沒動手前是 disabled', () => {
    const c = col({ savedContent: '甲' });
    const options = buildSourceOptions(c);
    expect(options.map((o) => o.value)).toEqual(['saved', 'user']);
    expect(options.find((o) => o.value === 'user').disabled).toBe(true);
    expect(hasUserInput(c)).toBe(false);

    c.value = '我打的字';
    markUserInput(c);
    expect(buildSourceOptions(c).find((o) => o.value === 'user').disabled).toBe(false);
  });

  it('L 欄使用者填的 0 也算有填；parseInt(\'\') 的 NaN 不算', () => {
    const c = col({ format: 'L', value: 0 });
    markUserInput(c);
    expect(hasUserInput(c)).toBe(true);
    expect(hasUserInput(col({ format: 'L', userInput: NaN }))).toBe(false);
  });

  it('檔案欄的「預設值」不長出選項（名冊存檔名片段，後端無從安全解析成 fileID）', () => {
    const c = col({ format: 'F', savedContent: 'oldname', lastInput: 'https://drive/x' });
    expect(isFileField(c)).toBe(true);
    expect(buildSourceOptions(c).map((o) => o.value)).toEqual(['last', 'user']);
  });
});

describe('applySource：切換就自動帶入該來源的值', () => {
  it('切到預設值／上次送出 → 值換過去，來源記在 column.source', () => {
    const c = col({ savedContent: '甲', lastInput: '乙', value: '' });
    applySource(c, 'saved');
    expect(c.value).toBe('甲');
    expect(currentSource(c)).toBe('saved');
    applySource(c, 'last');
    expect(c.value).toBe('乙');
    expect(currentSource(c)).toBe('last');
  });

  it('切去看別的來源再切回來，不會弄丟自己填的東西', () => {
    const c = col({ savedContent: '預設', lastInput: '上次' });
    c.value = '我自己填的';
    markUserInput(c);
    applySource(c, 'saved');
    expect(c.value).toBe('預設');
    applySource(c, 'user');
    expect(c.value).toBe('我自己填的');
    expect(currentSource(c)).toBe('user');
  });

  it('檔案欄切到「你上次的」帶入的是哨兵，不是 fileID（前端沒有傳舊 fileID 的通道）', () => {
    const c = col({ format: 'F', lastInput: 'https://drive/x', value: '' });
    applySource(c, 'last');
    expect(c.value).toBe(REUSE_LAST_FILE);
    expect(c.status).toBe('');
  });

  it('fileUrlOfSource：各來源指向正確的檔案（新上傳走 uploadUrl、沿用上次走 lastInput）', () => {
    const c = col({
      format: 'F',
      value: 'NEWID',
      uploadUrl: 'https://drive/new',
      lastInput: 'https://drive/prev',
      draftOrigin: { val: REUSE_LAST_FILE, source: 'online' },
    });
    expect(fileUrlOfSource(c, 'user')).toBe('https://drive/new');
    expect(fileUrlOfSource(c, 'last')).toBe('https://drive/prev');
    // 暫存記的是「沿用上次」的決定 → 指向上次那個檔案
    expect(fileUrlOfSource(c, 'draft')).toBe('https://drive/prev');
    // 沿用上次（value 是哨兵）→ 也指向上次那個檔案
    c.value = REUSE_LAST_FILE;
    expect(fileUrlOfSource(c, 'user')).toBe('https://drive/prev');
    // 非檔案欄不回連結
    expect(fileUrlOfSource(col({ format: 'T', value: 'x' }), 'user')).toBe('');
  });

  it('檔案欄切到「暫存」帶入的是暫存當時記下的決定（哨兵或那次上傳的 fileID）', () => {
    const c = col({
      format: 'F',
      draftOrigin: { val: REUSE_LAST_FILE, source: 'online' },
      lastInput: 'https://drive/x',
    });
    applySource(c, 'draft');
    expect(c.value).toBe(REUSE_LAST_FILE);

    const c2 = col({ format: 'F', draftOrigin: { val: 'NEWFILEID', source: 'local' } });
    applySource(c2, 'draft');
    expect(c2.value).toBe('NEWFILEID');
  });

  it('L 欄切換帶入的是 number（parseInt 後）', () => {
    const c = col({ format: 'L', content: [1, 0, 100], lastInput: '📝60' });
    applySource(c, 'last');
    expect(c.value).toBe(60);
  });
});

describe('currentSource：沒切過時的回推', () => {
  it('值等於系統預設值 → saved；不等於 → user', () => {
    expect(currentSource(col({ value: '甲', savedContent: '甲' }))).toBe('saved');
    expect(currentSource(col({ value: '乙', savedContent: '甲' }))).toBe('user');
  });

  it('column.source 一旦寫過就以它為準', () => {
    const c = col({ value: '甲', savedContent: '甲', source: 'draft' });
    expect(currentSource(c)).toBe('draft');
  });
});

describe('differsFromLast：與上次送出不同', () => {
  it('沒送出過（lastInput undefined）不顯示', () => {
    expect(differsFromLast(col({ value: '甲' }))).toBe(false);
  });

  it('文字欄比值（📝 前綴不算差異）', () => {
    expect(differsFromLast(col({ value: '6', lastInput: '📝6' }))).toBe(false);
    expect(differsFromLast(col({ value: '7', lastInput: '📝6' }))).toBe(true);
  });

  it('檔案欄：有新上傳才算差異，沿用舊檔（哨兵）不算', () => {
    const base = { format: 'F', lastInput: 'https://drive/x' };
    expect(differsFromLast(col({ ...base, value: '' }))).toBe(false);
    expect(differsFromLast(col({ ...base, value: REUSE_LAST_FILE }))).toBe(false);
    expect(differsFromLast(col({ ...base, value: 'NEWFILEID' }))).toBe(true);
  });
});
